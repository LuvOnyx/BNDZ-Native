import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Load the BNDZ OpenShop add-on in a bare sandbox and test its pure selection helpers.
const src = readFileSync(new URL('../public/editors/engines/openshop/bndz-stub-tools.js', import.meta.url), 'utf8');
const sandbox: any = { window: {}, document: {} };
vm.runInNewContext(src, sandbox);
const api = sandbox.window.__BNDZ_STUB_TOOLS__;
assert.ok(api, 'stub tools API exported');

// Document-space outline follows zoom/pan: same doc points at 2x zoom + offset.
const pts = [{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 40 }];
assert.equal(api.projectDocPoints(pts, [1, 0, 0, 1, 0, 0]), '10,20 30,20 30,40');
assert.equal(api.projectDocPoints(pts, [2, 0, 0, 2, 100, 50]), '120,90 160,90 160,130');
assert.equal(api.projectDocPoints(pts, [0.5, 0, 0, 0.5, 0, 0]), '5,10 15,10 15,20');

const full = api.fullDocumentMask(4, 3);
assert.equal(full.w, 4);
assert.equal(full.h, 3);
assert.equal(full.mask.length, 12);
assert.ok(Array.from(full.mask).every((v: number) => v === 255));

assert.ok(api.rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }));
assert.ok(!api.rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 }));

console.log('openshop selection: ok');
