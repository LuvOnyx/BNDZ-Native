/**
 * Integration smoke: Design Board inline OpenPencil + Figma tool rail.
 */
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const editors = join(root, 'public', 'editors');
const board = join(editors, 'bndz-design-board.html');
const embed = join(editors, 'engines', 'openpencil', 'embed.js');
if (!existsSync(board)) throw new Error(`Missing ${board}`);
if (!existsSync(embed)) throw new Error(`Missing ${embed} — rebuild openpencil-host`);

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
    res.writeHead(200, { 'Content-Type': mime[extname(abs)] || 'application/octet-stream' });
    createReadStream(abs).pipe(res);
  });
}

async function queryEngine(page) {
  return page.evaluate(() => {
    const api = window.__BNDZ_OP_ENGINE__;
    if (!api?.getState) return { error: 'no-inline-api' };
    return { source: 'bndz-openpencil', type: 'state', ...api.getState() };
  });
}

async function main() {
  const server = serve(editors);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`http://127.0.0.1:${port}/bndz-design-board.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    page.on('console', (msg) => { console.log('[console]', msg.type(), msg.text()); if (msg.type() === 'error') errors.push(msg.text()); });
    await page.waitForFunction(() => document.getElementById('workspace')?.dataset?.engineReady === '1', null, { timeout: 90000 });

    const before = await queryEngine(page);
    await page.locator('#tool-rail .tool-btn[data-tool="rect"]').click();
    await page.waitForTimeout(250);
    const afterTool = await queryEngine(page);

    const canvas = page.locator('#engine-host canvas').first();
    await canvas.waitFor({ state: 'visible', timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas box');

    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const afterDraw = await queryEngine(page);

    const result = {
      inline: true,
      errors: errors.slice(0, 8),
      before,
      afterTool,
      afterDraw,
      toolMapped: afterTool?.activeTool === 'RECTANGLE',
      drewShape: (afterDraw?.nodeCount ?? 0) > (before?.nodeCount ?? 0),
    };
    console.log(JSON.stringify(result, null, 2));
    if (!result.toolMapped || !result.drewShape) process.exit(1);
    console.log('Design board inline tool smoke OK');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
