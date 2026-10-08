/**
 * Headless render test for the preview-panel 3D / RAGE orbit viewport.
 *
 *   node scripts/test-model-viewport-render.mjs <model.glb> [more.glb ...]
 *
 * Boots the Vite dev server, opens e2e/harness/model-viewport.html in headless Edge, loads each
 * GLB (e.g. a RAGE .yft converted by RageModelPreviewService) and checks the gimbal:
 *   - orbit pivot is the model's bounding-box centre and the model is framed in the viewport
 *   - horizontal drag orbits around +Y (up) only; vertical drag never flips past the poles
 *   - double-click resets to the framed home view
 *   - interface-scale CSS zoom and panel resize keep the canvas matched to its container
 * Set BNDZ_MODEL_SHOTS=<dir> to save the framed home view of each model as a PNG.
 */
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node scripts/test-model-viewport-render.mjs <model.glb> [...]');
  process.exit(2);
}

const fail = msg => { throw new Error(msg); };
const assert = (c, m) => { if (!c) fail(m); };

const server = await createServer({
  configFile: 'vite.config.ts',
  logLevel: 'error',
  // Only crawl the harness -- the repo holds build outputs (dist/, artifacts/) full of html entries.
  optimizeDeps: { entries: ['e2e/harness/model-viewport.html'] },
  server: {
    port: 5199,
    strictPort: false,
    watch: { ignored: ['**/dist/**', '**/artifacts/**', '**/BNDZBackend/**', '**/BNDZShell/**', '**/external/**', '**/public/**'] },
  },
});
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failures = 0;

async function waitProbe(page) {
  await page.waitForFunction(() => typeof window.__bndzModelViewportProbe === 'function', null, { timeout: 180000 });
  await page.waitForTimeout(400);
  return page.evaluate(() => window.__bndzModelViewportProbe());
}

/** Non-background pixel bounds of the canvas (in canvas CSS px) via a page-side PNG decode. */
async function coverage(page) {
  const el = await page.$('#stage canvas');
  const png = (await el.screenshot()).toString('base64');
  return page.evaluate(async b64 => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const { data } = g.getImageData(0, 0, c.width, c.height);
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, n = 0, sx = 0, sy = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      // background #0a0a0c
      if (Math.abs(data[i] - 10) + Math.abs(data[i + 1] - 10) + Math.abs(data[i + 2] - 12) > 24) {
        n++; sx += x; sy += y;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    return { w: c.width, h: c.height, n, cx: n ? sx / n / c.width : 0, cy: n ? sy / n / c.height : 0,
      bbox: n ? { x0: minX / c.width, y0: minY / c.height, x1: maxX / c.width, y1: maxY / c.height } : null };
  }, png);
}

for (const file of files) {
  const name = path.basename(file);
  const page = await browser.newPage({ viewport: { width: 800, height: 700 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('http://harness.local/**', route => route.fulfill({
    status: 200, contentType: 'model/gltf-binary', body: fs.readFileSync(file),
  }));
  try {
    await page.goto(`${base}/e2e/harness/model-viewport.html?src=${encodeURIComponent(`http://harness.local/${name}`)}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    const p0 = await waitProbe(page);
    const t = p0.target;
    assert(Math.hypot(...t) < 1e-3 * Math.max(1, p0.distance), `${name}: pivot not at bbox centre ${t}`);
    const c = p0.box.min.map((v, i) => (v + p0.box.max[i]) / 2);
    assert(Math.hypot(...c) < 1e-3 * Math.max(1, p0.distance), `${name}: model not recentred ${c}`);
    assert(p0.polar > 0.06 && p0.polar < Math.PI - 0.06, `${name}: start polar ${p0.polar}`);
    if (process.env.BNDZ_MODEL_SHOTS) {
      await (await page.$('#stage')).screenshot({ path: path.join(process.env.BNDZ_MODEL_SHOTS, `${name}.png`) });
    }
    const cov0 = await coverage(page);
    assert(cov0.n > 0.03 * cov0.w * cov0.h, `${name}: model barely visible (${cov0.n} px)`);
    assert(cov0.bbox.x0 > 0.005 && cov0.bbox.x1 < 0.995, `${name}: model clipped horizontally ${JSON.stringify(cov0.bbox)}`);
    assert(Math.abs(cov0.cx - 0.5) < 0.12 && Math.abs(cov0.cy - 0.5) < 0.14, `${name}: model off-centre cx=${cov0.cx.toFixed(3)} cy=${cov0.cy.toFixed(3)}`);

    // Horizontal drag: orbit around world up only (polar unchanged, azimuth changes, pivot fixed).
    const box = await (await page.$('#stage canvas')).boundingBox();
    const mx = box.x + box.width / 2, my = box.y + box.height / 2;
    await page.mouse.move(mx, my); await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(mx - i * 12, my);
    await page.mouse.up();
    const p1 = await waitProbe(page);
    assert(Math.abs(p1.polar - p0.polar) < 0.02, `${name}: horizontal drag tilted the model (polar ${p0.polar.toFixed(3)} -> ${p1.polar.toFixed(3)})`);
    assert(Math.abs(p1.azimuth - p0.azimuth) > 0.3, `${name}: horizontal drag did not orbit (azimuth ${p0.azimuth.toFixed(3)} -> ${p1.azimuth.toFixed(3)})`);
    assert(Math.hypot(...p1.target) < 1e-3 * Math.max(1, p1.distance), `${name}: pivot drifted on orbit`);
    assert(Math.abs(p1.distance - p0.distance) / p0.distance < 0.01, `${name}: orbit changed distance`);
    assert(p1.up[1] === 1, `${name}: camera up changed`);

    // Hard vertical drag past the top pole: must clamp, never flip.
    await page.mouse.move(mx, my); await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(mx, my + i * 40);
    await page.mouse.up();
    const p2 = await waitProbe(page);
    assert(p2.polar >= 0.059 && p2.polar < 0.2, `${name}: top pole not clamped (polar ${p2.polar.toFixed(4)})`);
    await page.mouse.move(mx, my - 10); await page.mouse.down();
    for (let i = 1; i <= 25; i++) await page.mouse.move(mx, my - i * 40);
    await page.mouse.up();
    const p3 = await waitProbe(page);
    assert(p3.polar <= Math.PI - 0.059 && p3.polar > Math.PI - 0.2, `${name}: bottom pole not clamped (polar ${p3.polar.toFixed(4)})`);

    // Double-click resets to the framed home view.
    await page.mouse.dblclick(mx, my);
    const p4 = await waitProbe(page);
    assert(p4.position.every((v, i) => Math.abs(v - p0.position[i]) < 1e-3 * Math.max(1, p0.distance)), `${name}: reset did not return home`);

    // Interface scale (CSS zoom on <html>) + panel resize: canvas must match its container.
    await page.evaluate(() => {
      document.documentElement.style.zoom = '1.25';
      const s = document.getElementById('stage');
      s.style.width = '300px';
      s.style.height = '380px';
    });
    await page.waitForTimeout(500);
    const sizes = await page.evaluate(() => {
      const s = document.getElementById('stage');
      const cv = s.querySelector('canvas');
      return { stageW: s.offsetWidth, stageH: s.offsetHeight, cssW: parseFloat(cv.style.width), cssH: parseFloat(cv.style.height), bufW: cv.width, bufH: cv.height };
    });
    assert(Math.abs(sizes.cssW - sizes.stageW) <= 1 && Math.abs(sizes.cssH - sizes.stageH) <= 1, `${name}: canvas ${sizes.cssW}x${sizes.cssH} != container ${sizes.stageW}x${sizes.stageH} under zoom`);
    assert(sizes.bufW >= Math.round(sizes.stageW * 1.25) - 1, `${name}: drawing buffer not scaled for zoom (${sizes.bufW})`);
    const cov1 = await coverage(page);
    assert(Math.abs(cov1.cx - 0.5) < 0.12 && Math.abs(cov1.cy - 0.5) < 0.14, `${name}: off-centre after zoom/resize cx=${cov1.cx.toFixed(3)} cy=${cov1.cy.toFixed(3)}`);
    assert(cov1.bbox.x0 > 0.005 && cov1.bbox.x1 < 0.995, `${name}: clipped after zoom/resize ${JSON.stringify(cov1.bbox)}`);

    const real = errors.filter(e => !/Download the React DevTools|THREE\.Clock/.test(e));
    assert(!real.length, `${name}: console errors: ${real.join(' | ')}`);
    console.log(`PASS ${name}: box ${p0.box.max.map((v, i) => (v - p0.box.min[i]).toFixed(2)).join(' x ')} (X x Y-up x Z-front), dist ${p0.distance.toFixed(2)}, polar ${p0.polar.toFixed(3)}, ` +
      `centre (${cov0.cx.toFixed(3)}, ${cov0.cy.toFixed(3)}), drag dAz ${(p1.azimuth - p0.azimuth).toFixed(3)} dPolar ${(p1.polar - p0.polar).toFixed(4)}, poles [${p2.polar.toFixed(3)}, ${p3.polar.toFixed(3)}], zoom canvas ${sizes.cssW}x${sizes.cssH} buf ${sizes.bufW}x${sizes.bufH}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${e.message}`);
    await page.screenshot({ path: path.join(process.env.TEMP || '.', `bndz-model-${name}.png`) }).catch(() => {});
  }
  await page.close();
}

await browser.close();
await server.close();
process.exit(failures ? 1 : 0);
