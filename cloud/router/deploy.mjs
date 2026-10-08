#!/usr/bin/env node
/**
 * Idempotent deploy and teardown for the public Cloud Drive router.
 * Uses CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. Never prints the token
 * or the origin secret. Never changes bndz.org or www.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCOUNT_ID, ZONE_ID, assertDeletable } from './src/dns-guard.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const KV_TITLE = 'bndz-cloud-routes';
const WORKER = 'bndz-cloud-router';
const PUBLIC_HOST = 'cloud.bndz.org';
const SECRET_FILE = join(HERE, '.origin-secret');

const token = process.env.CLOUDFLARE_API_TOKEN || '';
const account = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const action = process.argv[2] === 'teardown' ? 'teardown' : 'deploy';
let originSecret = '';

function fail(message) {
  process.stderr.write(redact(message) + '\n');
  process.exit(1);
}

function redact(text) {
  let s = String(text ?? '');
  if (token) s = s.split(token).join('[redacted]');
  if (originSecret) s = s.split(originSecret).join('[redacted]');
  return s.replace(/\beyJ[A-Za-z0-9_-]{16,}(?:\.[A-Za-z0-9_-]+){1,2}/g, '[redacted]');
}

function say(line) {
  process.stdout.write(line + '\n');
}

async function cf(method, url, body, { raw = false, ok404 = false } = {}) {
  const headers = { Authorization: 'Bearer ' + token };
  if (!raw) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  if (ok404 && res.status === 404) return null;
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok || (json && json.success === false)) {
    const message = json?.errors?.[0]?.message || ('HTTP ' + res.status);
    throw new Error(message);
  }
  return json ?? text;
}

async function verifyToken() {
  if (!token) fail('Set CLOUDFLARE_API_TOKEN.');
  if (account !== ACCOUNT_ID) fail('CLOUDFLARE_ACCOUNT_ID must be ' + ACCOUNT_ID + '.');
  const url = 'https://api.cloudflare.com/client/v4/accounts/' + account + '/tokens/verify';
  const doc = await cf('GET', url);
  const status = doc?.result?.status || 'unknown';
  if (status !== 'active') fail('Cloudflare token status is ' + status + '.');
  say('token  account ' + account + '  status active');
}

async function listNamespaces() {
  const found = [];
  for (let page = 1; page <= 5; page++) {
    const url = 'https://api.cloudflare.com/client/v4/accounts/' + account + '/storage/kv/namespaces?per_page=50&page=' + page;
    const doc = await cf('GET', url);
    const rows = doc.result || [];
    found.push(...rows);
    if (rows.length < 50) break;
  }
  return found;
}

async function ensureKv() {
  const rows = await listNamespaces();
  const existing = rows.find(row => row.title === KV_TITLE);
  if (existing) {
    say('kept   kv ' + KV_TITLE + ' ' + existing.id);
    return { id: existing.id, created: false };
  }
  const doc = await cf('POST', 'https://api.cloudflare.com/client/v4/accounts/' + account + '/storage/kv/namespaces', JSON.stringify({ title: KV_TITLE }));
  const id = doc.result.id;
  say('created kv ' + KV_TITLE + ' ' + id);
  return { id, created: true };
}

function readOrCreateSecret() {
  const fromEnv = (process.env.BNDZ_ORIGIN_SECRET || '').trim();
  if (/^[A-Za-z0-9]{16,128}$/.test(fromEnv)) {
    writeFileSync(SECRET_FILE, fromEnv + '\n', { mode: 0o600 });
    chmodSync(SECRET_FILE, 0o600);
    say('origin secret file ' + SECRET_FILE + ' (from BNDZ_ORIGIN_SECRET, value not printed)');
    return fromEnv;
  }
  if (fromEnv) fail('BNDZ_ORIGIN_SECRET must be 16 to 128 letters and numbers.');
  if (existsSync(SECRET_FILE)) {
    const current = readFileSync(SECRET_FILE, 'utf8').trim();
    if (/^[A-Za-z0-9]{16,128}$/.test(current)) {
      chmodSync(SECRET_FILE, 0o600);
      say('kept   origin secret file ' + SECRET_FILE + ' (value not printed)');
      return current;
    }
  }
  const created = randomBytes(32).toString('hex');
  writeFileSync(SECRET_FILE, created + '\n', { mode: 0o600 });
  chmodSync(SECRET_FILE, 0o600);
  say('created origin secret file ' + SECRET_FILE + ' (value not printed)');
  return created;
}

function writeDeployConfig(kvId) {
  const source = readFileSync(join(HERE, 'wrangler.jsonc'), 'utf8');
  const config = source.replace('REPLACE_WITH_BNDZ_CLOUD_ROUTES_ID', kvId);
  const path = join(HERE, 'wrangler.deploy.jsonc');
  writeFileSync(path, config, { mode: 0o600 });
  return path;
}

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: HERE, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(out + err);
      else reject(new Error(redact((err || out || cmd + ' failed').trim())));
    });
  });
}

async function deployWorker(configPath, secret) {
  const dir = mkdtempSync(join(tmpdir(), 'bndz-cloud-secrets-'));
  const secretsPath = join(dir, 'secrets.json');
  try {
    writeFileSync(secretsPath, JSON.stringify({ ORIGIN_SECRET: secret }), { mode: 0o600 });
    chmodSync(secretsPath, 0o600);
    const wrangler = join(HERE, 'node_modules', '.bin', 'wrangler');
    if (!existsSync(wrangler)) fail('wrangler is not installed. Run npm install in cloud/router.');
    const env = { ...process.env, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account };
    // The pinned wrangler (4.26) has no `deploy --secrets-file`, and newer wrangler needs Node 22.
    // Deploy first, then upload the secret with `secret bulk`. Until that finishes the Worker sends
    // an empty X-Bndz-Origin, which the guest panel rejects, so nothing is exposed in between.
    const log = await run(wrangler, ['deploy', '--config', configPath], env);
    const brief = redact(log).split('\n').map(line => line.trim()).filter(Boolean).slice(-8);
    for (const line of brief) say('wrangler  ' + line);
    await run(wrangler, ['secret', 'bulk', secretsPath, '--config', configPath], env);
    say('secret ORIGIN_SECRET uploaded (value not printed)');
    say('deployed worker ' + WORKER);
    say('custom domain ' + PUBLIC_HOST);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function deleteWorker() {
  const url = 'https://api.cloudflare.com/client/v4/accounts/' + account + '/workers/scripts/' + WORKER;
  const gone = await cf('DELETE', url, undefined, { ok404: true });
  say(gone == null ? 'absent  worker ' + WORKER : 'deleted worker ' + WORKER);
}

async function deleteKv() {
  const rows = await listNamespaces();
  const matches = rows.filter(row => row.title === KV_TITLE);
  if (matches.length === 0) {
    say('absent  kv ' + KV_TITLE);
    return;
  }
  for (const row of matches) {
    await cf('DELETE', 'https://api.cloudflare.com/client/v4/accounts/' + account + '/storage/kv/namespaces/' + row.id);
    say('deleted kv ' + KV_TITLE + ' ' + row.id);
  }
}

async function deletePublicDns() {
  const url = 'https://api.cloudflare.com/client/v4/zones/' + ZONE_ID + '/dns_records?name=' + encodeURIComponent(PUBLIC_HOST);
  const doc = await cf('GET', url);
  const rows = doc.result || [];
  if (rows.length === 0) {
    say('absent  dns ' + PUBLIC_HOST);
    return;
  }
  for (const row of rows) {
    const name = assertDeletable({ name: row.name, content: row.content });
    if (name !== PUBLIC_HOST) fail('Refusing to delete DNS ' + name);
    await cf('DELETE', 'https://api.cloudflare.com/client/v4/zones/' + ZONE_ID + '/dns_records/' + row.id);
    say('deleted dns ' + name + ' ' + row.id);
  }
}

try {
  await verifyToken();
  if (action === 'teardown') {
    await deleteWorker();
    await deleteKv();
    await deletePublicDns();
    say('teardown finished. bndz.org and www were not changed.');
  } else {
    const ns = await ensureKv();
    originSecret = readOrCreateSecret();
    const secret = originSecret;
    const config = writeDeployConfig(ns.id);
    await deployWorker(config, secret);
    say('deploy finished. Paste ' + SECRET_FILE + ' into BNDZ once. The value was not printed.');
  }
} catch (err) {
  fail(err && err.message ? err.message : String(err));
}
