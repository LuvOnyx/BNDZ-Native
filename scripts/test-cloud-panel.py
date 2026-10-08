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
            "BNDZ_PUBLIC_HOST": "files.example.com",
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
            if SECRET in blob or "newer-secret" in blob:
                raise SystemExit("panel password leaked to stderr")
        prefix_case()
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
    assert status == 200 and "Password" in page and "hello-from-test" not in page and "files.example.com" in page
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
    status, body = call("GET", "/api/admin")
    assert status == 401, body
    status, body = call("GET", "/api/admin", cookie=cookie)
    admin = json.loads(body)
    assert admin["username"] == "bndz" and "passHash" not in body and SECRET not in body
    assert admin["publicHost"] == "files.example.com"
    status, body = call("POST", "/api/admin", {
        "displayName": "Mikey",
        "brandName": "Field reel",
        "sessionHours": 4,
        "shareHours": 6,
        "shareWrite": True,
        "protocols": {"ssh": True, "ftps": False, "webdav": True},
    }, cookie=cookie)
    saved = json.loads(body)
    assert status == 200 and saved["displayName"] == "Mikey" and saved["brandName"] == "Field reel"
    assert saved["sessionHours"] == 4 and saved["shareHours"] == 6 and saved["shareWrite"] is True
    assert saved["protocols"]["ftps"] is False
    assert "did not stop or start" in saved["protocolNote"]
    assert SECRET not in body
    status, body = call("POST", "/api/admin", {
        "username": "mikey",
        "currentPassword": "wrong-password",
        "newPassword": "newer-secret",
        "confirmPassword": "newer-secret",
    }, cookie=cookie)
    assert status == 401 and "did not match" in body and "newer-secret" not in body
    status, body = call("POST", "/api/admin", {
        "username": "mikey",
        "currentPassword": SECRET,
        "newPassword": "short",
        "confirmPassword": "short",
    }, cookie=cookie)
    assert status == 400 and "8 characters" in body
    status, body = call("POST", "/api/admin", {
        "username": "1bad",
        "currentPassword": SECRET,
    }, cookie=cookie)
    assert status == 400 and "letter" in body
    status, body = call("POST", "/api/admin", {
        "username": "mikey",
        "currentPassword": SECRET,
        "newPassword": "newer-secret",
        "confirmPassword": "newer-secret",
    }, cookie=cookie)
    assert status == 200, body
    changed = json.loads(body)
    assert changed["username"] == "mikey"
    assert "did not change the drive account" in changed["passwordNote"]
    assert "newer-secret" not in body
    store = Path(tmp, ".bndz", "admin.json")
    raw_admin = store.read_text()
    assert "newer-secret" not in raw_admin and SECRET not in raw_admin
    assert "passHash" in raw_admin
    status, body = call("POST", "/api/login", {"user": "bndz", "password": SECRET})
    assert status == 401
    status, body = call("POST", "/api/login", {"user": "mikey", "password": "newer-secret"})
    assert status == 200 and "newer-secret" not in body
    status, page = call("GET", "/app.js")
    assert status == 200 and "Settings" in page and "nav-admin" in page
    assert "Properties" in page and "Date modified" in page and "Ctrl+V" in page
    status, body = call("GET", "/api/props?path=notes/read-me.txt", cookie=cookie)
    props = json.loads(body)
    assert status == 200 and props["mode"].startswith("-") and props["size"] > 0 and props["mtime"] > 0
    status, body = call("POST", "/api/copy", {"paths": ["notes"], "dest": "notes"}, cookie=cookie)
    assert status == 400 and "itself" in body
    status, body = call("POST", "/api/copy", {"paths": ["notes/read-me.txt"], "dest": "notes"}, cookie=cookie)
    assert status == 200 and "Copy" in body, body
    assert Path(tmp, "notes", "read-me - Copy.txt").read_text() == "hello-from-test"
    status, body = call("POST", "/api/mkdir", {"path": "", "name": "copies"}, cookie=cookie)
    assert status == 200, body
    status, body = call("POST", "/api/move", {"paths": ["notes/read-me - Copy.txt"], "dest": "copies"}, cookie=cookie)
    assert status == 200, body
    assert Path(tmp, "copies", "read-me - Copy.txt").is_file()
    assert not Path(tmp, "notes", "read-me - Copy.txt").exists()
    status, body = call("POST", "/api/delete", {"paths": ["copies/read-me - Copy.txt"]}, cookie=cookie)
    assert status == 200, body


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


def prefix_case() -> None:
    global PORT
    previous = PORT
    PORT = 8767
    with tempfile.TemporaryDirectory() as tmp:
        env = os.environ.copy()
        env.update({
            "BNDZ_DATA_MOUNT": tmp,
            "BNDZ_FTP_PASSWORD": SECRET,
            "BNDZ_PANEL_HOST": "127.0.0.1",
            "BNDZ_PANEL_PORT": str(PORT),
            "BNDZ_PUBLIC_HOST": "cloud.bndz.org",
            "BNDZ_PATH_PREFIX": "/studio",
            "BNDZ_SLUG_REDIRECTS": "oldname:studio",
            "BNDZ_ROUTE_GUARD": "1",
        })
        proc = subprocess.Popen(
            [sys.executable, str(SERVER)],
            env=env,
            stderr=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
        )
        try:
            for _ in range(40):
                try:
                    status, body = call("GET", "/studio/api/health")
                    if status == 200 and json.loads(body)["ok"]:
                        break
                except OSError:
                    time.sleep(0.05)
            else:
                raise SystemExit("prefixed panel did not start")
            status, page = call("GET", "/studio/")
            assert status == 200 and "window.BNDZ_BASE" in page and "/studio/app.js" in page, page[:240]
            status, body, headers = call("POST", "/studio/api/login", {"user": "bndz", "password": SECRET}, headers=True)
            assert status == 200, body
            assert "Path=/studio/" in headers["set-cookie"]
            cookie = headers["set-cookie"].split(";", 1)[0]
            status, body = call("POST", "/studio/api/upload/start", {"dir": "", "name": "chunk.txt", "size": 11}, cookie=cookie)
            meta = json.loads(body)
            assert status == 200 and meta["chunkSize"] <= 90 * 1024 * 1024, body
            status, body, _headers = call_raw(
                "PUT",
                "/studio/api/upload/chunk?id=" + meta["id"] + "&offset=5",
                b"hello",
                cookie,
                "application/octet-stream",
                True,
            )
            assert status == 409 and json.loads(body)["offset"] == 0, body
            status, body = call_raw(
                "PUT",
                "/studio/api/upload/chunk?id=" + meta["id"] + "&offset=0",
                b"hello-chunk",
                cookie,
                "application/octet-stream",
            )
            assert status == 200, body
            status, body = call("POST", "/studio/api/upload/finish", {"id": meta["id"]}, cookie=cookie)
            assert status == 200, body
            assert Path(tmp, "chunk.txt").read_text() == "hello-chunk"
            status, page, headers = call("GET", "/oldname/files", headers=True)
            assert status == 301 and headers["location"].endswith("/studio/files"), headers.get("location")
            status, body = call_raw("GET", "/studio/api/health", None, "", None, False, {"Host": "d-studio.bndz.org"})
            assert status == 404 and "https://cloud.bndz.org/studio/" in body, body
            status, body = call_raw(
                "GET",
                "/studio/api/health",
                None,
                "",
                None,
                False,
                {"Host": "d-studio.bndz.org", "X-Bndz-Route": "1"},
            )
            assert status == 200, body
            status, body = call("POST", "/studio/api/shares", {"path": "chunk.txt", "hours": 2}, cookie=cookie)
            share = json.loads(body)["share"]
            assert share["url"].startswith("/s/")
            status, page = call("GET", share["url"])
            assert status == 200 and "cloud.bndz.org" in page and "/studio/s/" not in page
        finally:
            PORT = previous
            proc.terminate()
            try:
                proc.communicate(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.communicate(timeout=3)


def call_raw(method, path, data, cookie, content_type, want_headers=False, extra=None):
    conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=5)
    hdrs = {}
    if extra:
        hdrs.update(extra)
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
