/**
 * In-memory cache for archive entry → temp path extraction used by drag-out.
 * Prefetch on mousedown so drag threshold feels instant.
 * RAGE mesh extracts also stage sibling .ytd companions — include them in OLE drag paths.
 */

type CacheEntry = {
  promise: Promise<string | null>;
  path?: string;
  companions?: string[];
};

const cache = new Map<string, CacheEntry>();

function cacheKey(archivePath: string, entryPath: string): string {
  return `${archivePath.replace(/\\/g, '/').toLowerCase()}|${entryPath.replace(/\\/g, '/').toLowerCase()}`;
}

function normalizeCompanions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(p => String(p || '')).filter(Boolean);
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
          entry!.companions = normalizeCompanions(result.companions);
          return result.path;
        }
        return null;
      })(),
    };
    cache.set(key, entry);
  }
  return entry.promise;
}

/** Primary extract paths plus staged RAGE .ytd companions for OLE drag-out. */
export async function resolveArchiveEntryTempPaths(
  archivePath: string,
  entryPaths: string[],
): Promise<string[]> {
  const results = await Promise.all(entryPaths.map(p => prefetchArchiveEntryTemp(archivePath, p)));
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (p: string | null | undefined) => {
    if (!p) return;
    const k = p.replace(/\\/g, '/').toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(p);
  };
  for (let i = 0; i < entryPaths.length; i++) {
    push(results[i]);
    const companions = cache.get(cacheKey(archivePath, entryPaths[i]))?.companions;
    if (companions) for (const c of companions) push(c);
  }
  return out;
}

export function getCachedArchiveEntryTemp(archivePath: string, entryPath: string): string | null {
  return cache.get(cacheKey(archivePath, entryPath))?.path ?? null;
}

export function clearArchiveExtractCache(): void {
  cache.clear();
}
