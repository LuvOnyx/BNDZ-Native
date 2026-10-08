import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { allowedOrigin, handle, isStaticAsset } from '../src/index.js';
import { ACCOUNT_ID, WEBSITE_A, ZONE_ID, assertDeletable, assertMutableName } from '../src/dns-guard.js';

const SECRET = 'originsecretvalue01';
const HOST = 'cloud.bndz.org';

function kv(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    async get(key, type) {
      const value = map.get(key);
      if (value == null) return null;
      return type === 'json' ? JSON.parse(value) : value;
    },
    async put(key, value) {
      map.set(key, String(value));
    },
  };
}

function envWith(routes) {
  return { PUBLIC_HOST: HOST, ORIGIN_SECRET: SECRET, ROUTES: routes };
}

function ctxOf() {
  const pending = [];
  return {
    pending,
    waitUntil(p) { pending.push(Promise.resolve(p)); },
  };
}

async function settle(ctx) {
  await Promise.all(ctx.pending);
}

test('static assets are only the panel stylesheet and script', () => {
  assert.equal(isStaticAsset('/desk/app.js'), true);
  assert.equal(isStaticAsset('/desk/app.css'), true);
  assert.equal(isStaticAsset('/desk/app.js.map'), false);
  assert.equal(isStaticAsset('/desk/api/list'), false);
});

test('origins are exactly the hidden drive host', () => {
  assert.equal(allowedOrigin('https://d-desk.bndz.org', 'desk'), true);
  assert.equal(allowedOrigin('https://d-desk.bndz.org/', 'desk'), true);
  assert.equal(allowedOrigin('https://bndz.org', 'desk'), false);
  assert.equal(allowedOrigin('https://www.bndz.org', 'desk'), false);
  assert.equal(allowedOrigin('https://cloud.bndz.org', 'desk'), false);
  assert.equal(allowedOrigin('http://d-desk.bndz.org', 'desk'), false);
  assert.equal(allowedOrigin('https://user:pw@d-desk.bndz.org', 'desk'), false);
  assert.equal(allowedOrigin('https://d-desk.bndz.org:8443', 'desk'), false);
  assert.equal(allowedOrigin('https://d-desk.bndz.org/extra', 'desk'), false);
  assert.equal(allowedOrigin('https://d-desk.bndz.org.evil.test', 'desk'), false);
  assert.equal(allowedOrigin('https://evil.test', 'desk'), false);
});

test('the account page lists published drives and is not cached', async () => {
  const routes = kv({ drives: JSON.stringify(['desk', 'studio']) });
  const res = await handle(new Request('https://cloud.bndz.org/'), envWith(routes), ctxOf(), async () => {
    throw new Error('picker must not call an origin');
  });
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /href="\/desk\/"/);
  assert.match(html, /href="\/studio\/"/);
  assert.match(res.headers.get('cache-control'), /no-store/);
});

test('an unknown path is a clean 404 and is not proxied', async () => {
  let called = false;
  const res = await handle(new Request('https://cloud.bndz.org/missing/'), envWith(kv({ drives: '[]' })), ctxOf(), async () => {
    called = true;
    return new Response('no');
  });
  assert.equal(res.status, 404);
  assert.match(await res.text(), /not a drive/);
  assert.equal(called, false);
});

test('a stored origin that is not the hidden host is rejected', async () => {
  let called = false;
  const routes = kv({
    drives: JSON.stringify(['desk']),
    'drive:desk': JSON.stringify({ origin: 'https://evil.test' }),
  });
  const res = await handle(new Request('https://cloud.bndz.org/desk/'), envWith(routes), ctxOf(), async () => {
    called = true;
    return new Response('leaked');
  });
  assert.equal(res.status, 404);
  assert.equal(called, false);
});

test('an active rename redirects with 301 and an expired one does not', async () => {
  const routes = kv({
    'redirect:oldname': JSON.stringify({ to: 'desk', until: Date.now() + 60_000 }),
    'drive:desk': JSON.stringify({ origin: 'https://d-desk.bndz.org' }),
  });
  const moved = await handle(new Request('https://cloud.bndz.org/oldname/files'), envWith(routes), ctxOf(), async () => new Response('no'));
  assert.equal(moved.status, 301);
  assert.equal(moved.headers.get('location'), 'https://cloud.bndz.org/desk/files');

  routes.map.set('redirect:oldname', JSON.stringify({ to: 'desk', until: Date.now() - 1000 }));
  let seen = '';
  const current = await handle(new Request('https://cloud.bndz.org/oldname/'), envWith(routes), ctxOf(), async (req) => {
    seen = req.url;
    return new Response('gone', { status: 404 });
  });
  assert.equal(seen, '');
  assert.equal(current.status, 404);
});

test('drive traffic streams, keeps Range, and sends the origin secret', async () => {
  let pulls = 0;
  let closed = false;
  let seenRange = '';
  let seenSecret = '';
  let seenRoute = '';
  const body = new ReadableStream({
    pull(controller) {
      pulls += 1;
      if (pulls === 1) controller.enqueue(new Uint8Array([9, 8, 7]));
      else {
        closed = true;
        controller.close();
      }
    },
  });
  const routes = kv({ 'drive:desk': JSON.stringify({ origin: 'https://d-desk.bndz.org' }) });
  const res = await handle(
    new Request('https://cloud.bndz.org/desk/api/download?path=clip.mp4', { headers: { Range: 'bytes=0-99' } }),
    envWith(routes),
    ctxOf(),
    async (req) => {
      seenRange = req.headers.get('range') || '';
      seenSecret = req.headers.get('x-bndz-origin') || '';
      seenRoute = req.headers.get('x-bndz-route') || '';
      assert.equal(req.url, 'https://d-desk.bndz.org/desk/api/download?path=clip.mp4');
      return new Response(body, { status: 206, headers: { 'content-range': 'bytes 0-99/100', 'content-type': 'video/mp4' } });
    },
  );
  assert.equal(closed, false);
  assert.ok(pulls <= 1);
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 0-99/100');
  assert.match(res.headers.get('cache-control'), /no-store/);
  assert.equal(seenRange, 'bytes=0-99');
  assert.equal(seenSecret, SECRET);
  assert.equal(seenRoute, '1');
  const first = await res.body.getReader().read();
  assert.deepEqual(Array.from(first.value), [9, 8, 7]);
});

test('only panel assets are edge-cached', async () => {
  const store = new Map();
  const previous = globalThis.caches;
  globalThis.caches = {
    default: {
      async match(req) {
        return store.get(new URL(req.url).pathname);
      },
      async put(req, res) {
        store.set(new URL(req.url).pathname, res);
      },
    },
  };
  try {
    let fetches = 0;
    const routes = kv({ 'drive:desk': JSON.stringify({ origin: 'https://d-desk.bndz.org' }) });
    const outbound = async (req) => {
      fetches += 1;
      const path = new URL(req.url).pathname;
      if (path.endsWith('/app.js')) return new Response('js', { status: 200, headers: { 'content-type': 'text/javascript' } });
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const ctx = ctxOf();
    const asset = await handle(new Request('https://cloud.bndz.org/desk/app.js'), envWith(routes), ctx, outbound);
    assert.match(asset.headers.get('cache-control'), /public, max-age=3600/);
    await settle(ctx);
    const again = await handle(new Request('https://cloud.bndz.org/desk/app.js'), envWith(routes), ctxOf(), outbound);
    assert.equal(await again.text(), 'js');
    const ranged = await handle(
      new Request('https://cloud.bndz.org/desk/app.js', { headers: { Range: 'bytes=0-1' } }),
      envWith(routes),
      ctxOf(),
      outbound,
    );
    assert.match(ranged.headers.get('cache-control'), /no-store/);
    const api = await handle(new Request('https://cloud.bndz.org/desk/api/list'), envWith(routes), ctxOf(), outbound);
    assert.match(api.headers.get('cache-control'), /no-store/);
    assert.equal(api.headers.get('cdn-cache-control'), 'no-store');
    assert.equal(fetches, 3);
  } finally {
    globalThis.caches = previous;
  }
});

test('a share link fans out and then uses the cached drive', async () => {
  let cancelled = false;
  let calls = 0;
  const routes = kv({
    drives: JSON.stringify(['other', 'desk']),
    'drive:other': JSON.stringify({ origin: 'https://d-other.bndz.org' }),
    'drive:desk': JSON.stringify({ origin: 'https://d-desk.bndz.org' }),
  });
  const outbound = async (req) => {
    calls += 1;
    const host = new URL(req.url).hostname;
    if (host === 'd-other.bndz.org') {
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 404 });
    }
    return new Response('shared-page', { status: 200, headers: { 'content-type': 'text/html' } });
  };
  const ctx = ctxOf();
  const first = await handle(new Request('https://cloud.bndz.org/s/sharetoken01'), envWith(routes), ctx, outbound);
  assert.equal(await first.text(), 'shared-page');
  assert.equal(cancelled, true);
  await settle(ctx);
  assert.equal(routes.map.get('share:sharetoken01'), 'desk');
  const second = await handle(new Request('https://cloud.bndz.org/s/sharetoken01'), envWith(routes), ctxOf(), outbound);
  assert.equal(await second.text(), 'shared-page');
  assert.equal(calls, 3);
});

test('dns guard refuses the live website and allows drive origins', () => {
  assert.equal(ACCOUNT_ID, '43aa82716ea9acc4c2e89fdd9843e182');
  assert.equal(ZONE_ID, '1ac81c686fa2d4e3f175cd90afed08cc');
  assert.equal(WEBSITE_A, '15.204.218.94');
  for (const name of ['bndz.org', 'www.bndz.org', 'www', '@', '']) {
    assert.throws(() => assertMutableName(name), /live website/);
  }
  assert.equal(assertMutableName('cloud.bndz.org'), 'cloud.bndz.org');
  assert.equal(assertMutableName('d-e2e-abc.bndz.org'), 'd-e2e-abc.bndz.org');
  assert.throws(() => assertMutableName('studio.cloud.bndz.org'), /Refusing DNS name/);
  assert.throws(() => assertDeletable({ name: 'cloud.bndz.org', content: WEBSITE_A }), /live website/);
  assert.equal(assertDeletable({ name: 'd-e2e-abc.bndz.org', content: 'abc.cfargotunnel.com' }), 'd-e2e-abc.bndz.org');
  assert.throws(() => assertDeletable({ name: 'bndz.org', content: '192.0.2.1' }), /live website/);
});

test('miniflare boots the worker and serves the account page from KV', async () => {
  const { Miniflare } = await import('miniflare');
  const mf = new Miniflare({
    modules: true,
    scriptPath: fileURLToPath(new URL('../src/index.js', import.meta.url)),
    kvNamespaces: ['ROUTES'],
    bindings: { PUBLIC_HOST: HOST, ORIGIN_SECRET: SECRET },
  });
  try {
    const routes = await mf.getKVNamespace('ROUTES');
    await routes.put('drives', JSON.stringify(['desk']));
    const res = await mf.dispatchFetch('https://cloud.bndz.org/');
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /href="\/desk\/"/);
    assert.match(res.headers.get('cache-control') || '', /no-store/);
    const missing = await mf.dispatchFetch('https://cloud.bndz.org/not-a-drive/');
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /not a drive/);
  } finally {
    await mf.dispose();
  }
});
