#!/usr/bin/env python3
"""BNDZ Cloud Drive web panel.

Stdlib HTTP server for the guest. Login is the per-drive user `bndz` and the
same password as FTPS. Files live under /data. Share links are served by this
process. Not Nextcloud, not Docker, not Cloudflare Containers.

The QR encoder beside this file is Project Nayuki's MIT library (qrcodegen.py).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import sys
import tarfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

HERE = Path(__file__).resolve().parent
DATA = Path(os.environ.get("BNDZ_DATA_MOUNT", "/data"))
USER = os.environ.get("BNDZ_PANEL_USER", "bndz")
PASSWORD = os.environ.get("BNDZ_FTP_PASSWORD", "")
HOST = os.environ.get("BNDZ_PANEL_HOST", "0.0.0.0")
PORT = int(os.environ.get("BNDZ_PANEL_PORT", "8080"))
MAX_UPLOAD = 512 * 1024 * 1024

SESSIONS: dict[str, float] = {}
SHARE_AUTH: dict[str, float] = {}
FAILS: dict[str, list[float]] = {}
LOCK = threading.Lock()
SESSION_TTL = 12 * 3600


def store_path() -> Path:
    folder = DATA / ".bndz"
    folder.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(folder, 0o700)
    except OSError:
        pass
    return folder / "shares.json"


def load_shares() -> list[dict]:
    path = store_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return data if isinstance(data, list) else []


def save_shares(rows: list[dict]) -> None:
    path = store_path()
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(rows, indent=2), "utf-8")
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, path)


def _same(left: str, right: str) -> bool:
    if len(left) != len(right):
        return False
    return hmac.compare_digest(left, right)


def hash_password(password: str, salt: bytes | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 80000)
    return salt.hex(), digest.hex()


def password_ok(password: str, salt_hex: str, digest_hex: str) -> bool:
    try:
        salt = bytes.fromhex(salt_hex)
        expect = bytes.fromhex(digest_hex)
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 80000)
    return hmac.compare_digest(digest, expect)


def safe(rel: str) -> Path:
    rel = unquote(rel or "").replace("\\", "/").strip()
    while rel.startswith("/"):
        rel = rel[1:]
    if rel in ("", "."):
        root = DATA.resolve()
        return root
    parts = [p for p in rel.split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts) or (parts and parts[0] == ".bndz"):
        raise PermissionError("That path is outside the drive.")
    root = DATA.resolve()
    dest = root.joinpath(*parts).resolve()
    if dest != root and root not in dest.parents:
        raise PermissionError("That path is outside the drive.")
    if dest.is_symlink():
        raise PermissionError("Links are not followed.")
    return dest


def rel_of(path: Path) -> str:
    root = DATA.resolve()
    try:
        rel = path.resolve().relative_to(root).as_posix()
    except ValueError:
        return ""
    return "" if rel == "." else rel


def client_ip(handler: BaseHTTPRequestHandler) -> str:
    forwarded = handler.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return (handler.client_address[0] if handler.client_address else "")[:64]


def too_many_fails(ip: str) -> bool:
    now = time.time()
    with LOCK:
        rows = [t for t in FAILS.get(ip, []) if now - t < 60]
        FAILS[ip] = rows
        return len(rows) >= 8


def note_fail(ip: str) -> None:
    with LOCK:
        FAILS.setdefault(ip, []).append(time.time())


def clear_fails(ip: str) -> None:
    with LOCK:
        FAILS.pop(ip, None)


def new_session() -> str:
    token = secrets.token_hex(24)
    with LOCK:
        SESSIONS[token] = time.time() + SESSION_TTL
    return token


def session_ok(token: str | None) -> bool:
    if not token:
        return False
    now = time.time()
    with LOCK:
        exp = SESSIONS.get(token)
        if not exp or exp < now:
            SESSIONS.pop(token, None)
            return False
        SESSIONS[token] = now + SESSION_TTL
        return True


def cookie_map(header: str | None) -> dict[str, str]:
    out: dict[str, str] = {}
    if not header:
        return out
    for part in header.split(";"):
        if "=" not in part:
            continue
        k, v = part.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def qr_svg(text: str) -> bytes:
    sys.path.insert(0, str(HERE))
    import qrcodegen  # vendored MIT, Project Nayuki

    qr = qrcodegen.QrCode.encode_text(text, qrcodegen.QrCode.Ecc.MEDIUM)
    n = qr.get_size()
    box = n + 8
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {box} {box}" shape-rendering="crispEdges">',
        f'<rect width="{box}" height="{box}" fill="#f4efe4"/>',
    ]
    for y in range(n):
        for x in range(n):
            if qr.get_module(x, y):
                parts.append(f'<rect x="{x + 4}" y="{y + 4}" width="1" height="1" fill="#14160f"/>')
    parts.append("</svg>")
    return "".join(parts).encode("utf-8")


def entry(path: Path) -> dict:
    st = path.stat()
    return {
        "name": path.name,
        "dir": path.is_dir(),
        "size": 0 if path.is_dir() else st.st_size,
        "mtime": int(st.st_mtime),
    }


def find_share(token: str) -> dict | None:
    for row in load_shares():
        if row.get("id") == token:
            return row
    return None


def share_status(row: dict) -> str | None:
    if row.get("revoked"):
        return "This share link was revoked."
    try:
        if float(row.get("expires") or 0) < time.time():
            return "This share link has expired."
    except (TypeError, ValueError):
        return "This share link has expired."
    return None


def bump_view(token: str) -> None:
    rows = load_shares()
    for row in rows:
        if row.get("id") == token:
            row["views"] = int(row.get("views") or 0) + 1
            break
    save_shares(rows)


class Panel(BaseHTTPRequestHandler):
    server_version = "BNDZPanel"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        line = fmt % args
        line = re.sub(r"/s/[A-Za-z0-9]+", "/s/[redacted]", line)
        sys.stderr.write(line + "\n")

    def handle(self) -> None:
        try:
            super().handle()
        except (ConnectionResetError, BrokenPipeError, TimeoutError):
            return

    def do_GET(self) -> None:
        self._route("GET")

    def do_POST(self) -> None:
        self._route("POST")

    def _route(self, method: str) -> None:
        try:
            parsed = urlparse(self.path)
            path = unquote(parsed.path)
            query = parse_qs(parsed.query)
            if path == "/api/health":
                self._json({"ok": True, "data": str(DATA), "mounted": DATA.is_dir()})
                return
            if path.startswith("/s/"):
                self._share(method, path)
                return
            if path == "/api/login" and method == "POST":
                self._login()
                return
            if path == "/api/logout" and method == "POST":
                self._logout()
                return
            if path in ("/", "/index.html"):
                self._file(HERE / "index.html", "text/html; charset=utf-8")
                return
            if path == "/app.css":
                self._file(HERE / "app.css", "text/css; charset=utf-8")
                return
            if path == "/app.js":
                self._file(HERE / "app.js", "text/javascript; charset=utf-8")
                return
            if not self._authed():
                self._json({"ok": False, "error": "Sign in first."}, 401)
                return
            if path == "/api/me":
                self._me()
                return
            if path == "/api/list":
                self._list(query.get("path", [""])[0])
                return
            if path == "/api/download":
                self._download(query.get("path", [""])[0])
                return
            if path == "/api/archive" and method == "GET":
                self._archive()
                return
            if path == "/api/shares" and method == "GET":
                self._json({"ok": True, "shares": self._public_shares()})
                return
            if path == "/api/shares" and method == "POST":
                self._create_share()
                return
            if path == "/api/shares/revoke" and method == "POST":
                self._revoke()
                return
            if path.startswith("/api/shares/") and path.endswith("/qr.svg"):
                token = path[len("/api/shares/") : -len("/qr.svg")]
                self._share_qr(token)
                return
            if path == "/api/mkdir" and method == "POST":
                self._mkdir()
                return
            if path == "/api/rename" and method == "POST":
                self._rename()
                return
            if path == "/api/delete" and method == "POST":
                self._delete()
                return
            if path == "/api/upload" and method == "POST":
                self._upload()
                return
            self._json({"ok": False, "error": "Not found."}, 404)
        except PermissionError as ex:
            self._json({"ok": False, "error": str(ex)}, 400)
        except FileNotFoundError:
            self._json({"ok": False, "error": "That file is not on the drive."}, 404)
        except Exception as ex:  # noqa: BLE001 — return a redacted message, keep the process up
            self._json({"ok": False, "error": "The panel could not finish that."}, 500)
            sys.stderr.write("panel error: " + type(ex).__name__ + "\n")

    def _authed(self) -> bool:
        cookies = cookie_map(self.headers.get("Cookie"))
        return session_ok(cookies.get("bndz_session"))

    def _login(self) -> None:
        ip = client_ip(self)
        if too_many_fails(ip):
            self._json({"ok": False, "error": "Too many sign-in attempts. Wait a minute."}, 429)
            return
        body = self._json_body()
        user = str(body.get("user") or "")
        password = str(body.get("password") or "")
        if not PASSWORD:
            self._json({"ok": False, "error": "This drive has no panel password yet."}, 403)
            return
        if not _same(user, USER) or not _same(password, PASSWORD):
            note_fail(ip)
            self._json({"ok": False, "error": "User or password did not match."}, 401)
            return
        clear_fails(ip)
        token = new_session()
        secure = self.headers.get("X-Forwarded-Proto", "") == "https"
        flag = "; Secure" if secure else ""
        self._json(
            {"ok": True, "user": USER},
            headers={"Set-Cookie": f"bndz_session={token}; HttpOnly; Path=/; SameSite=Lax{flag}"},
        )

    def _logout(self) -> None:
        cookies = cookie_map(self.headers.get("Cookie"))
        token = cookies.get("bndz_session")
        if token:
            with LOCK:
                SESSIONS.pop(token, None)
        self._json({"ok": True}, headers={"Set-Cookie": "bndz_session=; HttpOnly; Path=/; Max-Age=0"})

    def _me(self) -> None:
        used = total = 0
        try:
            usage = shutil.disk_usage(DATA)
            used, total = usage.used, usage.total
        except OSError:
            pass
        self._json({"ok": True, "user": USER, "used": used, "total": total, "mounted": DATA.is_dir()})

    def _list(self, rel: str) -> None:
        folder = safe(rel)
        if not folder.exists() or not folder.is_dir():
            raise FileNotFoundError(rel)
        rows = []
        for child in sorted(folder.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
            if child.name == ".bndz" or child.is_symlink():
                continue
            rows.append(entry(child))
        self._json({"ok": True, "path": rel_of(folder), "entries": rows})

    def _archive(self) -> None:
        """Portable tar of /data. Symlinks are skipped so the archive cannot escape the disk."""
        self.close_connection = True
        self.send_response(200)
        self.send_header("Content-Type", "application/x-tar")
        self.send_header("Content-Disposition", 'attachment; filename="bndz-data.tar"')
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        root = DATA.resolve()
        with tarfile.open(fileobj=self.wfile, mode="w|") as tar:
            for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
                kept = []
                for name in dirnames:
                    child = Path(dirpath) / name
                    if child.is_symlink():
                        continue
                    kept.append(name)
                dirnames[:] = kept
                for name in filenames:
                    full = Path(dirpath) / name
                    if full.is_symlink() or not full.is_file():
                        continue
                    try:
                        rel = full.resolve().relative_to(root).as_posix()
                    except ValueError:
                        continue
                    tar.add(str(full), arcname=rel, recursive=False)

    def _download(self, rel: str) -> None:
        path = safe(rel)
        if not path.is_file():
            raise FileNotFoundError(rel)
        data = path.read_bytes()
        name = path.name.replace('"', "")
        self._bytes(data, "application/octet-stream", extra={"Content-Disposition": f'attachment; filename="{name}"'})

    def _mkdir(self) -> None:
        body = self._json_body()
        parent = safe(str(body.get("path") or ""))
        name = _clean_name(str(body.get("name") or ""))
        dest = safe(rel_of(parent) + "/" + name)
        dest.mkdir(parents=False, exist_ok=False)
        self._json({"ok": True, "path": rel_of(dest)})

    def _rename(self) -> None:
        body = self._json_body()
        src = safe(str(body.get("from") or ""))
        if src == DATA.resolve():
            raise PermissionError("The drive root cannot be renamed.")
        parent = src.parent
        name = _clean_name(str(body.get("name") or ""))
        dest = safe(rel_of(parent) + "/" + name)
        src.rename(dest)
        self._json({"ok": True, "path": rel_of(dest)})

    def _delete(self) -> None:
        body = self._json_body()
        target = safe(str(body.get("path") or ""))
        if target == DATA.resolve():
            raise PermissionError("The drive root cannot be deleted.")
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
        self._json({"ok": True})

    def _upload(self) -> None:
        ctype = self.headers.get("Content-Type", "")
        length = int(self.headers.get("Content-Length") or "0")
        if length <= 0 or length > MAX_UPLOAD:
            self._json({"ok": False, "error": "Choose a file under 512 MB."}, 400)
            return
        body = self.rfile.read(length)
        match = re.search(r'boundary=(?:"([^"]+)"|([^;]+))', ctype)
        if not match:
            self._json({"ok": False, "error": "Upload was not a file form."}, 400)
            return
        boundary = (match.group(1) or match.group(2) or "").strip().encode()
        folder_rel, filename, blob = _parse_upload(body, boundary)
        folder = safe(folder_rel)
        if not folder.is_dir():
            raise FileNotFoundError(folder_rel)
        name = _clean_name(filename)
        dest = safe((rel_of(folder) + "/" + name).strip("/"))
        dest.write_bytes(blob)
        self._json({"ok": True, "path": rel_of(dest), "size": len(blob)})

    def _create_share(self) -> None:
        body = self._json_body()
        target = safe(str(body.get("path") or ""))
        if not target.exists():
            raise FileNotFoundError(str(body.get("path") or ""))
        try:
            hours = int(body.get("hours") or 24)
        except (TypeError, ValueError):
            hours = 24
        hours = min(720, max(1, hours))
        write = bool(body.get("write"))
        password = str(body.get("password") or "")
        row = {
            "id": secrets.token_hex(16),
            "path": rel_of(target),
            "expires": int(time.time() + hours * 3600),
            "write": write,
            "revoked": False,
            "views": 0,
            "created": int(time.time()),
            "passSalt": "",
            "passHash": "",
        }
        if password:
            salt, digest = hash_password(password)
            row["passSalt"] = salt
            row["passHash"] = digest
        rows = load_shares()
        rows.append(row)
        save_shares(rows)
        self._json({"ok": True, "share": _public_share(row)})

    def _revoke(self) -> None:
        body = self._json_body()
        token = str(body.get("id") or "")
        rows = load_shares()
        found = False
        for row in rows:
            if row.get("id") == token:
                row["revoked"] = True
                found = True
        if not found:
            self._json({"ok": False, "error": "That share is not on this drive."}, 404)
            return
        save_shares(rows)
        self._json({"ok": True})

    def _public_shares(self) -> list[dict]:
        return [_public_share(row) for row in load_shares()]

    def _share_qr(self, token: str) -> None:
        row = find_share(token)
        if not row:
            self._json({"ok": False, "error": "That share is not on this drive."}, 404)
            return
        url = _absolute(self, "/s/" + token)
        self._bytes(qr_svg(url), "image/svg+xml")

    def _share(self, method: str, path: str) -> None:
        rest = path[len("/s/") :]
        token, _, tail = rest.partition("/")
        if not re.fullmatch(r"[0-9a-f]{32}", token or ""):
            self._text("That share link is not valid.", 404)
            return
        row = find_share(token)
        if not row:
            self._text("That share link is not on this drive.", 404)
            return
        status = share_status(row)
        if status:
            self._text(status, 410)
            return
        if tail == "qr.svg" and method == "GET":
            self._bytes(qr_svg(_absolute(self, "/s/" + token)), "image/svg+xml")
            return
        if row.get("passHash"):
            if method == "POST" and tail == "":
                form = self._form_body()
                given = form.get("password", "")
                if not password_ok(given, row.get("passSalt") or "", row.get("passHash") or ""):
                    self._share_page(row, error="Password did not match.", authed=False)
                    return
                marker = secrets.token_hex(16)
                with LOCK:
                    SHARE_AUTH[token + ":" + marker] = time.time() + SESSION_TTL
                self.send_response(303)
                self.send_header("Location", "/s/" + token)
                self.send_header("Set-Cookie", f"bndz_share={token}.{marker}; HttpOnly; Path=/s/{token}; SameSite=Lax")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            if not self._share_cookie_ok(token):
                self._share_page(row, error="", authed=False)
                return
        base = safe(str(row.get("path") or ""))
        if method == "POST" and tail == "upload":
            if not row.get("write"):
                self._text("This link is read-only.", 403)
                return
            self._share_upload(row, base)
            return
        if method == "GET" and (tail == "raw" or tail.startswith("raw/")):
            inner = "" if tail == "raw" else unquote(tail[4:])
            target = base if base.is_file() else _under(base, inner)
            if not target.is_file():
                self._text("That file is not in the share.", 404)
                return
            bump_view(token)
            name = target.name.replace('"', "")
            self._bytes(target.read_bytes(), "application/octet-stream", extra={"Content-Disposition": f'attachment; filename="{name}"'})
            return
        if method == "GET" and tail == "":
            bump_view(token)
            self._share_page(row, error="", authed=True)
            return
        self._text("Not found.", 404)

    def _share_cookie_ok(self, token: str) -> bool:
        cookies = cookie_map(self.headers.get("Cookie"))
        raw = cookies.get("bndz_share", "")
        if "." not in raw:
            return False
        tid, marker = raw.split(".", 1)
        if not _same(tid, token):
            return False
        with LOCK:
            exp = SHARE_AUTH.get(token + ":" + marker)
            return bool(exp and exp >= time.time())

    def _share_upload(self, row: dict, base: Path) -> None:
        ctype = self.headers.get("Content-Type", "")
        length = int(self.headers.get("Content-Length") or "0")
        if length <= 0 or length > MAX_UPLOAD:
            self._text("Choose a file under 512 MB.", 400)
            return
        body = self.rfile.read(length)
        match = re.search(r'boundary=(?:"([^"]+)"|([^;]+))', ctype)
        if not match:
            self._text("Upload was not a file form.", 400)
            return
        boundary = (match.group(1) or match.group(2) or "").strip().encode()
        _folder, filename, blob = _parse_upload(body, boundary)
        folder = base if base.is_dir() else base.parent
        dest = _under(folder, _clean_name(filename))
        dest.write_bytes(blob)
        self.send_response(303)
        self.send_header("Location", "/s/" + row["id"])
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _share_page(self, row: dict, error: str, authed: bool) -> None:
        token = row["id"]
        url = _absolute(self, "/s/" + token)
        title = Path(str(row.get("path") or "drive")).name or "Drive"
        if not authed:
            body = (
                "<form method='post'>"
                "<label>Password <input type='password' name='password' autocomplete='off'></label>"
                "<button type='submit'>Open</button></form>"
            )
            if error:
                body = f"<p class='err'>{_esc(error)}</p>" + body
        else:
            base = safe(str(row.get("path") or ""))
            body = _share_listing(token, base, bool(row.get("write")))
        page = (
            "<!doctype html><html><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            f"<title>{_esc(title)}</title><link rel='stylesheet' href='/app.css'></head><body>"
            "<main class='share'><p class='seal'>BNDZ drive</p>"
            f"<h1>{_esc(title)}</h1>"
            + (f"<img class='qr' alt='QR code for this share' src='/s/{token}/qr.svg'>" if authed else "")
            + f"<p class='url'>{_esc(url)}</p>{body}</main></body></html>"
        )
        data = page.encode("utf-8")
        self._bytes(data, "text/html; charset=utf-8")

    def _json_body(self) -> dict:
        length = int(self.headers.get("Content-Length") or "0")
        if length <= 0 or length > 1_000_000:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return {}
        return data if isinstance(data, dict) else {}

    def _form_body(self) -> dict[str, str]:
        length = int(self.headers.get("Content-Length") or "0")
        if length <= 0 or length > 100_000:
            return {}
        raw = self.rfile.read(length).decode("utf-8", "replace")
        parsed = parse_qs(raw, keep_blank_values=True)
        return {k: v[0] if v else "" for k, v in parsed.items()}

    def _json(self, payload: dict, status: int = 200, headers: dict | None = None) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        if headers:
            for k, v in headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _text(self, text: str, status: int) -> None:
        data = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _bytes(self, data: bytes, content_type: str, extra: dict | None = None) -> None:
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        if extra:
            for k, v in extra.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _file(self, path: Path, content_type: str) -> None:
        if not path.is_file():
            self._text("Panel file missing.", 500)
            return
        self._bytes(path.read_bytes(), content_type)


def _public_share(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "path": row.get("path") or "",
        "expires": row.get("expires"),
        "write": bool(row.get("write")),
        "revoked": bool(row.get("revoked")),
        "views": int(row.get("views") or 0),
        "locked": bool(row.get("passHash")),
        "url": "/s/" + str(row.get("id") or ""),
    }


def _absolute(handler: BaseHTTPRequestHandler, path: str) -> str:
    proto = handler.headers.get("X-Forwarded-Proto") or "http"
    host = handler.headers.get("X-Forwarded-Host") or handler.headers.get("Host") or "localhost"
    return f"{proto}://{host}{path}"


def _clean_name(name: str) -> str:
    name = name.replace("\\", "/").split("/")[-1].strip()
    if not name or name in (".", "..") or name == ".bndz":
        raise PermissionError("Choose a file name.")
    return name


def _under(base: Path, name: str) -> Path:
    dest = (base / name).resolve()
    root = base.resolve()
    if dest != root and root not in dest.parents:
        raise PermissionError("That path is outside the share.")
    return dest


def _parse_upload(body: bytes, boundary: bytes) -> tuple[str, str, bytes]:
    marker = b"--" + boundary
    folder = ""
    filename = ""
    blob = b""
    for part in body.split(marker):
        if b"Content-Disposition" not in part:
            continue
        head, _, content = part.partition(b"\r\n\r\n")
        if content.endswith(b"\r\n"):
            content = content[:-2]
        text = head.decode("utf-8", "replace")
        name_m = re.search(r'name="([^"]+)"', text)
        file_m = re.search(r'filename="([^"]*)"', text)
        field = name_m.group(1) if name_m else ""
        if field == "dir":
            folder = content.decode("utf-8", "replace").strip()
        elif file_m:
            filename = file_m.group(1)
            blob = content
    if not filename:
        raise PermissionError("Choose a file.")
    return folder, filename, blob


def _esc(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _share_listing(token: str, base: Path, write: bool) -> str:
    if base.is_file():
        href = f"/s/{token}/raw"
        return f"<p><a class='file' href='{href}'>Download {_esc(base.name)}</a></p>"
    rows = []
    if base.is_dir():
        for child in sorted(base.iterdir(), key=lambda p: p.name.lower()):
            if child.name == ".bndz" or child.is_symlink() or child.is_dir():
                if child.is_dir() and not child.is_symlink() and child.name != ".bndz":
                    rows.append(f"<li>{_esc(child.name)}/</li>")
                continue
            href = f"/s/{token}/raw/{quote(child.name)}"
            rows.append(f"<li><a href='{href}'>{_esc(child.name)}</a></li>")
    upload = ""
    if write:
        upload = (
            "<form method='post' action='upload' enctype='multipart/form-data'>"
            "<input type='file' name='file' required><button type='submit'>Upload</button></form>"
        )
    return "<ul class='files'>" + "".join(rows) + "</ul>" + upload


def main() -> None:
    if not DATA.exists():
        DATA.mkdir(parents=True, exist_ok=True)
    httpd = ThreadingHTTPServer((HOST, PORT), Panel)
    sys.stderr.write(f"BNDZ panel listening on {HOST}:{PORT}\n")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
