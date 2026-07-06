/** LRU touch-order for unbounded path listing caches (pane dir contents, etc.). */

const DEFAULT_MAX = 48;
const accessOrder: string[] = [];

export function touchPathCacheKey(path: string): void {
  const i = accessOrder.indexOf(path);
  if (i >= 0) accessOrder.splice(i, 1);
  accessOrder.push(path);
}

export function invalidatePathCacheKey(path: string): void {
  const i = accessOrder.indexOf(path);
  if (i >= 0) accessOrder.splice(i, 1);
}

/** Set one cache entry and evict oldest paths when over capacity. */
export function setPathCacheEntry<T>(
  cache: Record<string, T>,
  path: string,
  value: T,
  max = DEFAULT_MAX,
): Record<string, T> {
  touchPathCacheKey(path);
  const next = { ...cache, [path]: value };
  while (accessOrder.length > max) {
    const drop = accessOrder.shift();
    if (drop && drop !== path) delete next[drop];
  }
  return next;
}

/** Remove keys from cache (e.g. after delete/move). */
export function removePathCacheKeys<T>(
  cache: Record<string, T>,
  paths: string[],
): Record<string, T> {
  if (!paths.length) return cache;
  const next = { ...cache };
  for (const p of paths) {
    invalidatePathCacheKey(p);
    delete next[p];
  }
  return next;
}
