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

export type FilesHostListingItem = {
  id?: string;
  name: string;
  path: string;
  type?: string;
  size?: number;
  modified?: string;
  extension?: string;
  isDirectory?: boolean;
};

export type FilesHostListingHandler = (path: string, items: FilesHostListingItem[], complete: boolean) => void;

function parseHostMessage(e: MessageEvent): any {
  try {
    return typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
  } catch {
    return null;
  }
}

/**
 * Listen for Files → React path pushes (`BNDZ_PANE_CONTEXT`).
 * Returns an unsubscribe function.
 */
export function subscribeFilesHostContext(handler: FilesHostContextHandler): () => void {
  const onMsg = (e: MessageEvent) => {
    try {
      const data = parseHostMessage(e);
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

/**
 * Listen for Files engine directory listings (`BNDZ_DIR_LISTING`).
 * Blend path: ShellViewModel enumerate → React list (skip GET_DIR_CONTENTS).
 */
export function subscribeFilesHostListing(handler: FilesHostListingHandler): () => void {
  const onMsg = (e: MessageEvent) => {
    try {
      const data = parseHostMessage(e);
      if (!data || data.type !== 'BNDZ_DIR_LISTING') return;
      const path = data.payload?.path;
      if (typeof path !== 'string' || !path.trim()) return;
      const raw = Array.isArray(data.payload?.items) ? data.payload.items : [];
      const items: FilesHostListingItem[] = raw.map((row: any) => {
        const p = String(row?.path || '');
        const name = String(row?.name || p.split(/[/\\]/).pop() || p);
        const isDir = row?.isDirectory === true || String(row?.type || '').toLowerCase() === 'directory';
        return {
          id: String(row?.id || p),
          name,
          path: p,
          type: isDir ? 'directory' : 'file',
          size: Number(row?.size) || 0,
          modified: String(row?.modified || ''),
          extension: String(row?.extension || ''),
          isDirectory: isDir,
        };
      }).filter((x: FilesHostListingItem) => !!x.path);
      handler(path.trim(), items, data.payload?.complete !== false);
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
