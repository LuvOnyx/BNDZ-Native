/** In-memory cache for native shell context menu verbs (speeds repeat opens). */
const CACHE_TTL_MS = 45_000;
const MAX_ENTRIES = 64;

type CacheEntry = { items: unknown[]; at: number };

const cache = new Map<string, CacheEntry>();

function prune(): void {
  if (cache.size <= MAX_ENTRIES) return;
  const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
  for (let i = 0; i < oldest.length - MAX_ENTRIES; i++) {
    cache.delete(oldest[i][0]);
  }
}

export function getCachedNativeContextMenu(path: string): unknown[] | null {
  const hit = cache.get(path);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(path);
    return null;
  }
  return hit.items;
}

export function setCachedNativeContextMenu(path: string, items: unknown[]): void {
  cache.set(path, { items, at: Date.now() });
  prune();
}

export function prefetchNativeContextMenu(path: string, fetcher: (p: string) => Promise<unknown[]>): void {
  if (getCachedNativeContextMenu(path)) return;
  fetcher(path)
    .then(items => { if (items?.length) setCachedNativeContextMenu(path, items); })
    .catch(() => {});
}

export function clearNativeContextMenuCache(path?: string): void {
  if (path) {
    cache.delete(path);
    return;
  }
  cache.clear();
}
