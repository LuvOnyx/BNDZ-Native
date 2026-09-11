/**
 * Smoke: OpenShop embed bind + open a tiny PNG through the BNDZ host protocol.
 * Run: node scripts/smoke-photo-studio-open.mjs
 */
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const editors = join(root, 'public', 'editors');
const openshop = join(editors, 'engines', 'openshop', 'index.html');
if (!existsSync(openshop)) throw new Error(`Missing ${openshop}`);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

async function main() {
  const server = serve(editors);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body style="margin:0">
<iframe id="f" src="http://127.0.0.1:${port}/engines/openshop/index.html" style="width:960px;height:720px;border:0"></iframe>
<script>
window.__log = [];
window.addEventListener('message', (ev) => {
  const d = ev.data;
  if (!d || typeof d !== 'object' || !String(d.type || '').startsWith('openshop:')) return;
  window.__log.push(d);
  const f = document.getElementById('f').contentWindow;
  if (d.type === 'openshop:ready' && !d.capabilities) {
    f.postMessage({ version: 1, type: 'openshop:hello', id: 'smoke' }, '*');
  }
  if (d.type === 'openshop:ready' && d.capabilities) {
    f.postMessage({ version: 1, type: 'openshop:configure', id: 'cfg', overrides: { open: true, save: true } }, '*');
  }
  if (d.type === 'openshop:configured') {
    f.postMessage({
      version: 1,
      type: 'openshop:open',
      id: 'open',
      document: { dataUrl: ${JSON.stringify(tinyPng)}, name: 'smoke.png' }
    }, '*');
  }
});
</script></body></html>`, { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(
      () => (window.__log || []).some((d) => d.type === 'openshop:opened'),
      null,
      { timeout: 120000 },
    );
    const opened = await page.evaluate(() => (window.__log || []).some((d) => d.type === 'openshop:opened'));
    const welcomeHidden = await page.frameLocator('#f').locator('.welcome-launch').isHidden({ timeout: 5000 }).catch(() => true);
    console.log(JSON.stringify({ opened, welcomeHidden }, null, 2));
    if (!opened) {
      console.error('Photo Studio open smoke FAILED');
      process.exit(1);
    }
    console.log('Photo Studio open smoke OK');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
