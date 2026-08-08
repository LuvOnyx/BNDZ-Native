import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import './workstation/inspection/threeCompat';
import { IPC } from './lib/ipcBridge';
import App from './App.tsx';
import './index.css';
import { isFilesHostBoot } from './lib/filesHostBoot';

// Eager init — external OLE drops must not race the lazy FS-event listener registration.
IPC.init();

const filesHost = isFilesHostBoot();

// Full font pack is heavy — on FilesMerge, paint chrome first, hydrate faces when idle.
const loadFontPack = () => {
  void import('./lib/bndzFontPack');
};
if (filesHost) {
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof ric === 'function') ric(() => loadFontPack(), { timeout: 2500 });
  else window.setTimeout(loadFontPack, 800);
} else {
  loadFontPack();
}

// Re-arm live automation watchers/schedules without requiring the Automation view.
// filesHost: defer — contending with first GET_DIR_CONTENTS / settings floods the pipe.
const scheduleBootAutomations = () => {
  void import('./lib/automationStore').then(({ restoreArmedAutomationsOnBoot }) => {
    void restoreArmedAutomationsOnBoot();
  });
};
if (filesHost) {
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof ric === 'function') ric(() => scheduleBootAutomations(), { timeout: 8000 });
  else window.setTimeout(scheduleBootAutomations, 5000);
} else {
  scheduleBootAutomations();
}

/**
 * Explorer → BNDZ hover bridge. Host keeps AllowExternalDrop=true (except during BNDZ OLE)
 * so Chromium accepts the drag; NavigationStarting intercepts file: drops (Path A).
 * JS reports hover coords for list targeting; preventDefault avoids default open.
 */
function installExternalOleDragBridge() {
  let lastHoverMs = 0;
  const hasFilePayload = (types: readonly string[]) =>
    types.some(t => t === 'Files' || /file|uri-list/i.test(t));

  const onDragOver = (e: DragEvent) => {
    const types = e.dataTransfer?.types;
    if (!types?.length || !hasFilePayload(types)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    const now = performance.now();
    if (now - lastHoverMs < 40) return;
    lastHoverMs = now;
    const wv = (window as Window & { chrome?: { webview?: { postMessage: (msg: unknown) => void } } }).chrome?.webview;
    wv?.postMessage?.({
      type: 'EXTERNAL_DRAG_HOVER_REPORT',
      payload: { webViewX: e.clientX, webViewY: e.clientY },
    });
  };

  const onDrop = (e: DragEvent) => {
    const types = e.dataTransfer?.types;
    if (!types?.length || !hasFilePayload(types)) return;
    // Host handles via NavigationStarting / WPF PreviewDrop — do not stopPropagation.
    e.preventDefault();
  };

  window.addEventListener('dragover', onDragOver, true);
  window.addEventListener('drop', onDrop, true);
}

installExternalOleDragBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
