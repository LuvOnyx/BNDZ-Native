/**
 * Headless harness for the preview-panel 3D/RAGE viewport (GpuModelViewport).
 * Driven by scripts/test-model-viewport-render.mjs -- not part of the app bundle.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import GpuModelViewport from '../../src/workstation/inspection/GpuModelViewport';

(window as Window & { __BNDZ_MODEL_DEBUG__?: boolean }).__BNDZ_MODEL_DEBUG__ = true;
const src = new URLSearchParams(window.location.search).get('src') || '';
createRoot(document.getElementById('stage')!).render(
  <GpuModelViewport src={src} title="harness" badge="glb" />,
);
