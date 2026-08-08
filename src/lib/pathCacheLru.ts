/** LRU touch-order for path listing caches (pane dir contents, etc.). */

const DEFAULT_MAX = 48;
const accessOrder: string[] = [];
let pinnedPaths = new Set<string>();
let configuredMax = DEFAULT_MAX;

/** Settings → Maximum number of items cached (folder listing LRU capacity). */
export function configurePathCacheMax(max: number | boolean | string | undefined | null): void {
  if (max === false || max == null || max === '') {
    configuredMax = DEFAULT_MAX;
    return;
  }
  const n = typeof max === 'number' ? max : Number(max);
  if (!Number.isFinite(n) || n <= 0) {
    configuredMax = DEFAULT_MAX;
    return;
  }
  configuredMax = Math.max(8, Math.min(Math.floor(n), 5000));
}

export function getPathCacheMax(): number {
  return configuredMax;
}

/** Paths that must never be evicted (open tabs / active panes). */
export function setPinnedPathCacheKeys(paths: Iterable<string>): void {
  pinnedPaths = new Set();
  for (const p of paths) {
    if (p) pinnedPaths.add(p);
  }
}

export function touchPathCacheKey(path: string): void {
  const i = accessOrder.indexOf(path);
  if (i >= 0) accessOrder.splice(i, 1);
  accessOrder.push(path);
}

export function invalidatePathCacheKey(path: string): void {
  const i = accessOrder.indexOf(path);
  if (i >= 0) accessOrder.splice(i, 1);
}

function canEvict(drop: string, writingPath: string): boolean {
  return drop !== writingPath && !pinnedPaths.has(drop);
}

/** Set one cache entry and evict oldest unpinned paths when over capacity. */
export function setPathCacheEntry<T>(
  cache: Record<string, T>,
  path: string,
  value: T,
  max = configuredMax,
): Record<string, T> {
  touchPathCacheKey(path);
  const next = { ...cache, [path]: value };
  while (accessOrder.length > max) {
    let dropped = false;
    const scan = accessOrder.length;
    for (let i = 0; i < scan; i++) {
      const drop = accessOrder.shift();
      if (!drop) break;
      if (!canEvict(drop, path)) {
        accessOrder.push(drop);
        continue;
      }
      delete next[drop];
      dropped = true;
      break;
    }
    // Remaining keys are all pinned (or the key being written) — stop.
    if (!dropped) break;
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
