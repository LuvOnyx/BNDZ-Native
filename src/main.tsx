import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import './workstation/inspection/threeCompat';
import './lib/bndzFontPack';
import { IPC } from './lib/ipcBridge';
import App from './App.tsx';
import './index.css';

// Eager init — external OLE drops must not race the lazy FS-event listener registration.
IPC.init();

// Re-arm live automation watchers/schedules without requiring the Automation view.
void import('./lib/automationStore').then(({ restoreArmedAutomationsOnBoot }) => {
  void restoreArmedAutomationsOnBoot();
});

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
