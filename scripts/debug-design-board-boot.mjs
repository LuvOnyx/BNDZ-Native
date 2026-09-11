import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const editors = resolve(fileURLToPath(new URL('.', import.meta.url)), '../public/editors');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css' };

const srv = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname).replace(/^\//, '');
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  const abs = normalize(join(editors, rel));
  if (!abs.startsWith(editors) || !existsSync(abs)) { res.writeHead(404); return res.end('missing'); }
  res.writeHead(200, { 'Content-Type': mime[extname(abs)] || 'application/octet-stream' });
  createReadStream(abs).pipe(res);
});

await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const { port } = srv.address();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', (m) => console.log('C', m.type(), m.text()));
page.on('pageerror', (e) => console.log('PE', e.message));
await page.goto(`http://127.0.0.1:${port}/bndz-design-board.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForTimeout(20000);
const snap = await page.evaluate(() => ({
  ready: document.getElementById('workspace')?.dataset?.engineReady,
  engine: !!window.__BNDZ_OP_ENGINE__,
  hook: typeof window.__bndzDesignBoardOnEngine,
  hostHtml: document.getElementById('engine-host')?.innerHTML?.slice(0, 120),
  canvasW: document.querySelector('#engine-host canvas')?.width,
}));
console.log(JSON.stringify(snap, null, 2));
await browser.close();
srv.close();
