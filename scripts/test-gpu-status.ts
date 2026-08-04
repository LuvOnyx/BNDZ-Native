/**
 * Classification helpers for honest GPU HUD — no DOM required.
 * Run: npx tsx scripts/test-gpu-status.ts
 */
import assert from 'node:assert/strict';
import {
  formatGpuHudLine,
  mergeGpuStatus,
  type GpuStatus,
} from '../src/lib/gpuStatus';

function classifyViaMerge(renderer: string, vendor = '', featureStatus: Record<string, string> = {}) {
  return mergeGpuStatus(
    {
      ok: true,
      renderer,
      vendor,
      adapter: renderer,
      featureStatus,
    },
    {
      hardwareAccelerated: null,
      compositing: 'unknown',
      renderer: '',
      vendor: '',
      adapter: '',
      angleBackend: '',
      featureStatus: {},
      source: 'unavailable',
      flagsRequested: [],
      detail: '',
    } satisfies GpuStatus,
  );
}

{
  const s = classifyViaMerge(
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'Google Inc. (NVIDIA)',
    { gpu_compositing: 'enabled', rasterization: 'enabled', webgl: 'enabled' },
  );
  assert.equal(s.compositing, 'gpu');
  assert.equal(s.hardwareAccelerated, true);
  assert.equal(s.angleBackend, 'Direct3D11');
  assert.equal(formatGpuHudLine(s), 'GPU Direct3D11');
}

{
  const s = classifyViaMerge(
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader)',
    'Google Inc.',
    { gpu_compositing: 'disabled_software' },
  );
  assert.equal(s.compositing, 'software');
  assert.equal(s.hardwareAccelerated, false);
  assert.equal(formatGpuHudLine(s), 'SOFTWARE');
}

{
  const s = classifyViaMerge(
    'Microsoft Basic Render Driver',
    'Microsoft',
  );
  assert.equal(s.compositing, 'software');
  assert.equal(s.hardwareAccelerated, false);
}

console.log('test-gpu-status: ok');
