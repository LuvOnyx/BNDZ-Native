/**
 * Public router for https://cloud.bndz.org.
 * One tunnel cannot send each path to a different machine: every connector on
 * one tunnel is a replica of the same ingress. Each drive has its own tunnel
 * at https://d-<name>.bndz.org. This Worker is the only public hostname.
 *
 * KV keys (namespace bndz-cloud-routes):
 *   drives                 JSON array of slugs
 *   drive:<slug>           {"origin":"https://d-<slug>.bndz.org"}
 *   redirect:<from>        {"to":"<slug>","until":<unix ms>}
 *   share:<token>          "<slug>" cached after the first hit
 *
 * ORIGIN_SECRET is sent as X-Bndz-Origin. The guest panel rejects any other caller.
 */

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,59}[a-z0-9])?$/;
const RESERVED = new Set(['s', 'api', 'admin', 'login', 'static', 'assets', 'www']);
const STATIC_ASSET = /\/app\.(?:js|css)$/;
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host']);

export function isStaticAsset(pathname) {
  return STATIC_ASSET.test(pathname || '');
}

export function allowedOrigin(origin, slug) {
  let url;
  try { url = new URL(origin); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' && url.pathname !== '') return false;
  if (url.search || url.hash) return false;
  const host = url.hostname.toLowerCase();
  if (host === 'bndz.org' || host === 'www.bndz.org' || host === 'cloud.bndz.org') return false;
  return host === 'd-' + slug + '.bndz.org';
}

export default {
  fetch(request, env, ctx) {
    return handle(request, env, ctx, globalThis.fetch.bind(globalThis));
  },
};

export async function handle(request, env, ctx, fetchImpl) {
  const outbound = fetchImpl || globalThis.fetch.bind(globalThis);
  const url = new URL(request.url);
  const host = (env && env.PUBLIC_HOST) || url.hostname || 'cloud.bndz.org';
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length === 0) return picker(env, host);
  if (parts[0] === 's') return share(request, url, env, ctx, outbound, host);
  const slug = parts[0].toLowerCase();
  if (!SLUG.test(slug) || RESERVED.has(slug)) return notFound(host);
  const redirect = await readJson(env, 'redirect:' + slug);
  if (redirect && redirect.to && SLUG.test(redirect.to) && Number(redirect.until) > Date.now()) {
    const rest = url.pathname.slice(slug.length + 1);
    const dest = new URL(request.url);
    dest.hostname = host;
    dest.protocol = 'https:';
    dest.pathname = '/' + redirect.to + (rest.startsWith('/') ? rest : rest ? '/' + rest : '/');
    if (!dest.pathname.endsWith('/') && rest.length === 0) dest.pathname += '/';
    return Response.redirect(dest.toString(), 301);
  }
  const drive = await readJson(env, 'drive:' + slug);
  if (!drive || !allowedOrigin(drive.origin, slug)) return notFound(host);
  return proxy(request, url, drive.origin, env, ctx, outbound, false);
}

async function picker(env, host) {
  const slugs = await readJson(env, 'drives');
  const list = Array.isArray(slugs) ? slugs.filter(s => SLUG.test(s) && !RESERVED.has(s)) : [];
  const items = list.length
    ? list.map(s => '<li><a href="/' + s + '/">' + s + '</a></li>').join('')
    : '<li>No drives are published yet.</li>';
  const html = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BNDZ</title><style>body{margin:0;background:#0c0e12;color:#f6edd4;font:15px/1.45 Segoe UI,sans-serif}main{max-width:36rem;margin:8vh auto;padding:0 1.25rem}h1{font-size:1.45rem;font-weight:650;letter-spacing:-.02em;margin:0 0 .4rem}p{margin:0 0 1rem;color:rgba(246,237,212,.72)}a{color:#e8c46e}li{margin:.35rem 0}</style><main><h1>BNDZ drives</h1><p>https://' + host + '/ is the account page. Each drive is a path.</p><ul>' + items + '</ul></main>';
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' } });
}

function notFound(host) {
  const html = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Not a drive</title><style>body{margin:0;background:#0c0e12;color:#f6edd4;font:15px/1.45 Segoe UI,sans-serif}main{max-width:36rem;margin:8vh auto;padding:0 1.25rem}a{color:#e8c46e}</style><main><h1>That path is not a drive.</h1><p><a href="https://' + host + '/">Open https://' + host + '/</a></p></main>';
  return new Response(html, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' } });
}

async function share(request, url, env, ctx, outbound, host) {
  const token = (url.pathname.split('/')[2] || '').slice(0, 80);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(token)) return notFound(host);
  const cached = await readText(env, 'share:' + token);
  if (cached && SLUG.test(cached)) {
    const drive = await readJson(env, 'drive:' + cached);
    if (drive && allowedOrigin(drive.origin, cached)) {
      return proxy(request, url, drive.origin, env, ctx, outbound, true);
    }
  }
  const slugs = await readJson(env, 'drives');
  const list = Array.isArray(slugs) ? slugs : [];
  for (const slug of list) {
    if (!SLUG.test(slug)) continue;
    const drive = await readJson(env, 'drive:' + slug);
    if (!drive || !allowedOrigin(drive.origin, slug)) continue;
    const res = await proxy(request.clone(), url, drive.origin, env, ctx, outbound, true);
    if (res.status === 404) {
      if (res.body) await res.body.cancel();
      continue;
    }
    if (env && env.ROUTES && request.method === 'GET' && res.ok) {
      const put = env.ROUTES.put('share:' + token, slug, { expirationTtl: 3600 });
      if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
    }
    return res;
  }
  return notFound(host);
}

async function proxy(request, url, origin, env, ctx, outbound, shareHit) {
  const target = new URL(url.pathname + url.search, origin);
  const headers = new Headers(request.headers);
  headers.set('X-Bndz-Origin', (env && env.ORIGIN_SECRET) || '');
  headers.set('X-Bndz-Route', '1');
  headers.set('X-Forwarded-Host', url.hostname);
  headers.set('X-Forwarded-Proto', 'https');
  headers.delete('host');
  const method = request.method;
  const init = { method, headers, redirect: 'manual' };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = request.body;
    init.duplex = 'half';
  }
  const cacheable = method === 'GET' && !shareHit && isStaticAsset(url.pathname) && !request.headers.has('range');
  const cache = cacheable ? edgeCache() : null;
  if (cache) {
    const hit = await cache.match(request);
    if (hit) return hit;
  }
  const res = await outbound(new Request(target, init));
  const outHeaders = copyHeaders(res.headers);
  if (cacheable) outHeaders.set('cache-control', 'public, max-age=3600');
  else {
    outHeaders.set('cache-control', 'private, no-store');
    outHeaders.set('cdn-cache-control', 'no-store');
  }
  const out = new Response(res.body, { status: res.status, statusText: res.statusText, headers: outHeaders });
  if (cache && res.ok) {
    const put = cache.put(request, out.clone()).catch(() => {});
    if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
  }
  return out;
}

function edgeCache() {
  try {
    if (typeof caches !== 'undefined' && caches.default) return caches.default;
  } catch { /* node unit tests have no Cache API */ }
  return null;
}

function copyHeaders(src) {
  const out = new Headers();
  for (const [key, value] of src.entries()) {
    if (HOP.has(key.toLowerCase())) continue;
    out.append(key, value);
  }
  return out;
}

async function readJson(env, key) {
  if (!env || !env.ROUTES) return null;
  try { return await env.ROUTES.get(key, 'json'); } catch { return null; }
}

async function readText(env, key) {
  if (!env || !env.ROUTES) return null;
  try { return await env.ROUTES.get(key); } catch { return null; }
}
