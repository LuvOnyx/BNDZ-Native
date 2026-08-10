/**
 * BNDZShell greenfield host: full BNDZUI (`?nativeShell=1`) + native WinUI list in the workspace slot.
 * Mirrors filesHostBoot — React owns chrome; host owns folder enumeration for the primary list.
 */

import { toWindowsPath, normalizePanePath } from './pathUtils';

/** Full product face on BNDZShell (not craft-island `pane=` routes). */
export function isNativeShellHostBoot(): boolean {
  try {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('nativeShell') === '1' && !sp.get('pane');
  } catch {
    return false;
  }
}

/** Chrome/sidebar craft islands — full BNDZUI regions in WinUI split; host owns FS list. */
export function isNativeShellCraftIslandBoot(): boolean {
  try {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('nativeShell') !== '1') return false;
    const pane = sp.get('pane');
    return pane === 'chrome' || pane === 'sidebar';
  } catch {
    return false;
  }
}

export function applyNativeShellHostDocumentMark(): void {
  if (!isNativeShellHostBoot()) return;
  try {
    document.documentElement.dataset.bndzShell = 'native-host';
    document.title = 'BNDZ';
    document.body?.classList.add('bndz-native-host-body');
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

function toHostNavPath(path: string): string {
  const norm = normalizePanePath(path);
  if (!norm) return path;
  // This PC sentinel — ShellPathResolver maps literal "/" (toWindowsPath('/') wrongly yields "").
  if (norm === '/') return '/';
  if (norm.toLowerCase().startsWith('/shell:')) return norm.slice(1);
  if (norm.startsWith('/bndz/')) return norm;
  return toWindowsPath(norm);
}

export function notifyNativeShellNavigate(path: string): void {
  if ((!isNativeShellHostBoot() && !isNativeShellCraftIslandBoot()) || !path) return;
  postToHost('BNDZ_PANE_NAVIGATE', { path: toHostNavPath(path) });
}

export function requestNativeShellDirListing(path?: string): void {
  if (!isNativeShellHostBoot()) return;
  postToHost('BNDZ_REQUEST_DIR_LISTING', path ? { path: toHostNavPath(path) } : {});
}

export type NativeShellListingItem = {
  id?: string;
  name: string;
  path: string;
  type?: string;
  size?: number;
  modified?: string;
  extension?: string;
  isDirectory?: boolean;
};

export type NativeShellListingHandler = (
  path: string,
  items: NativeShellListingItem[],
  complete: boolean,
) => void;

function parseHostMessage(e: MessageEvent): any {
  try {
    return typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
  } catch {
    return null;
  }
}

export function subscribeNativeShellListing(handler: NativeShellListingHandler): () => void {
  const onMsg = (e: MessageEvent) => {
    try {
      const data = parseHostMessage(e);
      if (!data || data.type !== 'BNDZ_DIR_LISTING') return;
      const path = data.payload?.path;
      if (typeof path !== 'string' || !path.trim()) return;
      const raw = Array.isArray(data.payload?.items) ? data.payload.items : [];
      const items: NativeShellListingItem[] = raw
        .map((row: any) => {
          const p = String(row?.path || '');
          const name = String(row?.name || p.split(/[/\\]/).pop() || p);
          const isDir =
            row?.isDirectory === true || String(row?.type || '').toLowerCase() === 'directory';
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
        })
        .filter((x: NativeShellListingItem) => !!x.path);
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

/** Report workspace list slot bounds so WinUI can position the native ListView overlay. */
export function postNativeListSlotBounds(
  rect: { x: number; y: number; width: number; height: number },
  visible: boolean,
): void {
  if (!isNativeShellHostBoot()) return;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  postToHost('BNDZ_NATIVE_LIST_BOUNDS', { ...rect, dpr, visible });
}
