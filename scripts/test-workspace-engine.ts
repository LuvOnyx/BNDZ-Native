import assert from 'node:assert/strict';
import { WorkspaceInteractionEngine } from '../src/lib/workspace/WorkspaceInteractionEngine.ts';

function testSubscribeTransformReceivesTransformOnBind() {
  const engine = new WorkspaceInteractionEngine();
  const seen: Array<{ panX: number; panY: number; zoom: number }> = [];
  engine.subscribeTransform(t => {
    assert.ok(t, 'transform listener must receive transform object');
    assert.equal(typeof t.panX, 'number');
    assert.equal(typeof t.panY, 'number');
    assert.equal(typeof t.zoom, 'number');
    seen.push({ panX: t.panX, panY: t.panY, zoom: t.zoom });
  });

  const layer = { style: { transform: '' } } as unknown as HTMLElement;
  engine.bindElements(layer);
  assert.ok(seen.length >= 1, 'bindElements must notify transform listeners');
  const last = seen[seen.length - 1]!;
  assert.equal(last.panX, 0);
  assert.equal(last.zoom, 1);
  engine.destroy();
}

function testApplyNotifiesWithTransform() {
  const engine = new WorkspaceInteractionEngine();
  let last: { panX: number; panY: number; zoom: number } | null = null;
  engine.subscribeTransform(t => { last = t; });
  const layer = { style: { transform: '' } } as unknown as HTMLElement;
  engine.bindElements(layer);
  engine.setTransform(40, -20, 1.25, true);
  assert.ok(last, 'setTransform(immediate) must notify transform listeners');
  assert.equal(last!.panX, 40);
  assert.equal(last!.panY, -20);
  assert.equal(last!.zoom, 1.25);
  engine.destroy();
}

function testNormalizeRejectsInvalidNumbers() {
  const engine = new WorkspaceInteractionEngine();
  const t = engine.setTransform(Number.NaN, undefined as unknown as number, Infinity, true);
  assert.equal(t.panX, 0);
  assert.equal(t.panY, 0);
  assert.ok(Number.isFinite(t.zoom));
  engine.destroy();
}

testSubscribeTransformReceivesTransformOnBind();
testApplyNotifiesWithTransform();
testNormalizeRejectsInvalidNumbers();
console.log('workspace engine: ok');
