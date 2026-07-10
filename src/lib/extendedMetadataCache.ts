import { IPC } from './ipcBridge';

type CacheEntry = {
  meta: Record<string, string>;
  md5?: string;
  fetchedAt: number;
};

const META_TTL_MS = 120_000;
const metaCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();

function cacheKey(path: string): string {
  return path.replace(/\//g, '\\').toLowerCase();
}

export function peekExtendedMetadata(path: string): CacheEntry | null {
  const key = cacheKey(path);
  const hit = metaCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.fetchedAt > META_TTL_MS) {
    metaCache.delete(key);
    return null;
  }
  return hit;
}

export async function getExtendedMetadataCached(path: string, opts?: { includeMd5?: boolean }): Promise<CacheEntry> {
  const key = cacheKey(path);
  const existing = peekExtendedMetadata(path);
  if (existing && (!opts?.includeMd5 || existing.md5)) return existing;

  const pending = inflight.get(key);
  if (pending) return pending;

  const job = (async () => {
    const meta = IPC.isNative ? await IPC.getExtendedMetadata(path) : {};
    let md5: string | undefined = existing?.md5;
    if (opts?.includeMd5 && !md5 && IPC.isNative) {
      try {
        const hashes = await IPC.getAsyncHashes(path);
        md5 = hashes.md5;
      } catch {
        md5 = undefined;
      }
    }
    const entry: CacheEntry = { meta: meta || {}, md5, fetchedAt: Date.now() };
    metaCache.set(key, entry);
    inflight.delete(key);
    return entry;
  })();

  inflight.set(key, job);
  return job;
}

export function invalidateExtendedMetadata(path: string): void {
  metaCache.delete(cacheKey(path));
}
