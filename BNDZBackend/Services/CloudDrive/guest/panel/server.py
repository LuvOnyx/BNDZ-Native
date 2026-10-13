#!/usr/bin/env python3
"""BNDZ Cloud Drive web panel.

Stdlib HTTP server for the guest. Files live under /data. Settings live in
/data/.bndz/admin.json: display name, web sign-in, password, share defaults,
session length, and protocol switches. Share links are served by this process.

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
import socket
import stat
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
CHUNK_BYTES = 90 * 1024 * 1024
MAX_UPLOAD = CHUNK_BYTES
# After an early reject the panel sends Connection: close, then discards what the client is still
# sending for a short while so the response is not lost to a TCP reset, then closes.
LINGER_SECONDS = 5.0
LINGER_BYTES = CHUNK_BYTES + 16 * 1024 * 1024
READ_BLOCK = 1024 * 1024


class BodyTooLarge(Exception):
    """The request body is over the cap for this route."""


class BadBody(Exception):
    """The request body is malformed or ended early."""

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


def admin_path() -> Path:
    return store_path().with_name("admin.json")


def load_admin() -> dict:
    path = admin_path()
    base = {
        "displayName": "",
        "brandName": "BNDZ Drive",
        "username": "",
        "passSalt": "",
        "passHash": "",
        "sessionHours": 12,
        "shareHours": 24,
        "shareWrite": False,
        "protocols": {"ssh": True, "ftps": True, "webdav": True},
    }
    if not path.exists():
        return base
    try:
        data = json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return base
    if not isinstance(data, dict):
        return base
    base.update({k: data[k] for k in base if k in data and k != "protocols"})
    protocols = data.get("protocols")
    if isinstance(protocols, dict):
        for key in ("ssh", "ftps", "webdav"):
            if key in protocols:
                base["protocols"][key] = bool(protocols[key])
    return base


def save_admin(cfg: dict) -> None:
    path = admin_path()
    stored = {
        "displayName": _clip(str(cfg.get("displayName") or ""), 64),
        "brandName": _clip(str(cfg.get("brandName") or "BNDZ Drive"), 64) or "BNDZ Drive",
        "username": str(cfg.get("username") or ""),
        "passSalt": str(cfg.get("passSalt") or ""),
        "passHash": str(cfg.get("passHash") or ""),
        "sessionHours": _hours(cfg.get("sessionHours"), 12, 168),
        "shareHours": _hours(cfg.get("shareHours"), 24, 720),
        "shareWrite": bool(cfg.get("shareWrite")),
        "protocols": {
            "ssh": bool((cfg.get("protocols") or {}).get("ssh", True)),
            "ftps": bool((cfg.get("protocols") or {}).get("ftps", True)),
            "webdav": bool((cfg.get("protocols") or {}).get("webdav", True)),
        },
    }
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(stored, indent=2), "utf-8")
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, path)


def public_admin(cfg: dict | None = None) -> dict:
    cfg = cfg or load_admin()
    used = total = 0
    try:
        usage = shutil.disk_usage(DATA)
        used, total = usage.used, usage.total
    except OSError:
        pass
    return {
        "ok": True,
        "username": panel_user(cfg),
        "osUser": USER,
        "displayName": cfg.get("displayName") or "",
        "brandName": cfg.get("brandName") or "BNDZ Drive",
        "sessionHours": _hours(cfg.get("sessionHours"), 12, 168),
        "shareHours": _hours(cfg.get("shareHours"), 24, 720),
        "shareWrite": bool(cfg.get("shareWrite")),
        "protocols": cfg.get("protocols") or {"ssh": True, "ftps": True, "webdav": True},
        "publicHost": public_host(),
        "used": used,
        "total": total,
        "mounted": DATA.is_dir(),
        "accountNote": (
            "The web sign-in name is yours. SSH still uses the drive account "
            + USER
            + " and the key BNDZ stored. The password you set here is the web password."
        ),
    }


def panel_user(cfg: dict | None = None) -> str:
    cfg = cfg or load_admin()
    name = str(cfg.get("username") or "").strip()
    return name or USER


def session_ttl() -> float:
    return _hours(load_admin().get("sessionHours"), 12, 168) * 3600


def check_password(password: str, cfg: dict | None = None) -> bool:
    cfg = cfg or load_admin()
    salt = str(cfg.get("passSalt") or "")
    digest = str(cfg.get("passHash") or "")
    if salt and digest:
        return password_ok(password, salt, digest)
    if not PASSWORD:
        return False
    return _same(password, PASSWORD)


_IPV4 = re.compile(r"^(?:\d{1,3}\.){3}\d{1,3}$")


def _bad_public_host(host: str) -> bool:
    bare = host.split(":")[0].strip().lower().rstrip(".")
    if not bare or bare.endswith(".fly.dev") or bare in ("localhost", "127.0.0.1", "::1"):
        return True
    return _IPV4.match(bare) is not None


def path_prefix() -> str:
    raw = os.environ.get("BNDZ_PATH_PREFIX", "").strip().strip("/")
    if not raw or "/" in raw or not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,59}[a-z0-9])?", raw):
        return ""
    return "/" + raw


def session_cookie_path() -> str:
    prefix = path_prefix()
    return (prefix + "/") if prefix else "/"


def slug_redirects() -> dict[str, str]:
    found: dict[str, str] = {}
    raw = os.environ.get("BNDZ_SLUG_REDIRECTS", "")
    for part in raw.split(","):
        if ":" not in part:
            continue
        src, dst = part.split(":", 1)
        src = src.strip().strip("/")
        dst = dst.strip().strip("/")
        if re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,59}[a-z0-9])?", src or "") and re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,59}[a-z0-9])?", dst or ""):
            found[src] = dst
    return found


def public_host() -> str:
    host = os.environ.get("BNDZ_PUBLIC_HOST", "").strip().lower().rstrip(".")
    if _bad_public_host(host):
        return ""
    return host


def guest_can_manage() -> bool:
    if os.environ.get("BNDZ_PANEL_APPLY_UNITS") == "1":
        return True
    geteuid = getattr(os, "geteuid", None)
    return bool(geteuid and geteuid() == 0 and Path("/opt/bndz/panel/server.py").is_file())


def apply_protocols(protocols: dict) -> str:
    if not guest_can_manage():
        return "Saved on this disk. This process did not stop or start a service. On the guest, SSH, FTPS, and WebDAV follow these switches."
    units = {"ssh": ("ssh", "sshd"), "ftps": ("vsftpd",), "webdav": ("apache2",)}
    notes = []
    for key, names in units.items():
        enabled = bool(protocols.get(key, True))
        verb = "start" if enabled else "stop"
        acted = False
        for unit in names:
            if shutil.which("systemctl") is None:
                break
            proc = subprocess_quiet(["systemctl", verb, unit])
            if proc == 0:
                acted = True
                break
        notes.append(key.upper() + (" is on." if enabled else " is off.") + ("" if acted else " The unit was not changed."))
    return " ".join(notes)


def sync_os_password(password: str) -> str:
    if not guest_can_manage():
        return "Panel password saved. This process did not change the drive account password."
    if shutil.which("chpasswd") is None:
        return "Panel password saved. chpasswd is not on this guest, so FTPS was not updated."
    proc = subprocess_quiet(["chpasswd"], input_text=USER + ":" + password + "\n")
    if proc != 0:
        return "Panel password saved. The drive account password was not updated."
    if shutil.which("htpasswd"):
        subprocess_quiet(["htpasswd", "-bc", "/etc/bndz/webdav.passwd", USER, password])
    return "Panel password saved, and the drive account password used by FTPS and WebDAV was updated."


def subprocess_quiet(args: list[str], input_text: str | None = None) -> int:
    import subprocess

    try:
        result = subprocess.run(
            args,
            input=input_text,
            text=True,
            capture_output=True,
            timeout=8,
            check=False,
        )
        return result.returncode
    except (OSError, subprocess.TimeoutExpired):
        return 1


def _clip(text: str, limit: int) -> str:
    text = " ".join(text.replace("\r", " ").replace("\n", " ").split())
    return text[:limit]


def _hours(value, default: int, cap: int) -> int:
    try:
        hours = int(value)
    except (TypeError, ValueError):
        hours = default
    return min(cap, max(1, hours))


def _valid_user(name: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z][A-Za-z0-9._-]{0,31}", name))


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


def _byte_range(header: str, size: int) -> tuple[int, int] | str | None:
    text = (header or "").strip()
    if not text:
        return None
    if not text.lower().startswith("bytes="):
        return None
    spec = text.split("=", 1)[1].split(",", 1)[0].strip()
    if "-" not in spec:
        return "unsat"
    start_s, end_s = spec.split("-", 1)
    if size <= 0:
        return "unsat"
    if start_s == "":
        try:
            count = int(end_s)
        except ValueError:
            return "unsat"
        if count <= 0:
            return "unsat"
        count = min(count, size)
        return (size - count, size - 1)
    try:
        start = int(start_s)
    except ValueError:
        return "unsat"
    if start < 0 or start >= size:
        return "unsat"
    if end_s == "":
        end = size - 1
    else:
        try:
            end = int(end_s)
        except ValueError:
            return "unsat"
        if end < start:
            return "unsat"
        end = min(end, size - 1)
    return (start, end)


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
        SESSIONS[token] = time.time() + session_ttl()
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
        SESSIONS[token] = now + session_ttl()
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
        if getattr(self, "_linger", False):
            self._linger_close()

    def send_response(self, code: int, message: str | None = None) -> None:
        self._sent_connection = False
        super().send_response(code, message)

    def send_header(self, keyword: str, value: str) -> None:
        if keyword.lower() == "connection":
            self._sent_connection = True
        super().send_header(keyword, value)

    def end_headers(self) -> None:
        # A reply that leaves request body bytes unread cannot keep the connection: the leftover
        # bytes would be parsed as the next request. Tell the client and close after replying.
        if self._body_pending():
            if not getattr(self, "_sent_connection", False):
                self.send_header("Connection", "close")
            self.close_connection = True
            self._linger = True
        super().end_headers()

    def _linger_close(self) -> None:
        self._linger = False
        try:
            self.wfile.flush()
            sock = self.connection
            sock.shutdown(socket.SHUT_WR)
        except OSError:
            return
        deadline = time.monotonic() + LINGER_SECONDS
        drained = 0
        try:
            while drained < LINGER_BYTES:
                left = deadline - time.monotonic()
                if left <= 0:
                    break
                sock.settimeout(left)
                data = sock.recv(65536)
                if not data:
                    break
                drained += len(data)
        except OSError:
            pass

    def _chunked(self) -> bool:
        raw = (self.headers.get("Transfer-Encoding") or "").strip().lower()
        if not raw:
            return False
        codings = [part.strip() for part in raw.split(",") if part.strip()]
        if not codings or codings[-1] != "chunked":
            raise BadBody("Transfer-Encoding " + raw + " is not supported.")
        return True

    def _content_length(self) -> int:
        raw = (self.headers.get("Content-Length") or "").strip()
        if not raw:
            return 0
        if not raw.isdigit():
            return -1
        return int(raw)

    def _body_pending(self) -> bool:
        if getattr(self, "_body_consumed", True):
            return False
        try:
            if self._chunked():
                return True
        except BadBody:
            return True
        return self._content_length() != 0

    def _body_chunks(self, limit: int):
        """Yield the request body in blocks, from Content-Length or Transfer-Encoding: chunked.

        Raises BodyTooLarge as soon as the declared or received size passes limit, before those
        bytes are read. Raises BadBody when the framing is broken or the body ends early.
        """
        if self._chunked():
            total = 0
            while True:
                line = self.rfile.readline(1026)
                if not line.endswith(b"\n"):
                    raise BadBody("chunk size line is missing or too long")
                size_text = line.split(b";", 1)[0].strip()
                if not size_text or any(c not in b"0123456789abcdefABCDEF" for c in size_text):
                    raise BadBody("chunk size is not hex")
                size = int(size_text, 16)
                if size == 0:
                    for _ in range(64):
                        trailer = self.rfile.readline(8192)
                        if trailer in (b"\r\n", b"\n"):
                            self._body_consumed = True
                            return
                        if not trailer.endswith(b"\n"):
                            raise BadBody("chunked trailer ended early")
                    raise BadBody("too many chunked trailers")
                if total + size > limit:
                    raise BodyTooLarge()
                remaining = size
                while remaining:
                    block = self.rfile.read(min(remaining, READ_BLOCK))
                    if not block:
                        raise BadBody("chunked body ended early")
                    remaining -= len(block)
                    total += len(block)
                    yield block
                if self.rfile.readline(3) not in (b"\r\n", b"\n"):
                    raise BadBody("chunk is not followed by CRLF")
        length = self._content_length()
        if length < 0:
            raise BadBody("Content-Length is not a number")
        if length > limit:
            raise BodyTooLarge()
        remaining = length
        while remaining:
            block = self.rfile.read(min(remaining, READ_BLOCK))
            if not block:
                raise BadBody("body ended early")
            remaining -= len(block)
            yield block
        self._body_consumed = True

    def _read_body(self, limit: int) -> bytes:
        return b"".join(self._body_chunks(limit))

    def do_GET(self) -> None:
        self._route("GET")

    def do_POST(self) -> None:
        self._route("POST")

    def do_PUT(self) -> None:
        self._route("PUT")

    def _route(self, method: str) -> None:
        self._body_consumed = False
        self._linger = False
        try:
            parsed = urlparse(self.path)
            path = unquote(parsed.path)
            query = parse_qs(parsed.query)
            if self._origin_blocked():
                host = public_host() or "cloud.bndz.org"
                prefix = path_prefix()
                where = "https://" + host + (prefix + "/" if prefix else "/")
                self._text("This address is not the drive link. Open " + where, 404)
                return
            target = self._redirect_target(path)
            if target:
                self.send_response(301)
                self.send_header("Location", target)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            path = self._strip_prefix(path)
            if path == "/api/health":
                brand = load_admin().get("brandName") or "BNDZ Drive"
                self._json({"ok": True, "data": str(DATA), "mounted": DATA.is_dir(), "brandName": brand, "publicHost": public_host()})
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
            if path == "/api/admin" and method == "GET":
                self._json(public_admin())
                return
            if path == "/api/admin" and method == "POST":
                self._save_admin()
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
            if path == "/api/upload/start" and method == "POST":
                self._upload_start()
                return
            if path == "/api/upload/chunk" and method == "PUT":
                self._upload_chunk(query)
                return
            if path == "/api/upload/status" and method == "GET":
                self._upload_status(query)
                return
            if path == "/api/upload/finish" and method == "POST":
                self._upload_finish()
                return
            if path == "/api/props" and method == "GET":
                self._props(query.get("path", [""])[0])
                return
            if path == "/api/copy" and method == "POST":
                self._transfer(move=False)
                return
            if path == "/api/move" and method == "POST":
                self._transfer(move=True)
                return
            self._json({"ok": False, "error": "Not found."}, 404)
        except BodyTooLarge:
            self._json({"ok": False, "error": "That request is larger than 90 MB."}, 413)
        except BadBody:
            self._json({"ok": False, "error": "The request body was cut off or malformed."}, 400)
        except PermissionError as ex:
            self._json({"ok": False, "error": str(ex)}, 400)
        except FileExistsError:
            self._json({"ok": False, "error": "An item with that name is already there."}, 400)
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
        cfg = load_admin()
        if not (cfg.get("passHash") or PASSWORD):
            self._json({"ok": False, "error": "This drive has no panel password yet."}, 403)
            return
        if not _same(user, panel_user(cfg)) or not check_password(password, cfg):
            note_fail(ip)
            self._json({"ok": False, "error": "User or password did not match."}, 401)
            return
        clear_fails(ip)
        token = new_session()
        secure = self.headers.get("X-Forwarded-Proto", "") == "https" or bool(public_host())
        flag = "; Secure" if secure else ""
        self._json(
            {"ok": True, "user": panel_user(cfg)},
            headers={"Set-Cookie": f"bndz_session={token}; HttpOnly; Path={session_cookie_path()}; SameSite=Lax{flag}"},
        )

    def _logout(self) -> None:
        cookies = cookie_map(self.headers.get("Cookie"))
        token = cookies.get("bndz_session")
        if token:
            with LOCK:
                SESSIONS.pop(token, None)
        self._json({"ok": True}, headers={"Set-Cookie": f"bndz_session=; HttpOnly; Path={session_cookie_path()}; Max-Age=0"})

    def _me(self) -> None:
        info = public_admin()
        self._json({
            "ok": True,
            "user": info["username"],
            "displayName": info["displayName"],
            "brandName": info["brandName"],
            "used": info["used"],
            "total": info["total"],
            "mounted": info["mounted"],
            "publicHost": info["publicHost"],
            "shareHours": info["shareHours"],
            "shareWrite": info["shareWrite"],
        })

    def _save_admin(self) -> None:
        body = self._json_body()
        cfg = load_admin()
        current = str(body.get("currentPassword") or "")
        new_password = str(body.get("newPassword") or "")
        confirm = str(body.get("confirmPassword") or "")
        username = body.get("username")
        wants_account = new_password != "" or (isinstance(username, str) and username.strip() and username.strip() != panel_user(cfg))
        if wants_account:
            if not check_password(current, cfg):
                note_fail(client_ip(self))
                self._json({"ok": False, "error": "Current password did not match."}, 401)
                return
            clear_fails(client_ip(self))
        if isinstance(username, str) and username.strip():
            cleaned = username.strip()
            if not _valid_user(cleaned):
                self._json({"ok": False, "error": "Use a sign-in name that starts with a letter. Letters, numbers, dot, dash, and underscore only."}, 400)
                return
            cfg["username"] = cleaned
        if "displayName" in body:
            cfg["displayName"] = _clip(str(body.get("displayName") or ""), 64)
        if "brandName" in body:
            brand = _clip(str(body.get("brandName") or ""), 64)
            cfg["brandName"] = brand or "BNDZ Drive"
        if "sessionHours" in body:
            cfg["sessionHours"] = _hours(body.get("sessionHours"), 12, 168)
        if "shareHours" in body:
            cfg["shareHours"] = _hours(body.get("shareHours"), 24, 720)
        if "shareWrite" in body:
            cfg["shareWrite"] = bool(body.get("shareWrite"))
        protocols = body.get("protocols")
        protocol_note = ""
        if isinstance(protocols, dict):
            current_protocols = dict(cfg.get("protocols") or {})
            for key in ("ssh", "ftps", "webdav"):
                if key in protocols:
                    current_protocols[key] = bool(protocols[key])
            cfg["protocols"] = current_protocols
            protocol_note = apply_protocols(current_protocols)
        password_note = ""
        if new_password:
            if new_password != confirm:
                self._json({"ok": False, "error": "The new passwords did not match."}, 400)
                return
            if len(new_password) < 8:
                self._json({"ok": False, "error": "Use at least 8 characters."}, 400)
                return
            if new_password == current:
                self._json({"ok": False, "error": "Choose a different password."}, 400)
                return
            salt, digest = hash_password(new_password)
            cfg["passSalt"] = salt
            cfg["passHash"] = digest
            password_note = sync_os_password(new_password)
        save_admin(cfg)
        payload = public_admin(cfg)
        payload["protocolNote"] = protocol_note
        payload["passwordNote"] = password_note
        self._json(payload)

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
        name = path.name.replace('"', "")
        self._stream_file(path, "application/octet-stream", {"Content-Disposition": f'attachment; filename="{name}"'})

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
        raw_paths = body.get("paths")
        if isinstance(raw_paths, list) and raw_paths:
            targets = [safe(str(item)) for item in raw_paths]
        else:
            targets = [safe(str(body.get("path") or ""))]
        for target in targets:
            _remove_path(target)
        self._json({"ok": True})

    def _props(self, rel: str) -> None:
        path = safe(rel)
        if not path.exists():
            raise FileNotFoundError(rel)
        if path.is_symlink():
            raise PermissionError("Links are not followed.")
        st = path.stat()
        children = 0
        if path.is_dir():
            children = sum(1 for child in path.iterdir() if child.name != ".bndz" and not child.is_symlink())
        self._json({
            "ok": True,
            "name": path.name or "Drive",
            "path": rel_of(path),
            "dir": path.is_dir(),
            "size": 0 if path.is_dir() else st.st_size,
            "mtime": int(st.st_mtime),
            "mode": stat.filemode(st.st_mode),
            "children": children,
        })

    def _transfer(self, move: bool) -> None:
        body = self._json_body()
        dest_dir = safe(str(body.get("dest") or ""))
        if not dest_dir.is_dir():
            raise FileNotFoundError(str(body.get("dest") or ""))
        raw_paths = body.get("paths")
        if isinstance(raw_paths, str):
            raw_paths = [raw_paths]
        if not isinstance(raw_paths, list) or not raw_paths:
            raise PermissionError("Nothing to paste.")
        made = []
        for raw in raw_paths:
            src = safe(str(raw))
            if src == DATA.resolve() or src.is_symlink():
                raise PermissionError("That item cannot be pasted.")
            if src.is_dir() and (dest_dir == src or src in dest_dir.parents or _contains(src, dest_dir)):
                raise PermissionError("A folder cannot be pasted into itself.")
            if move and src.parent.resolve() == dest_dir.resolve():
                raise PermissionError(src.name + " is already in this folder.")
            if move:
                target = safe((rel_of(dest_dir) + "/" + src.name).strip("/"))
                if target.exists():
                    raise PermissionError(src.name + " is already in that folder.")
                try:
                    src.rename(target)
                except OSError:
                    _copy_path(src, target)
                    _remove_path(src)
            else:
                target = _unique_dest(dest_dir, src.name)
                _copy_path(src, target)
            made.append(rel_of(target))
        self._json({"ok": True, "paths": made})

    def _upload(self) -> None:
        ctype = self.headers.get("Content-Type", "")
        try:
            body = self._read_body(MAX_UPLOAD)
        except BodyTooLarge:
            body = b""
        if not body:
            self._json({"ok": False, "error": "Choose a file under 90 MB. Larger files upload in pieces."}, 400)
            return
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
            self._stream_file(target, "application/octet-stream", {"Content-Disposition": f'attachment; filename="{name}"'})
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
        try:
            body = self._read_body(MAX_UPLOAD)
        except (BodyTooLarge, BadBody):
            body = b""
        if not body:
            self._text("Choose a file under 90 MB.", 400)
            return
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
            "<main class='share'><p class='seal'>" + _esc(str(load_admin().get("brandName") or "BNDZ Drive")) + "</p>"
            f"<h1>{_esc(title)}</h1>"
            + (f"<img class='qr' alt='QR code for this share' src='/s/{token}/qr.svg'>" if authed else "")
            + f"<p class='url'>{_esc(url)}</p>{body}</main></body></html>"
        )
        data = page.encode("utf-8")
        self._bytes(data, "text/html; charset=utf-8")

    def _json_body(self) -> dict:
        try:
            raw = self._read_body(1_000_000)
        except (BodyTooLarge, BadBody):
            return {}
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return {}
        return data if isinstance(data, dict) else {}

    def _form_body(self) -> dict[str, str]:
        try:
            raw = self._read_body(100_000).decode("utf-8", "replace")
        except (BodyTooLarge, BadBody):
            return {}
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

    def _stream_file(self, path: Path, content_type: str, extra: dict | None = None) -> None:
        size = path.stat().st_size
        span = _byte_range(self.headers.get("Range") or "", size)
        headers = {"Accept-Ranges": "bytes"}
        if extra:
            headers.update(extra)
        if span == "unsat":
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.send_header("Accept-Ranges", "bytes")
            self.end_headers()
            return
        if span is None:
            start, length, status = 0, size, 200
        else:
            start, end = span
            length = end - start + 1
            status = 206
            headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "private, no-store")
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()
        if length <= 0:
            return
        with path.open("rb") as handle:
            handle.seek(start)
            left = length
            while left:
                blob = handle.read(min(65536, left))
                if not blob:
                    break
                self.wfile.write(blob)
                left -= len(blob)

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

    def _origin_blocked(self) -> bool:
        host = (self.headers.get("Host") or "").split(":")[0].strip().lower()
        local = host in ("", "127.0.0.1", "localhost", "::1")
        secret = os.environ.get("BNDZ_ORIGIN_SECRET", "").strip()
        if secret:
            if local:
                return False
            presented = (self.headers.get("X-Bndz-Origin") or "").strip()
            if len(presented) != len(secret):
                return True
            return not hmac.compare_digest(presented, secret)
        flag = os.environ.get("BNDZ_ROUTE_GUARD", "").strip().lower()
        if flag not in ("1", "true", "yes"):
            return False
        if (self.headers.get("X-Bndz-Route") or "").strip():
            return False
        return not local

    def _redirect_target(self, path: str) -> str:
        redirects = slug_redirects()
        trimmed = path.strip("/")
        if not trimmed or not redirects:
            return ""
        first, _, rest = trimmed.partition("/")
        dest = redirects.get(first)
        if not dest:
            return ""
        host = public_host() or "cloud.bndz.org"
        suffix = ("/" + rest) if rest else "/"
        return "https://" + host + "/" + dest + suffix

    def _strip_prefix(self, path: str) -> str:
        prefix = path_prefix()
        if not prefix:
            return path
        if path == prefix:
            return "/"
        if path.startswith(prefix + "/"):
            return path[len(prefix) :] or "/"
        return path

    def _upload_dir(self, upload_id: str) -> Path:
        if not re.fullmatch(r"[0-9a-f]{32}", upload_id or ""):
            raise PermissionError("That upload is not on this drive.")
        root = (DATA / ".bndz" / "uploads" / upload_id).resolve()
        base = (DATA / ".bndz" / "uploads").resolve()
        if base not in root.parents:
            raise PermissionError("That upload is not on this drive.")
        return root

    def _read_meta(self, upload_id: str) -> tuple[Path, dict]:
        folder = self._upload_dir(upload_id)
        meta_path = folder / "meta.json"
        if not meta_path.is_file():
            raise FileNotFoundError(upload_id)
        meta = json.loads(meta_path.read_text())
        if not isinstance(meta, dict):
            raise PermissionError("That upload is not on this drive.")
        return folder, meta

    def _write_meta(self, folder: Path, meta: dict) -> None:
        (folder / "meta.json").write_text(json.dumps(meta))

    def _upload_start(self) -> None:
        body = self._json_body()
        folder = safe(str(body.get("dir") or ""))
        if not folder.is_dir():
            raise FileNotFoundError(str(body.get("dir") or ""))
        name = _clean_name(str(body.get("name") or ""))
        try:
            size = int(body.get("size") or 0)
        except (TypeError, ValueError):
            size = -1
        if size < 0:
            raise PermissionError("That file size is not usable.")
        upload_id = secrets.token_hex(16)
        meta = {"id": upload_id, "dir": rel_of(folder), "name": name, "size": size, "offset": 0}
        folder_path = DATA / ".bndz" / "uploads" / upload_id
        folder_path.mkdir(parents=True, exist_ok=False)
        self._write_meta(folder_path, meta)
        (folder_path / "part").write_bytes(b"")
        self._json({"ok": True, "id": upload_id, "offset": 0, "chunkSize": CHUNK_BYTES})

    def _upload_chunk(self, query: dict) -> None:
        upload_id = query.get("id", [""])[0]
        try:
            offset = int(query.get("offset", ["-1"])[0])
        except (TypeError, ValueError):
            offset = -1
        if self._content_length() > CHUNK_BYTES:
            self._json({"ok": False, "error": "That piece is larger than 90 MB."}, 400)
            return
        folder, meta = self._read_meta(upload_id)
        current = int(meta.get("offset") or 0)
        if offset != current:
            if not self._chunked():
                for _block in self._body_chunks(CHUNK_BYTES):
                    pass
            self._json({"ok": False, "error": "Upload offset does not match.", "offset": current}, 409)
            return
        # Stream straight to disk. The 90 MB cap is enforced while reading, so a chunked body that
        # runs over is cut off and the partial bytes are trimmed back off the part file.
        written = 0
        with (folder / "part").open("ab") as handle:
            start = handle.tell()
            try:
                for block in self._body_chunks(CHUNK_BYTES):
                    handle.write(block)
                    written += len(block)
            except (BodyTooLarge, BadBody) as ex:
                handle.truncate(start)
                if isinstance(ex, BodyTooLarge):
                    self._json({"ok": False, "error": "That piece is larger than 90 MB.", "offset": current}, 400)
                else:
                    self._json({"ok": False, "error": "That piece was cut off. Send it again.", "offset": current}, 400)
                return
        meta["offset"] = current + written
        self._write_meta(folder, meta)
        self._json({"ok": True, "id": upload_id, "offset": meta["offset"]})

    def _upload_status(self, query: dict) -> None:
        upload_id = query.get("id", [""])[0]
        _folder, meta = self._read_meta(upload_id)
        self._json({"ok": True, "id": upload_id, "offset": int(meta.get("offset") or 0), "size": int(meta.get("size") or 0), "chunkSize": CHUNK_BYTES})

    def _upload_finish(self) -> None:
        body = self._json_body()
        upload_id = str(body.get("id") or "")
        folder, meta = self._read_meta(upload_id)
        offset = int(meta.get("offset") or 0)
        size = int(meta.get("size") or 0)
        if offset != size:
            self._json({"ok": False, "error": "The upload is not complete.", "offset": offset}, 409)
            return
        dest_dir = safe(str(meta.get("dir") or ""))
        if not dest_dir.is_dir():
            raise FileNotFoundError(str(meta.get("dir") or ""))
        name = _clean_name(str(meta.get("name") or ""))
        dest = safe((rel_of(dest_dir) + "/" + name).strip("/"))
        part = folder / "part"
        os.replace(part, dest)
        shutil.rmtree(folder, ignore_errors=True)
        self._json({"ok": True, "path": rel_of(dest), "size": dest.stat().st_size if dest.is_file() else 0})

    def _file(self, path: Path, content_type: str) -> None:
        if not path.is_file():
            self._text("Panel file missing.", 500)
            return
        data = path.read_bytes()
        if path.name == "index.html":
            text = data.decode("utf-8")
            prefix = path_prefix()
            if prefix:
                text = text.replace('href="/app.css"', 'href="' + prefix + '/app.css"')
                text = text.replace('src="/app.js"', 'src="' + prefix + '/app.js"')
                text = text.replace("<head>", '<head><script>window.BNDZ_BASE=' + json.dumps(prefix) + ';</script>', 1)
            data = text.encode("utf-8")
        self._bytes(data, content_type)


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
    chosen = public_host()
    if chosen:
        return "https://" + chosen + path
    proto = handler.headers.get("X-Forwarded-Proto") or "http"
    host = handler.headers.get("X-Forwarded-Host") or handler.headers.get("Host") or ""
    host = host.split(",")[0].strip()
    if _bad_public_host(host):
        return path
    return f"{proto}://{host}{path}"


def _contains(parent: Path, child: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
    except ValueError:
        return False
    return child.resolve() != parent.resolve()


def _remove_path(target: Path) -> None:
    if target == DATA.resolve():
        raise PermissionError("The drive root cannot be deleted.")
    if target.is_symlink():
        raise PermissionError("Links are not removed.")
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()


def _copy_path(src: Path, dest: Path) -> None:
    if src.is_symlink():
        raise PermissionError("Links are not copied.")
    if src.is_dir():
        dest.mkdir(parents=False, exist_ok=False)
        for child in src.iterdir():
            if child.name == ".bndz" or child.is_symlink():
                continue
            _copy_path(child, dest / child.name)
        return
    if not src.is_file():
        raise PermissionError("That item cannot be copied.")
    shutil.copy2(src, dest)


def _unique_dest(dest_dir: Path, name: str) -> Path:
    clean = _clean_name(name)
    stem = Path(clean).stem
    suffix = Path(clean).suffix
    for n in range(0, 100):
        if n == 0:
            candidate = clean
        elif n == 1:
            candidate = f"{stem} - Copy{suffix}"
        else:
            candidate = f"{stem} - Copy ({n}){suffix}"
        dest = safe((rel_of(dest_dir) + "/" + candidate).strip("/"))
        if not dest.exists():
            return dest
    raise PermissionError("Could not find a free name.")


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
