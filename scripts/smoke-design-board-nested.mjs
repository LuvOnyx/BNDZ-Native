/**
 * Nested iframe smoke — mirrors BNDZ React host → design board → OpenPencil.
 */
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const editors = join(root, 'public', 'editors');

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
};

function serve(rootDir) {
  return http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    const abs = normalize(join(rootDir, rel));
    if (!abs.startsWith(rootDir) || !existsSync(abs) || !statSync(abs).isFile()) {
      res.writeHead(404);
      res.end('missing');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mime[extname(abs)] || 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    });
    createReadStream(abs).pipe(res);
  });
}

async function queryEngine(outerPage) {
  return outerPage.frames()[1]?.evaluate(() => new Promise((resolve) => {
    const frame = document.getElementById('engine-frame');
    if (!frame?.contentWindow) return resolve({ error: 'no-engine-frame' });
    const onMsg = (ev) => {
      const d = ev.data;
      if (d?.source === 'bndz-openpencil' && d.type === 'state') {
        window.removeEventListener('message', onMsg);
        resolve(d);
      }
    };
    window.addEventListener('message', onMsg);
    frame.contentWindow.postMessage({ source: 'bndz-host', type: 'getState' }, '*');
    setTimeout(() => { window.removeEventListener('message', onMsg); resolve({ error: 'timeout' }); }, 5000);
  }));
}

async function main() {
  const server = serve(editors);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.setContent(`<!doctype html><html><body style="margin:0;height:100vh">
<iframe id="board" sandbox="allow-scripts allow-same-origin allow-downloads allow-modals"
  src="http://127.0.0.1:${port}/bndz-design-board.html"
  style="width:100%;height:100%;border:0"></iframe></body></html>`, { waitUntil: 'domcontentloaded' });

    const boardFrame = page.frameLocator('#board');
    await boardFrame.locator('#workspace').waitFor({ timeout: 30000 });
    await page.waitForFunction(() => {
      const f = document.getElementById('board');
      return f?.contentWindow?.document?.getElementById('workspace')?.dataset?.engineReady === '1';
    }, null, { timeout: 90000 });

    const before = await queryEngine(page);
    await boardFrame.locator('#tool-rail .tool-btn[data-tool="rect"]').click();
    await page.waitForTimeout(300);
    const afterTool = await queryEngine(page);

    const engineBox = await boardFrame.frameLocator('#engine-frame').locator('canvas').first().boundingBox();
    if (!engineBox) throw new Error('no engine canvas box');

    const outerBox = await page.locator('#board').boundingBox();
    const x1 = outerBox.x + engineBox.x + engineBox.width * 0.35;
    const y1 = outerBox.y + engineBox.y + engineBox.height * 0.35;
    const x2 = outerBox.x + engineBox.x + engineBox.width * 0.55;
    const y2 = outerBox.y + engineBox.y + engineBox.height * 0.55;
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move(x2, y2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const afterDraw = await queryEngine(page);

    const result = {
      nested: true,
      errors: errors.slice(0, 8),
      before,
      afterTool,
      afterDraw,
      ok: afterTool?.activeTool === 'RECTANGLE' && (afterDraw?.nodeCount ?? 0) > (before?.nodeCount ?? 0),
    };
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
    console.log('Nested design board smoke OK');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
