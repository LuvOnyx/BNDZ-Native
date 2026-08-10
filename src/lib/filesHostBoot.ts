/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { toWindowsPath, normalizePanePath } from './pathUtils';

/** True when FilesMerge hosts full classic BNDZUI (`?filesHost=1`). Archived — BNDZ-Native uses native list + craft islands only. */
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

/** Convert pane/virtual path to what Files NavigateToPath understands. */
function toFilesHostNavPath(path: string): string {
  const norm = normalizePanePath(path);
  if (!norm) return path;
  if (norm === '/') return 'Home';
  if (norm.toLowerCase().startsWith('/shell:')) return norm.slice(1); // shell:Desktop
  if (norm.startsWith('/bndz/')) return norm; // virtual — host may ignore / fall through
  return toWindowsPath(norm);
}

/** Tell Files shell to sync the active tab path (best-effort). */
export function notifyFilesHostNavigate(path: string): void {
  if (!isFilesHostBoot() || !path) return;
  postToHost('BNDZ_PANE_NAVIGATE', { path: toFilesHostNavPath(path) });
}

/** Ask Files ShellViewModel to re-push `BNDZ_DIR_LISTING` (never use GET_DIR_CONTENTS on blend). */
export function requestFilesHostDirListing(path?: string): void {
  if (!isFilesHostBoot()) return;
  postToHost('BNDZ_REQUEST_DIR_LISTING', path ? { path: toFilesHostNavPath(path) } : {});
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
      handler(normalizePanePath(path.trim()), items, data.payload?.complete !== false);
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
