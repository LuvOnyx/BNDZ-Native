import { IPC } from './ipcBridge';
import { enqueueMetadataRequest, getMetadataQueueDepth } from './metadataRequestQueue';

type CacheEntry = {
  meta: Record<string, string>;
  md5?: string;
  fetchedAt: number;
};

export type ExtendedMetadataOptions = {
  includeMd5?: boolean;
  /** Higher = sooner in metadata IPC queue (preview/tooltip ≈ 900, visible column ≈ 550). */
  priority?: number;
};

const META_TTL_MS = 120_000;
const BUSY_RETRY_MS = 900;
const MAX_BUSY_RETRIES = 3;
const QUEUE_DEPTH_RETRY_CAP = 36;

const metaCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();

function cacheKey(path: string): string {
  return path.replace(/\//g, '\\').toLowerCase();
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
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

async function fetchMetadataOnce(path: string, priority: number): Promise<Record<string, string>> {
  if (!IPC.isNative) return {};
  return enqueueMetadataRequest(
    () => IPC.getExtendedMetadata(path),
    priority,
  );
}

async function resolveEntry(
  path: string,
  opts: ExtendedMetadataOptions | undefined,
  attempt = 0,
): Promise<CacheEntry> {
  const key = cacheKey(path);
  const existing = peekExtendedMetadata(path);
  const priority = opts?.priority ?? 400;

  let meta: Record<string, string> = {};
  try {
    meta = await fetchMetadataOnce(path, priority);
  } catch {
    if (existing) return existing;
    if (attempt < MAX_BUSY_RETRIES && getMetadataQueueDepth() < QUEUE_DEPTH_RETRY_CAP) {
      await sleep(BUSY_RETRY_MS * (attempt + 1));
      return resolveEntry(path, opts, attempt + 1);
    }
    return { meta: {}, fetchedAt: Date.now() };
  }

  if (meta._busy === 'true') {
    if (existing) return existing;
    if (attempt < MAX_BUSY_RETRIES && getMetadataQueueDepth() < QUEUE_DEPTH_RETRY_CAP) {
      await sleep(BUSY_RETRY_MS * (attempt + 1));
      return resolveEntry(path, opts, attempt + 1);
    }
    return { meta: {}, fetchedAt: Date.now() };
  }

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
  return entry;
}

export async function getExtendedMetadataCached(
  path: string,
  opts?: ExtendedMetadataOptions,
): Promise<CacheEntry> {
  const key = cacheKey(path);
  const existing = peekExtendedMetadata(path);
  if (existing && (!opts?.includeMd5 || existing.md5)) return existing;

  const pending = inflight.get(key);
  if (pending) return pending;

  const job = resolveEntry(path, opts).finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, job);
  return job;
}

export function invalidateExtendedMetadata(path: string): void {
  metaCache.delete(cacheKey(path));
  inflight.delete(cacheKey(path));
}
