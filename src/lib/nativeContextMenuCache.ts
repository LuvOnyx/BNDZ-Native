/** In-memory cache for native shell context menu verbs (speeds repeat opens). */

const CACHE_TTL_MS = 120_000;
const MAX_ENTRIES = 96;

type CacheEntry = { items: unknown[]; at: number };

const cache = new Map<string, CacheEntry>();

function prune(): void {
  if (cache.size <= MAX_ENTRIES) return;
  const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
  for (let i = 0; i < oldest.length - MAX_ENTRIES; i++) {
    cache.delete(oldest[i][0]);
  }
}

function readHit(key: string): unknown[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.items;
}

/** Exact path key (single path or sorted multi-path join). */
export function getCachedNativeContextMenu(path: string): unknown[] | null {
  return readHit(path);
}

/**
 * Shape key for first-open wins: same extension / dir / selection arity shares verbs.
 * Explorer-class shell verbs mostly depend on type, not exact path.
 */
export function nativeContextShapeKey(paths: string | string[]): string {
  const list = (Array.isArray(paths) ? paths : [paths])
    .map(p => String(p || '').trim())
    .filter(Boolean);
  if (!list.length) return 'shape:empty';
  const n = list.length;
  if (n > 1) {
    const allDirs = list.every(p => /[\\/]$/.test(p) || !/\.[^.\\/]+$/.test(p.split(/[\\/]/).pop() || ''));
    return `shape:multi|n=${n}|${allDirs ? 'dirs' : 'mixed'}`;
  }
  const p = list[0].replace(/\//g, '\\');
  const leaf = p.split('\\').filter(Boolean).pop() || '';
  if (!leaf || leaf.includes(':') && leaf.length <= 3) return 'shape:folder';
  const dot = leaf.lastIndexOf('.');
  if (dot <= 0) return 'shape:dir';
  return `shape:ext|.${leaf.slice(dot + 1).toLowerCase()}`;
}

/** Lookup: exact path first, then extension/shape fallback. */
export function lookupNativeContextMenu(paths: string | string[]): unknown[] | null {
  const list = Array.isArray(paths) ? paths : [paths];
  const exact = list.length === 1 ? list[0] : list.slice().sort().join('|');
  const hit = readHit(exact);
  if (hit?.length) return hit;
  return readHit(nativeContextShapeKey(list));
}

export function setCachedNativeContextMenu(path: string, items: unknown[]): void {
  if (!items?.length) return;
  cache.set(path, { items, at: Date.now() });
  prune();
}

/** Store under both exact and shape keys so the next .pdf / folder open hits warm. */
export function storeNativeContextMenu(paths: string | string[], items: unknown[]): void {
  if (!items?.length) return;
  const list = Array.isArray(paths) ? paths : [paths];
  const exact = list.length === 1 ? list[0] : list.slice().sort().join('|');
  setCachedNativeContextMenu(exact, items);
  setCachedNativeContextMenu(nativeContextShapeKey(list), items);
}

export function prefetchNativeContextMenu(path: string, fetcher: (p: string) => Promise<unknown[]>): void {
  if (lookupNativeContextMenu(path)?.length) return;
  // Also nudge the host shape-cache (no await) so COM work happens before right-click.
  try {
    void import('./ipcBridge').then(({ IPC }) => {
      IPC.prefetchNativeContextMenuItems(path);
    });
  } catch { /* ignore */ }
  fetcher(path)
    .then(items => { if (items?.length) storeNativeContextMenu(path, items); })
    .catch(() => {});
}

/** Hover / selection: warm exact path so the menu is already filled on right-click. */
export function warmNativeContextMenuForPath(winPath: string): void {
  const p = String(winPath || '').trim();
  if (!p) return;
  if (lookupNativeContextMenu(p)?.length) {
    // Still keep host warm in case FE cache outlives a host restart mid-session.
    try {
      void import('./ipcBridge').then(({ IPC }) => IPC.prefetchNativeContextMenuItems(p));
    } catch { /* ignore */ }
    return;
  }
  void import('./ipcBridge').then(({ IPC }) => {
    if (!IPC.isNative) return;
    IPC.prefetchNativeContextMenuItems(p);
    prefetchNativeContextMenu(p, (x) => IPC.fetchNativeContextMenuItems(x) as Promise<unknown[]>);
  });
}

export function clearNativeContextMenuCache(path?: string): void {
  if (path) {
    cache.delete(path);
    cache.delete(nativeContextShapeKey(path));
    return;
  }
  cache.clear();
}
