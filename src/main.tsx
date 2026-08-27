import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import './workstation/inspection/threeCompat';
import { IPC } from './lib/ipcBridge';
import App from './App.tsx';
import './index.css';
import { isFilesHostBoot } from './lib/filesHostBoot';
import { getFileDragSession } from './lib/fileDragSession';
import { installOleDragEscalateGhostHook } from './lib/fileDragUiCleanup';
import { configureExplorerGradeDragThreshold } from './lib/dragController';

// Eager init — external OLE drops must not race the lazy FS-event listener registration.
IPC.init();
if (typeof window !== 'undefined' && !!(window as any).chrome?.webview) {
  configureExplorerGradeDragThreshold(true);
  (window as any).__bndzOleSmokeArm = (paths: string | string[]) => {
    const list = Array.isArray(paths) ? paths : [paths];
    IPC.notifyFileDragActive(true, list);
    IPC.postOleDndDebug({ kind: 'ole-smoke-arm', pathCount: list.length, sample: list.slice(0, 2) });
  };
}
// Host ExecuteScript calls window.__bndzDismissDragGhost before DoDragDrop — install before first paint.
installOleDragEscalateGhostHook();

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
 * Explorer → BNDZ hover/drop bridge.
 *
 * Chromium's IDropTarget returns DROPEFFECT_NONE (forbidden X) unless dragover
 * calls preventDefault. That is required even when native OLE is also registered —
 * if OLE owns the HWND, HTML5 events never fire; if Chromium still owns it, this
 * is the only way to get a copy cursor. Drop preventDefault only when paths extract —
 * empty File.path leaves Path A (NavigationStarting file:) available.
 */
function installExternalOleDragBridge() {
  const isNative = typeof window !== 'undefined'
    && !!(window as Window & { chrome?: { webview?: unknown } }).chrome?.webview;
  let lastHoverMs = 0;
  const hasFilePayload = (types: readonly string[]) =>
    types.some(t => t === 'Files' || /file|uri-list/i.test(t));

  const extractLocalPaths = (dt: DataTransfer | null): string[] => {
    if (!dt) return [];
    const out: string[] = [];
    const files = dt.files;
    if (files?.length) {
      for (let i = 0; i < files.length; i++) {
        const f = files[i] as File & { path?: string };
        const p = typeof f.path === 'string' ? f.path.trim() : '';
        if (p) out.push(p.replace(/\//g, '\\'));
      }
    }
    try {
      const uriList = dt.getData('text/uri-list');
      if (uriList) {
        for (const line of uriList.split(/\r?\n/)) {
          const t = line.trim();
          if (!t || t.startsWith('#')) continue;
          if (t.startsWith('file:///')) {
            try {
              const local = decodeURIComponent(t.replace(/^file:\/\/\//i, '').replace(/\//g, '\\'));
              if (local) out.push(local);
            } catch { /* ignore */ }
          } else if (/^[a-zA-Z]:[\\/]/.test(t)) {
            out.push(t.replace(/\//g, '\\'));
          }
        }
      }
    } catch { /* ignore */ }
    return [...new Set(out)];
  };

  const onDragEnter = (e: DragEvent) => {
    const types = e.dataTransfer?.types;
    // Explorer→WebView2 often has empty types on enter — still accept to kill the X cursor.
    if (types?.length && !hasFilePayload(types) && e.dataTransfer?.effectAllowed === 'none') return;
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
      e.dataTransfer.effectAllowed = 'copyMove';
    }
  };

  const onDragOver = (e: DragEvent) => {
    const types = e.dataTransfer?.types;
    if (types?.length && !hasFilePayload(types)) return;
    // MUST preventDefault — otherwise Chromium reports DROPEFFECT_NONE (X cursor).
    e.preventDefault();
    if (e.dataTransfer) {
      const copy = e.ctrlKey || e.altKey;
      e.dataTransfer.dropEffect = copy ? 'copy' : 'move';
      e.dataTransfer.effectAllowed = 'copyMove';
    }
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
    if (types?.length && !hasFilePayload(types)) return;

    if (!isNative) {
      e.preventDefault();
      return;
    }

    // Prefer extracted paths; only preventDefault when we own the commit so Path A
    // (NavigationStarting file:) can still fire when File.path is empty in WebView2.
    const paths = extractLocalPaths(e.dataTransfer);
    if (paths.length) {
      e.preventDefault();
      e.stopPropagation();
      const liveSession = getFileDragSession();
      window.dispatchEvent(new CustomEvent('bndz-external-drop', {
        detail: {
          paths,
          webViewX: e.clientX,
          webViewY: e.clientY,
          preferredEffect: liveSession?.op === 'move' ? 'move' : 'copy',
          fromBndzOle: !!liveSession,
          coordSource: 'html5',
        },
      }));
    }
  };

  window.addEventListener('dragenter', onDragEnter, true);
  window.addEventListener('dragover', onDragOver, true);
  window.addEventListener('drop', onDrop, true);
}

installExternalOleDragBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
