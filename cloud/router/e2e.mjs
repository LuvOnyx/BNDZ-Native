#!/usr/bin/env node
/**
 * Throwaway tunnel + the real guest panel, checked through https://cloud.bndz.org.
 * The finally block deletes only this run's tunnel, origin DNS, and KV keys.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtempSync, openSync, readFileSync, rmSync, writeSync, closeSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ACCOUNT_ID, ZONE_ID, assertDeletable } from './src/dns-guard.js';

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const PANEL = join(HERE, '../../BNDZBackend/Services/CloudDrive/guest/panel/server.py');
const KV_TITLE = 'bndz-cloud-routes';
const PUBLIC = 'https://cloud.bndz.org';

const token = process.env.CLOUDFLARE_API_TOKEN || '';
const account = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const rand = randomBytes(4).toString('hex');
const slug = 'e2e-' + rand;
const oldSlug = 'old-' + rand;
const tunnelName = 'bndz-cloud-e2e-' + rand;
const originHost = 'd-' + slug + '.bndz.org';

const state = {
  tunnelId: '',
  dnsId: '',
  nsId: '',
  previousDrives: null,
  shareToken: '',
  panel: null,
  cloudflared: null,
  temp: '',
  blob: '',
};

function redact(text) {
  let s = String(text ?? '');
  if (token) s = s.split(token).join('[redacted]');
  if (state.connector) s = s.split(state.connector).join('[redacted]');
  return s.replace(/\beyJ[A-Za-z0-9_-]{16,}(?:\.[A-Za-z0-9_-]+){1,2}/g, '[redacted]');
}

function say(line) {
  process.stdout.write('[e2e] ' + line + '\n');
}

function fail(message) {
  throw new Error(message);
}

async function cf(method, url, body, { raw = false, ok404 = false } = {}) {
  const headers = { Authorization: 'Bearer ' + token };
  if (body != null) headers['Content-Type'] = raw ? 'text/plain' : 'application/json';
  const res = await fetch(url, { method, headers, body: body == null ? undefined : (raw ? body : JSON.stringify(body)) });
  const text = await res.text();
  if (ok404 && res.status === 404) return null;
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok || (json && json.success === false)) {
    const message = json?.errors?.[0]?.message || ('HTTP ' + res.status);
    throw new Error(redact(message));
  }
  return raw ? text : json;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function cloudflaredBin() {
  if (existsSync(join(HERE, 'bin/cloudflared'))) return join(HERE, 'bin/cloudflared');
  return 'cloudflared';
}

async function curl(args) {
  const { stdout } = await exec('curl', ['-fsS', '--max-time', '30', ...args], { maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

async function curlStatus(args) {
  const { stdout } = await exec('curl', ['-sS', '--max-time', '30', '-w', '\n%{http_code}', ...args], { maxBuffer: 8 * 1024 * 1024 });
  const text = String(stdout);
  const cut = text.lastIndexOf('\n');
  return { body: text.slice(0, cut), status: Number(text.slice(cut + 1)) };
}

async function waitFor(label, fn, attempts = 40) {
  let last = 'not ready';
  for (let i = 0; i < attempts; i++) {
    try {
      if (await fn()) return;
    } catch (err) {
      last = redact(err.message || String(err));
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  fail(label + ' did not become ready (' + last + ')');
}

async function findNamespace() {
  for (let page = 1; page <= 5; page++) {
    const doc = await cf('GET', 'https://api.cloudflare.com/client/v4/accounts/' + account + '/storage/kv/namespaces?per_page=50&page=' + page);
    const hit = (doc.result || []).find(row => row.title === KV_TITLE);
    if (hit) return hit.id;
    if ((doc.result || []).length < 50) break;
  }
  fail('KV namespace ' + KV_TITLE + ' is missing. Run ./deploy.sh first.');
}

async function kvGet(key) {
  const url = 'https://api.cloudflare.com/client/v4/accounts/' + account + '/storage/kv/namespaces/' + state.nsId + '/values/' + encodeURIComponent(key);
  return cf('GET', url, undefined, { raw: true, ok404: true });
}

async function kvPut(key, value) {
  const url = 'https://api.cloudflare.com/client/v4/accounts/' + account + '/storage/kv/namespaces/' + state.nsId + '/values/' + encodeURIComponent(key);
  await cf('PUT', url, value, { raw: true });
}

async function kvDelete(key) {
  const url = 'https://api.cloudflare.com/client/v4/accounts/' + account + '/storage/kv/namespaces/' + state.nsId + '/values/' + encodeURIComponent(key);
  await cf('DELETE', url, undefined, { ok404: true });
}

async function registerMapping() {
  state.nsId = await findNamespace();
  state.previousDrives = await kvGet('drives');
  const current = state.previousDrives ? JSON.parse(state.previousDrives) : [];
  const next = [slug, ...current.filter(item => item !== slug && item !== oldSlug)];
  await kvPut('drive:' + slug, JSON.stringify({ origin: 'https://' + originHost }));
  const until = Date.now() + 60 * 60 * 1000;
  await kvPut('redirect:' + oldSlug, JSON.stringify({ to: slug, until }));
  await kvPut('drives', JSON.stringify(next));
  say('registered ' + slug + ' -> https://' + originHost);
}

async function createTunnel(port) {
  const doc = await cf('POST', 'https://api.cloudflare.com/client/v4/accounts/' + account + '/cfd_tunnel', {
    name: tunnelName,
    config_src: 'cloudflare',
  });
  state.tunnelId = doc.result.id;
  state.connector = doc.result.token || '';
  if (!state.tunnelId || !state.connector) fail('Cloudflare did not return a tunnel token.');
  say('created tunnel ' + tunnelName + ' ' + state.tunnelId);
  await cf('PUT', 'https://api.cloudflare.com/client/v4/accounts/' + account + '/cfd_tunnel/' + state.tunnelId + '/configurations', {
    config: {
      ingress: [
        { hostname: originHost, service: 'http://127.0.0.1:' + port },
        { service: 'http_status:404' },
      ],
    },
  });
  const target = state.tunnelId + '.cfargotunnel.com';
  assertDeletable({ name: originHost, content: target });
  const created = await cf('POST', 'https://api.cloudflare.com/client/v4/zones/' + ZONE_ID + '/dns_records', {
    type: 'CNAME',
    name: originHost,
    content: target,
    proxied: true,
    ttl: 1,
  });
  state.dnsId = created.result.id;
  say('created dns ' + originHost);
}

function logStdio(name) {
  const dir = process.env.BNDZ_E2E_LOGDIR || '';
  if (!dir) return 'ignore';
  const fd = openSync(join(dir, name + '-' + rand + '.log'), 'a', 0o600);
  return ['ignore', fd, fd];
}

function startPanel(dir, port, secret, password) {
  state.panel = spawn('python3', [PANEL], {
    env: {
      ...process.env,
      BNDZ_DATA_MOUNT: dir,
      BNDZ_FTP_PASSWORD: password,
      BNDZ_PANEL_HOST: '127.0.0.1',
      BNDZ_PANEL_PORT: String(port),
      BNDZ_PUBLIC_HOST: 'cloud.bndz.org',
      BNDZ_PATH_PREFIX: '/' + slug,
      BNDZ_ORIGIN_SECRET: secret,
      BNDZ_ROUTE_GUARD: '1',
    },
    stdio: logStdio('panel'),
  });
}

function startConnector(metricsPort) {
  state.cloudflared = spawn(cloudflaredBin(), ['tunnel', '--no-autoupdate', '--metrics', '127.0.0.1:' + metricsPort, 'run'], {
    env: { ...process.env, TUNNEL_TOKEN: state.connector },
    stdio: logStdio('cloudflared'),
  });
}

function writeBlob(path) {
  const fd = openSync(path, 'w');
  const chunk = Buffer.alloc(1024 * 1024, 0x61);
  for (let i = 0; i < 110; i++) writeSync(fd, chunk);
  closeSync(fd);
}

async function upload(cookie, file) {
  const size = 110 * 1024 * 1024;
  const start = await curl([
    '-H', 'Cookie: ' + cookie,
    '-H', 'Content-Type: application/json',
    '-d', JSON.stringify({ dir: '', name: 'blob.bin', size }),
    PUBLIC + '/' + slug + '/api/upload/start',
  ]);
  const meta = JSON.parse(start);
  if (!meta.id || meta.chunkSize > 90 * 1024 * 1024) fail('upload start did not return a chunk cap');
  const fh = await import('node:fs/promises');
  const handle = await fh.open(file, 'r');
  try {
    let offset = 0;
    const piece = Buffer.alloc(meta.chunkSize);
    while (offset < size) {
      const { bytesRead } = await handle.read(piece, 0, piece.length, offset);
      if (!bytesRead) break;
      const body = piece.subarray(0, bytesRead);
      const res = await fetch(PUBLIC + '/' + slug + '/api/upload/chunk?id=' + meta.id + '&offset=' + offset, {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/octet-stream' },
        body,
        duplex: 'half',
      });
      if (res.status === 409) {
        const again = await res.json();
        offset = Number(again.offset || 0);
        continue;
      }
      if (!res.ok) fail('chunk upload HTTP ' + res.status);
      offset += bytesRead;
    }
  } finally {
    await handle.close();
  }
  const done = JSON.parse(await curl([
    '-H', 'Cookie: ' + cookie,
    '-H', 'Content-Type: application/json',
    '-d', JSON.stringify({ id: meta.id }),
    PUBLIC + '/' + slug + '/api/upload/finish',
  ]));
  if (!done.ok || done.size !== size) fail('finish did not report ' + size + ' bytes');
  say('uploaded 110 MiB in chunks');
}

async function timings(cookie) {
  await curl(['-o', '/dev/null', '-H', 'Cookie: ' + cookie, PUBLIC + '/' + slug + '/api/list?path=']);
  const { stdout } = await exec('curl', [
    '-sS', '--max-time', '30', '-o', '/dev/null',
    '-H', 'Cookie: ' + cookie,
    '-w', '%{time_starttransfer} %{time_total}',
    PUBLIC + '/' + slug + '/api/list?path=',
  ]);
  const [ttfb, total] = String(stdout).trim().split(/\s+/).map(Number);
  say('list ttfb ' + ttfb.toFixed(3) + 's  total ' + total.toFixed(3) + 's');
  if (!(ttfb < 5) || !(total < 8)) fail('list latency exceeded the sanity cap (ttfb ' + ttfb + 's, total ' + total + 's)');
}

async function run() {
  if (account !== ACCOUNT_ID) fail('CLOUDFLARE_ACCOUNT_ID must be ' + ACCOUNT_ID + '.');
  if (!token) fail('Set CLOUDFLARE_API_TOKEN.');
  const secret = readFileSync(join(HERE, '.origin-secret'), 'utf8').trim();
  if (!/^[A-Za-z0-9]{16,128}$/.test(secret)) fail('cloud/router/.origin-secret is missing. Run ./deploy.sh.');
  const password = randomBytes(18).toString('hex');
  const port = await freePort();
  state.temp = mkdtempSync(join(tmpdir(), 'bndz-cloud-e2e-'));
  state.blob = join(tmpdir(), 'bndz-cloud-e2e-' + rand + '.bin');
  writeBlob(state.blob);

  startPanel(state.temp, port, secret, password);
  await waitFor('local panel', async () => {
    const { status } = await curlStatus(['http://127.0.0.1:' + port + '/' + slug + '/api/health']);
    return status === 200;
  }, 20);

  await createTunnel(port);
  await registerMapping();
  const metricsPort = await freePort();
  startConnector(metricsPort);
  // /ready turns 200 once cloudflared has registered a connection with the Cloudflare edge.
  await waitFor('cloudflared edge connection (needs outbound port 7844, QUIC/UDP or TCP)', async () => {
    const { status } = await curlStatus(['http://127.0.0.1:' + metricsPort + '/ready']);
    if (status === 200) return true;
    throw new Error('ready HTTP ' + status);
  }, 30);
  say('cloudflared connected to the edge');

  const base = PUBLIC + '/' + slug + '/';
  await waitFor('public path', async () => {
    const { status, body } = await curlStatus([base]);
    if (status === 200 && body.includes('window.BNDZ_BASE') && body.includes('/' + slug + '/app.js')) return true;
    throw new Error('HTTP ' + status + ' ' + body.replace(/\s+/g, ' ').slice(0, 160));
  }, 40);
  say('path prefix ' + base);

  const headers = await curl(['-D', '-', '-o', '/dev/null', '-H', 'Content-Type: application/json', '-d', JSON.stringify({ user: 'bndz', password }), base + 'api/login']);
  const cookieLine = headers.split('\n').find(line => line.toLowerCase().startsWith('set-cookie:'));
  if (!cookieLine || !cookieLine.includes('Path=/' + slug + '/')) fail('login cookie is not scoped to the drive path');
  const cookie = cookieLine.split(':', 2)[1].split(';', 1)[0].trim();
  say('login cookie Path=/' + slug + '/');

  const list = JSON.parse(await curl(['-H', 'Cookie: ' + cookie, base + 'api/list?path=']));
  if (!Array.isArray(list.entries)) fail('file list did not return entries');
  say('file list ' + list.entries.length + ' entries');

  await upload(cookie, state.blob);

  const rangePath = join(tmpdir(), 'bndz-cloud-e2e-' + rand + '.range');
  const range = await curlStatus([
    '-D', '-', '-o', rangePath,
    '-H', 'Cookie: ' + cookie,
    '-H', 'Range: bytes=0-99',
    base + 'api/download?path=blob.bin',
  ]);
  const { readFileSync: read } = await import('node:fs');
  const got = read(rangePath);
  if (range.status !== 206 || got.length !== 100 || got[0] !== 0x61) {
    fail('Range download expected 206 and 100 bytes, got HTTP ' + range.status + ' and ' + got.length + ' bytes');
  }
  say('range download 206 100 bytes');

  const share = JSON.parse(await curl([
    '-H', 'Cookie: ' + cookie,
    '-H', 'Content-Type: application/json',
    '-d', JSON.stringify({ path: 'blob.bin', hours: 1 }),
    base + 'api/shares',
  ]));
  const shareUrl = share.share && share.share.url;
  if (!shareUrl || !shareUrl.startsWith('/s/')) fail('share link was not /s/<token>');
  state.shareToken = shareUrl.split('/')[2];
  const page = await curlStatus([PUBLIC + shareUrl]);
  if (page.status !== 200 || !page.body.includes('cloud.bndz.org')) fail('share page did not open on the public host');
  say('share ' + PUBLIC + shareUrl);

  const moved = await curlStatus(['-o', '/dev/null', '-D', '-', PUBLIC + '/' + oldSlug + '/']);
  if (moved.status !== 301 || !moved.body.toLowerCase().includes('location: https://cloud.bndz.org/' + slug + '/')) {
    fail('rename did not 301 to /' + slug + '/');
  }
  say('rename 301 /' + oldSlug + '/ -> /' + slug + '/');

  const direct = await curlStatus(['-o', '-', 'https://' + originHost + '/']);
  if (direct.status !== 404 || !direct.body.includes(PUBLIC + '/' + slug + '/')) {
    fail('origin-direct bypass was not rejected (HTTP ' + direct.status + ')');
  }
  say('origin direct rejected');

  await timings(cookie);
  say('passed ' + slug);
}

async function cleanup() {
  const stop = (child) => {
    if (!child || child.killed) return;
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  };
  stop(state.cloudflared);
  stop(state.panel);
  await new Promise(r => setTimeout(r, 500));
  if (state.cloudflared && state.cloudflared.exitCode == null) {
    try { state.cloudflared.kill('SIGKILL'); } catch { /* already gone */ }
  }
  if (state.panel && state.panel.exitCode == null) {
    try { state.panel.kill('SIGKILL'); } catch { /* already gone */ }
  }
  if (token && account === ACCOUNT_ID) {
    try {
      if (state.dnsId) {
        assertDeletable({ name: originHost, content: state.tunnelId + '.cfargotunnel.com' });
        await cf('DELETE', 'https://api.cloudflare.com/client/v4/zones/' + ZONE_ID + '/dns_records/' + state.dnsId, undefined, { ok404: true });
        say('deleted dns ' + originHost);
      }
    } catch (err) {
      say('dns cleanup: ' + redact(err.message));
    }
    try {
      if (state.tunnelId) {
        await cf('DELETE', 'https://api.cloudflare.com/client/v4/accounts/' + account + '/cfd_tunnel/' + state.tunnelId, undefined, { ok404: true });
        say('deleted tunnel ' + tunnelName);
      }
    } catch (err) {
      say('tunnel cleanup: ' + redact(err.message));
    }
    try {
      if (state.nsId) {
        await kvDelete('drive:' + slug);
        await kvDelete('redirect:' + oldSlug);
        if (state.shareToken) await kvDelete('share:' + state.shareToken);
        if (state.previousDrives == null) await kvDelete('drives');
        else await kvPut('drives', state.previousDrives);
        say('removed kv keys for ' + slug);
      }
    } catch (err) {
      say('kv cleanup: ' + redact(err.message));
    }
  }
  if (state.temp) rmSync(state.temp, { recursive: true, force: true });
  if (state.blob) rmSync(state.blob, { force: true });
  rmSync(join(tmpdir(), 'bndz-cloud-e2e-' + rand + '.range'), { force: true });
  state.connector = '';
}

try {
  await run();
} finally {
  await cleanup();
}
