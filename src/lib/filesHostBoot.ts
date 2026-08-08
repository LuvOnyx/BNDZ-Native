/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** True when FilesMerge hosts full classic BNDZUI (`?filesHost=1`). */
export function isFilesHostBoot(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('filesHost') === '1';
  } catch {
    return false;
  }
}

export function applyFilesHostDocumentMark(): void {
  if (!isFilesHostBoot()) return;
  try {
    document.documentElement.dataset.bndzShell = 'files-host';
    document.title = 'BNDZ';
    document.body?.classList.add('bndz-files-host-body');
  } catch {
    /* ignore */
  }
}

function postToHost(type: string, payload: Record<string, unknown>): void {
  try {
    (window as any).chrome?.webview?.postMessage({ type, payload });
  } catch {
    /* ignore */
  }
}

/** Tell Files shell to sync the active tab path (best-effort). */
export function notifyFilesHostNavigate(path: string): void {
  if (!isFilesHostBoot() || !path) return;
  postToHost('BNDZ_PANE_NAVIGATE', { path });
}

export type FilesHostContextHandler = (path: string) => void;

/**
 * Listen for Files → React path pushes (`BNDZ_PANE_CONTEXT`).
 * Returns an unsubscribe function.
 */
export function subscribeFilesHostContext(handler: FilesHostContextHandler): () => void {
  const onMsg = (e: MessageEvent) => {
    try {
      const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      if (!data || data.type !== 'BNDZ_PANE_CONTEXT') return;
      const path = data.payload?.path;
      if (typeof path === 'string' && path.trim()) handler(path.trim());
    } catch {
      /* ignore */
    }
  };
  try {
    (window as any).chrome?.webview?.addEventListener('message', onMsg);
  } catch {
    /* ignore */
  }
  return () => {
    try {
      (window as any).chrome?.webview?.removeEventListener('message', onMsg);
    } catch {
      /* ignore */
    }
  };
}
