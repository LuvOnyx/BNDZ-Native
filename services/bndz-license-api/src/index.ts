/**
 * BNDZ License API — Cloudflare Worker + D1
 *
 * POST /v1/activate   { serial, email, name, hwid, appVersion? }
 * POST /v1/deactivate { serial, hwid, token }
 * POST /v1/validate   { serial, hwid, token }
 * POST /v1/admin/issue  { count?, note? }     Authorization: Bearer <ADMIN_API_KEY>
 * POST /v1/admin/revoke { serial }            Authorization: Bearer <ADMIN_API_KEY>
 * GET  /health
 */

export interface Env {
  DB: D1Database;
  LICENSE_HMAC_SECRET: string;
  TOKEN_HMAC_SECRET: string;
  ADMIN_API_KEY: string;
}

type Json = Record<string, unknown>;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function json(data: Json, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    },
  });
}

function bad(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

async function readJson(req: Request): Promise<Json | null> {
  try {
    return (await req.json()) as Json;
  } catch {
    return null;
  }
}

function requireAdmin(req: Request, env: Env): boolean {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return !!env.ADMIN_API_KEY && token === env.ADMIN_API_KEY;
}

async function hmacHex(secret: string, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
}

function bytesToChecksum(hash: ArrayBuffer): string {
  const bytes = new Uint8Array(hash);
  let out = "";
  for (let i = 0; i < 4; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

async function computeSerialChecksum(payload: string, secret: string): Promise<string> {
  const hash = await hmacHex(secret, payload);
  return bytesToChecksum(hash);
}

function parseSerial(serialRaw: string): { serial: string; payload: string; checksum: string } | null {
  const serial = (serialRaw || "").trim().toUpperCase();
  const parts = serial.split("-");
  if (parts.length !== 4 || parts[0] !== "BNDZ") return null;
  for (let i = 1; i < 4; i++) {
    if (!parts[i] || parts[i]!.length !== 4 || !/^[A-Z0-9]+$/.test(parts[i]!)) return null;
  }
  return { serial, payload: `${parts[1]}-${parts[2]}`, checksum: parts[3]! };
}

async function validateSerialFormat(serial: string, secret: string): Promise<boolean> {
  const parsed = parseSerial(serial);
  if (!parsed) return false;
  const expected = await computeSerialChecksum(parsed.payload, secret);
  return expected === parsed.checksum;
}

function b64url(data: ArrayBuffer | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlJson(obj: unknown): string {
  return b64url(JSON.stringify(obj));
}

async function signToken(claims: Json, secret: string): Promise<string> {
  const header = b64urlJson({ alg: "HS256", typ: "JWT" });
  const payload = b64urlJson(claims);
  const sig = b64url(await hmacHex(secret, `${header}.${payload}`));
  return `${header}.${payload}.${sig}`;
}

async function verifyToken(token: string, secret: string): Promise<Json | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = b64url(await hmacHex(secret, `${header}.${payload}`));
  if (expected !== sig) return null;
  try {
    const jsonStr = atob(payload!.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(jsonStr) as Json;
  } catch {
    return null;
  }
}

function randomChunk(len = 4): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

async function mintSerial(secret: string): Promise<string> {
  const a = randomChunk(4);
  const b = randomChunk(4);
  const checksum = await computeSerialChecksum(`${a}-${b}`, secret);
  return `BNDZ-${a}-${b}-${checksum}`;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return json({ ok: true });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "GET" && (path === "/health" || path === "/")) {
      return json({ ok: true, service: "bndz-license-api", version: 1 });
    }

    if (!env.LICENSE_HMAC_SECRET || !env.TOKEN_HMAC_SECRET) {
      return bad("Server misconfigured: missing secrets", 500);
    }

    try {
      if (request.method === "POST" && path === "/v1/activate") {
        return await handleActivate(request, env);
      }
      if (request.method === "POST" && path === "/v1/deactivate") {
        return await handleDeactivate(request, env);
      }
      if (request.method === "POST" && path === "/v1/validate") {
        return await handleValidate(request, env);
      }
      if (request.method === "POST" && path === "/v1/admin/issue") {
        if (!requireAdmin(request, env)) return bad("Unauthorized", 401);
        return await handleIssue(request, env);
      }
      if (request.method === "POST" && path === "/v1/admin/revoke") {
        if (!requireAdmin(request, env)) return bad("Unauthorized", 401);
        return await handleRevoke(request, env);
      }
      return bad("Not found", 404);
    } catch (err) {
      console.error(JSON.stringify({ err: String(err) }));
      return bad("Internal error", 500);
    }
  },
};

async function handleActivate(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (!body) return bad("Invalid JSON");

  const serial = String(body.serial || "").trim().toUpperCase();
  const email = String(body.email || "").trim();
  const name = String(body.name || "").trim();
  const hwid = String(body.hwid || "").trim().toLowerCase();

  if (!serial || !email || !hwid) return bad("serial, email, and hwid are required");
  if (!(await validateSerialFormat(serial, env.LICENSE_HMAC_SECRET))) {
    return bad("Invalid serial number", 400);
  }

  const existingSerial = await env.DB.prepare(
    "SELECT serial, revoked_at FROM serials WHERE serial = ?",
  ).bind(serial).first<{ serial: string; revoked_at: string | null }>();

  if (!existingSerial) {
    // Auto-register well-formed serials on first activate (keys minted offline via generate-license.ps1).
    await env.DB.prepare(
      "INSERT INTO serials (serial, created_at, note) VALUES (?, ?, ?)",
    ).bind(serial, new Date().toISOString(), "auto-registered-on-activate").run();
  } else if (existingSerial.revoked_at) {
    return bad("This serial has been revoked", 403);
  }

  const active = await env.DB.prepare(
    "SELECT id, hwid FROM activations WHERE serial = ? AND deactivated_at IS NULL",
  ).bind(serial).first<{ id: string; hwid: string }>();

  if (active && active.hwid !== hwid) {
    return bad("This serial is already activated on another PC. Deactivate there first.", 409);
  }

  const now = new Date().toISOString();
  const jti = crypto.randomUUID();
  const claims = {
    sub: serial,
    hwid,
    email,
    name,
    jti,
    iat: Math.floor(Date.now() / 1000),
  };
  const token = await signToken(claims, env.TOKEN_HMAC_SECRET);

  if (active && active.hwid === hwid) {
    await env.DB.prepare(
      "UPDATE activations SET email = ?, name = ?, token_jti = ?, activated_at = ? WHERE id = ?",
    ).bind(email, name, jti, now, active.id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO activations (id, serial, hwid, email, name, activated_at, token_jti)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), serial, hwid, email, name, now, jti).run();
  }

  return json({
    ok: true,
    token,
    serial,
    email,
    name,
    hwid,
    activatedAt: now,
    message: "BNDZ has been activated on this PC.",
  });
}

async function handleDeactivate(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (!body) return bad("Invalid JSON");

  const serial = String(body.serial || "").trim().toUpperCase();
  const hwid = String(body.hwid || "").trim().toLowerCase();
  const token = String(body.token || "").trim();
  if (!serial || !hwid || !token) return bad("serial, hwid, and token are required");

  const claims = await verifyToken(token, env.TOKEN_HMAC_SECRET);
  if (!claims || claims.sub !== serial || claims.hwid !== hwid) {
    return bad("Invalid activation token", 401);
  }

  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE activations SET deactivated_at = ?
     WHERE serial = ? AND hwid = ? AND deactivated_at IS NULL`,
  ).bind(now, serial, hwid).run();

  return json({
    ok: true,
    freed: (result.meta.changes || 0) > 0,
    message: "License seat released for this PC.",
  });
}

async function handleValidate(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (!body) return bad("Invalid JSON");

  const serial = String(body.serial || "").trim().toUpperCase();
  const hwid = String(body.hwid || "").trim().toLowerCase();
  const token = String(body.token || "").trim();
  if (!serial || !hwid || !token) return bad("serial, hwid, and token are required");

  const claims = await verifyToken(token, env.TOKEN_HMAC_SECRET);
  if (!claims || claims.sub !== serial || claims.hwid !== hwid) {
    return json({ ok: false, valid: false, reason: "invalid_token" }, 401);
  }

  const serialRow = await env.DB.prepare(
    "SELECT revoked_at FROM serials WHERE serial = ?",
  ).bind(serial).first<{ revoked_at: string | null }>();

  if (serialRow?.revoked_at) {
    return json({ ok: false, valid: false, reason: "revoked" }, 403);
  }

  const active = await env.DB.prepare(
    `SELECT id, token_jti FROM activations
     WHERE serial = ? AND hwid = ? AND deactivated_at IS NULL`,
  ).bind(serial, hwid).first<{ id: string; token_jti: string }>();

  if (!active) {
    return json({ ok: false, valid: false, reason: "not_activated" }, 403);
  }
  if (active.token_jti && claims.jti && active.token_jti !== claims.jti) {
    return json({ ok: false, valid: false, reason: "token_superseded" }, 403);
  }

  return json({
    ok: true,
    valid: true,
    serial,
    email: claims.email,
    name: claims.name,
    hwid,
  });
}

async function handleIssue(request: Request, env: Env): Promise<Response> {
  const body = (await readJson(request)) || {};
  const count = Math.min(100, Math.max(1, Number(body.count) || 1));
  const note = String(body.note || "admin-issued");
  const serials: string[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < count; i++) {
    let serial = await mintSerial(env.LICENSE_HMAC_SECRET);
    // Extremely unlikely collision — retry once
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await env.DB.prepare(
          "INSERT INTO serials (serial, created_at, note) VALUES (?, ?, ?)",
        ).bind(serial, now, note).run();
        serials.push(serial);
        break;
      } catch {
        serial = await mintSerial(env.LICENSE_HMAC_SECRET);
      }
    }
  }

  return json({ ok: true, serials, count: serials.length });
}

async function handleRevoke(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (!body) return bad("Invalid JSON");
  const serial = String(body.serial || "").trim().toUpperCase();
  if (!serial) return bad("serial is required");

  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO serials (serial, created_at, note, revoked_at) VALUES (?, ?, ?, ?) ON CONFLICT(serial) DO UPDATE SET revoked_at = excluded.revoked_at",
  ).bind(serial, now, "revoked", now).run();

  await env.DB.prepare(
    `UPDATE activations SET deactivated_at = ?
     WHERE serial = ? AND deactivated_at IS NULL`,
  ).bind(now, serial).run();

  return json({ ok: true, serial, revokedAt: now });
}
