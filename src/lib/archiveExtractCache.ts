/**
 * In-memory cache for archive entry → temp path extraction used by drag-out.
 * Prefetch on mousedown so drag threshold feels instant.
 */

type CacheEntry = {
  promise: Promise<string | null>;
  path?: string;
};

const cache = new Map<string, CacheEntry>();

function cacheKey(archivePath: string, entryPath: string): string {
  return `${archivePath.replace(/\\/g, '/').toLowerCase()}|${entryPath.replace(/\\/g, '/').toLowerCase()}`;
}

export function prefetchArchiveEntryTemp(archivePath: string, entryPath: string): Promise<string | null> {
  const key = cacheKey(archivePath, entryPath);
  let entry = cache.get(key);
  if (!entry) {
    entry = {
      promise: (async () => {
        const { IPC } = await import('./ipcBridge');
        const result = await IPC.archiveExtractEntryToTemp(archivePath, entryPath);
        if (result.success && result.path) {
          entry!.path = result.path;
          return result.path;
        }
        return null;
      })(),
    };
    cache.set(key, entry);
  }
  return entry.promise;
}

export async function resolveArchiveEntryTempPaths(
  archivePath: string,
  entryPaths: string[],
): Promise<string[]> {
  const results = await Promise.all(entryPaths.map(p => prefetchArchiveEntryTemp(archivePath, p)));
  return results.filter((p): p is string => !!p);
}

export function getCachedArchiveEntryTemp(archivePath: string, entryPath: string): string | null {
  return cache.get(cacheKey(archivePath, entryPath))?.path ?? null;
}

export function clearArchiveExtractCache(): void {
  cache.clear();
}
