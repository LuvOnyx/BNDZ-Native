/**
 * Smoke-check studio engines: OpenPencil ready + OpenShop embed protocol present.
 * Run: node scripts/smoke-studio-engines.mjs
 */
import http from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const editors = join(root, 'public', 'editors');
const openpencil = join(editors, 'engines', 'openpencil', 'index.html');
const openshop = join(editors, 'engines', 'openshop', 'index.html');

if (!existsSync(openpencil)) throw new Error(`Missing ${openpencil}`);
if (!existsSync(openshop)) throw new Error(`Missing ${openshop}`);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
};

function serve(rootDir) {
  return http.createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      if (!rel || rel.endsWith('/')) rel += 'index.html';
      const abs = normalize(join(rootDir, rel));
      if (!abs.startsWith(rootDir) || !existsSync(abs) || !statSync(abs).isFile()) {
        res.writeHead(404);
        res.end('missing');
        return;
      }
      res.writeHead(200, { 'Content-Type': mime[extname(abs)] || 'application/octet-stream' });
      createReadStream(abs).pipe(res);
    } catch (err) {
      res.writeHead(500);
      res.end(String(err));
    }
  });
}

function staticOpenShopAudit() {
  const html = readFileSync(openshop, 'utf8');
  const checks = {
    embedReady: html.includes("openshop:ready"),
    embedHello: html.includes("openshop:hello"),
    embedOpen: html.includes("openshop:open"),
    embedExport: html.includes("openshop:export"),
    brush: /data-tool=["']brush["']/i.test(html),
    pen: /data-tool=["']pen["']/i.test(html),
    eraser: /data-tool=["']eraser["']/i.test(html),
    layers: /class=["'][^"']*layer/i.test(html) || html.includes('Layers'),
  };
  return checks;
}

async function main() {
  const results = [];
  const shopStatic = staticOpenShopAudit();
  results.push({ engine: 'openshop-static', ...shopStatic });

  const server = serve(editors);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error('[openpencil console]', msg.text());
    });
    await page.setContent(`<!doctype html><html><body style="margin:0">
<iframe id="f" src="http://127.0.0.1:${port}/engines/openpencil/index.html" style="width:100vw;height:100vh;border:0"></iframe>
<script>
window.__ready = null;
window.addEventListener('message', (ev) => {
  const d = ev.data;
  if (d && d.source === 'bndz-openpencil' && d.type === 'ready') window.__ready = d;
});
window.postToEngine = (msg) => document.getElementById('f').contentWindow.postMessage(msg, '*');
</script></body></html>`, { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(() => window.__ready != null, null, { timeout: 90000 });
    const ready = await page.evaluate(() => window.__ready);
    await page.evaluate(() => {
      window.postToEngine({ source: 'bndz-host', type: 'setTool', tool: 'pen' });
      window.postToEngine({
        source: 'bndz-host',
        type: 'setStyle',
        stroke: '#ff2bd6',
        fill: '#0d99ff',
        strokeWidth: 3,
      });
    });
    await page.waitForTimeout(600);
    const status = await page.frameLocator('#f').locator('.engine-status').textContent({ timeout: 8000 });
    results.push({
      engine: 'openpencil',
      ready: true,
      tools: Array.isArray(ready.tools) ? ready.tools.length : 0,
      status,
      penMapped: Array.isArray(ready.tools) && ready.tools.includes('pen'),
    });

    // OpenShop runtime: wait for ready announce (can be slow — huge single HTML)
    await page.setContent(`<!doctype html><html><body style="margin:0">
<iframe id="f" src="http://127.0.0.1:${port}/engines/openshop/index.html" style="width:100vw;height:100vh;border:0"></iframe>
<script>
window.__shop = [];
window.addEventListener('message', (ev) => {
  const d = ev.data;
  if (!d || typeof d !== 'object') return;
  window.__shop.push(d);
  if (d.type === 'openshop:ready' && !d.capabilities) {
    document.getElementById('f').contentWindow.postMessage({ version: 1, type: 'openshop:hello', id: 'smoke' }, '*');
  }
});
</script></body></html>`, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(
        () => (window.__shop || []).some((d) => d.type === 'openshop:ready' && d.capabilities),
        null,
        { timeout: 120000 },
      );
      const msg = await page.evaluate(() => (window.__shop || []).find((d) => d.capabilities));
      results.push({
        engine: 'openshop-runtime',
        ready: true,
        tools: msg?.capabilities?.tools?.length || 0,
        formats: msg?.capabilities?.exportFormats?.length || 0,
      });
    } catch (err) {
      results.push({
        engine: 'openshop-runtime',
        ready: false,
        error: String(err?.message || err),
        note: 'static embed audit still required',
      });
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(JSON.stringify(results, null, 2));
  const op = results.find((r) => r.engine === 'openpencil');
  const st = results.find((r) => r.engine === 'openshop-static');
  const ok =
    op?.ready &&
    op?.penMapped &&
    st?.embedReady &&
    st?.embedHello &&
    st?.embedOpen &&
    st?.embedExport &&
    st?.brush &&
    st?.pen &&
    st?.eraser;
  if (!ok) {
    console.error('Studio engine smoke FAILED');
    process.exit(1);
  }
  console.log('Studio engine smoke OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
