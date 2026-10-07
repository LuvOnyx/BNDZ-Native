#!/usr/bin/env python3
"""Smoke the guest web panel against a temp disk. No Fly, no Hyper-V."""

import http.client
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "BNDZBackend/Services/CloudDrive/guest/panel/server.py"
SECRET = "panel-secret-value"
PORT = 8766


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        env = os.environ.copy()
        env.update({
            "BNDZ_DATA_MOUNT": tmp,
            "BNDZ_FTP_PASSWORD": SECRET,
            "BNDZ_PANEL_HOST": "127.0.0.1",
            "BNDZ_PANEL_PORT": str(PORT),
        })
        proc = subprocess.Popen(
            [sys.executable, str(SERVER)],
            env=env,
            stderr=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
        )
        try:
            wait_up()
            run(tmp)
        finally:
            proc.terminate()
            try:
                _, err = proc.communicate(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
                _, err = proc.communicate(timeout=3)
            blob = err or ""
            if SECRET in blob:
                raise SystemExit("panel password leaked to stderr")
    print("test-cloud-panel: ok")


def wait_up() -> None:
    for _ in range(40):
        try:
            status, body = call("GET", "/api/health")
            if status == 200 and json.loads(body)["ok"]:
                return
        except OSError:
            time.sleep(0.05)
    raise SystemExit("panel did not start")


def run(tmp: str) -> None:
    status, body = call("GET", "/api/list")
    assert status == 401, body
    status, body = call("POST", "/api/login", {"user": "bndz", "password": "nope"})
    assert status == 401 and SECRET not in body
    status, body, headers = call("POST", "/api/login", {"user": "bndz", "password": SECRET}, headers=True)
    assert status == 200 and SECRET not in body
    cookie = headers["set-cookie"].split(";", 1)[0]

    status, body = call("POST", "/api/mkdir", {"path": "", "name": "notes"}, cookie=cookie)
    assert status == 200, body
    boundary = "bndzboundary"
    payload = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="dir"\r\n\r\n'
        "notes\r\n"
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="file"; filename="hello.txt"\r\n'
        "Content-Type: text/plain\r\n\r\n"
        "hello-from-test\r\n"
        f"--{boundary}--\r\n"
    ).encode()
    status, body = call_raw("POST", "/api/upload", payload, cookie, f"multipart/form-data; boundary={boundary}")
    assert status == 200, body
    assert Path(tmp, "notes", "hello.txt").read_text() == "hello-from-test"
    status, body = call("GET", "/api/list?path=notes", cookie=cookie)
    names = [row["name"] for row in json.loads(body)["entries"]]
    assert names == ["hello.txt"], names
    status, body = call("GET", "/api/download?path=notes/hello.txt", cookie=cookie)
    assert body == "hello-from-test"
    status, body = call("POST", "/api/rename", {"from": "notes/hello.txt", "name": "read-me.txt"}, cookie=cookie)
    assert status == 200, body
    outside = Path(tmp).parent / "not-on-drive.txt"
    outside.write_text("LEAKED-ARCHIVE-BYTES")
    link = Path(tmp) / "escape-link"
    try:
        link.symlink_to(outside)
    except OSError:
        pass
    status, raw = call_bin("GET", "/api/archive")
    assert status == 401, raw[:80]
    status, raw = call_bin("GET", "/api/archive", cookie)
    assert status == 200, raw[:80]
    assert b"LEAKED-ARCHIVE-BYTES" not in raw
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as tar:
        names = tar.getnames()
        assert "notes/read-me.txt" in names, names
        member = tar.extractfile("notes/read-me.txt")
        assert member is not None and member.read() == b"hello-from-test"
        assert all("not-on-drive" not in name and "escape-link" not in name for name in names)
    outside.unlink(missing_ok=True)
    status, body = call("POST", "/api/shares", {"path": "notes/read-me.txt", "hours": 2, "password": "share-pass", "write": False}, cookie=cookie)
    share = json.loads(body)["share"]
    assert share["locked"] is True
    token = share["id"]
    status, page = call("GET", "/s/" + token)
    assert status == 200 and "Password" in page and "hello-from-test" not in page
    status, page = call("POST", "/s/" + token, form={"password": "wrong"})
    assert "did not match" in page and "wrong" not in page
    status, page, headers = call("POST", "/s/" + token, form={"password": "share-pass"}, headers=True)
    assert status == 303, page
    share_cookie = headers["set-cookie"].split(";", 1)[0]
    status, raw = call("GET", "/s/" + token + "/raw", cookie=share_cookie)
    assert raw == "hello-from-test"
    status, svg = call("GET", "/s/" + token + "/qr.svg")
    assert svg.startswith("<svg") and "rect" in svg
    status, body = call("POST", "/api/mkdir", {"path": "..", "name": "x"}, cookie=cookie)
    assert status == 400 and "outside" in body, body
    status, body = call("GET", "/api/list?path=../etc", cookie=cookie)
    assert status == 400 and "outside" in body
    store = Path(tmp, ".bndz", "shares.json")
    rows = json.loads(store.read_text())
    rows[0]["expires"] = 1
    store.write_text(json.dumps(rows))
    status, text = call("GET", "/s/" + token)
    assert status == 410 and "expired" in text
    rows[0]["expires"] = int(time.time()) + 3600
    rows[0]["revoked"] = True
    store.write_text(json.dumps(rows))
    status, text = call("GET", "/s/" + token)
    assert status == 410 and "revoked" in text
    status, body = call("GET", "/api/list", cookie=cookie)
    assert all(row["name"] != ".bndz" for row in json.loads(body)["entries"])


def call(method, path, payload=None, cookie="", form=None, headers=False):
    if form is not None:
        from urllib.parse import urlencode
        data = urlencode(form).encode()
        return call_raw(method, path, data, cookie, "application/x-www-form-urlencoded", headers)
    data = json.dumps(payload).encode() if payload is not None else None
    ctype = "application/json" if data is not None else None
    return call_raw(method, path, data, cookie, ctype, headers)


def call_bin(method, path, cookie=""):
    conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=5)
    hdrs = {"Cookie": cookie} if cookie else {}
    conn.request(method, path, headers=hdrs)
    res = conn.getresponse()
    body = res.read()
    conn.close()
    return res.status, body


def call_raw(method, path, data, cookie, content_type, want_headers=False):
    conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=5)
    hdrs = {}
    if content_type and data is not None:
        hdrs["Content-Type"] = content_type
    if cookie:
        hdrs["Cookie"] = cookie
    conn.request(method, path, body=data, headers=hdrs)
    res = conn.getresponse()
    body = res.read().decode()
    hdr_map = {k.lower(): v for k, v in res.getheaders()}
    conn.close()
    if want_headers:
        return res.status, body, hdr_map
    return res.status, body


if __name__ == "__main__":
    main()
