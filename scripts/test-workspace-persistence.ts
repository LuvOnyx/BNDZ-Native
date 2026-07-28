import assert from 'node:assert/strict';
import {
  defaultCanvas,
  hydrateSpatialCanvasFromJson,
  invalidateSpatialCanvasCache,
} from '../src/lib/spatialCanvasStore.ts';
import {
  defaultAutomationGraph,
  hydrateAutomationFromJson,
  invalidateAutomationCache,
} from '../src/lib/automationStore.ts';

function testSpatialCacheHydrateAfterEmptySave() {
  invalidateSpatialCanvasCache();
  const empty = { ...defaultCanvas(), items: [], panX: 120, panY: -40, zoom: 1.35 };
  hydrateSpatialCanvasFromJson(JSON.stringify(empty));
  const reloaded = hydrateSpatialCanvasFromJson(JSON.stringify(empty));
  assert.equal(reloaded?.items.length, 0);
  assert.equal(reloaded?.panX, 120);
  assert.equal(reloaded?.zoom, 1.35);
}

function testAutomationCacheHydrateEmptyNodes() {
  invalidateAutomationCache();
  const empty = {
    ...defaultAutomationGraph(),
    nodes: [],
    edges: [],
    viewport: { x: 200, y: 100, zoom: 1.1 },
  };
  hydrateAutomationFromJson(JSON.stringify(empty));
  const graph = hydrateAutomationFromJson(JSON.stringify(empty));
  assert.equal(graph?.nodes.length, 0);
  assert.equal(graph?.viewport?.zoom, 1.1);
}

function testAutomationDefaultGraphIsEmpty() {
  invalidateAutomationCache();
  const graph = defaultAutomationGraph();
  assert.equal(graph.nodes.length, 0);
  assert.equal(graph.edges.length, 0);
}

testSpatialCacheHydrateAfterEmptySave();
testAutomationCacheHydrateEmptyNodes();
testAutomationDefaultGraphIsEmpty();
console.log('workspace persistence: ok');
