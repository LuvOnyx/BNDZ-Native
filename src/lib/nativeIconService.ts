import { entityShellIsDirectory, resolveShellIconPath } from './shellPaths';
import { toWindowsPath } from './pathUtils';
import { enqueueIconRequest } from './iconRequestQueue';

export type IconRequestKind = 'shell' | 'thumbnail';

interface IconCacheEntry {
  data: string | null;
  status: 'ready' | 'loading' | 'error';
}

const cache = new Map<string, IconCacheEntry>();
const inflight = new Map<string, Promise<string | null>>();
const listeners = new Map<string, Set<() => void>>();
let lastAppliedCacheBuster = 0;

function iconKey(path: string, isDirectory: boolean, kind: IconRequestKind): string {
  const win = resolveShellIconPath(path) || toWindowsPath(path);
  return `${kind}:${win}:${isDirectory ? 'd' : 'f'}`;
}

function notify(key: string) {
  listeners.get(key)?.forEach(fn => fn());
}

function toDataUrl(res: string | null): string | null {
  if (!res) return null;
  return res.startsWith('data:') ? res : `data:image/png;base64,${res}`;
}

function lookupBatchIcon(batch: Record<string, string | null> | undefined, ...keys: string[]): string | null {
  if (!batch) return null;
  for (const key of keys) {
    if (!key) continue;
    if (batch[key] != null) return batch[key];
    const lower = key.toLowerCase();
    for (const [bk, bv] of Object.entries(batch)) {
      if (bk.toLowerCase() === lower && bv != null) return bv;
    }
  }
  return null;
}

function commitCache(key: string, data: string | null) {
  const existing = cache.get(key);
  if (existing?.data && !data) return;
  if (data) {
    cache.set(key, { data, status: 'ready' });
  } else {
    cache.set(key, { data: null, status: 'error' });
  }
  notify(key);
}

export function getCachedIcon(path: string, isDirectory: boolean, kind: IconRequestKind = 'shell'): string | null {
  const key = iconKey(path, isDirectory, kind);
  const entry = cache.get(key);
  return entry?.status === 'ready' && entry.data ? entry.data : null;
}

export function subscribeIcon(path: string, isDirectory: boolean, kind: IconRequestKind, cb: () => void): () => void {
  const key = iconKey(path, isDirectory, kind);
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(cb);
  return () => listeners.get(key)?.delete(cb);
}

async function fetchOne(path: string, isDirectory: boolean, kind: IconRequestKind): Promise<string | null> {
  const { IPC } = await import('./ipcBridge');
  const winPath = resolveShellIconPath(path) || toWindowsPath(path);
  if (!winPath) return null;

  if (kind === 'thumbnail') {
    const res = await IPC.getNativeThumbnailBase64(winPath);
    return toDataUrl(res);
  }

  const res = await IPC.getNativeShellIconBase64(winPath, isDirectory);
  return toDataUrl(res);
}

/** Request a single shell/thumbnail icon with global deduplication and queueing. */
export function requestNativeIcon(
  path: string | null | undefined,
  isDirectory: boolean,
  kind: IconRequestKind = 'shell',
): Promise<string | null> {
  if (!path) return Promise.resolve(null);
  const key = iconKey(path, isDirectory, kind);

  const cached = cache.get(key);
  if (cached?.status === 'ready' && cached.data) return Promise.resolve(cached.data);

  const existing = inflight.get(key);
  if (existing) return existing;

  if (!cached?.data) {
    cache.set(key, { data: cached?.data ?? null, status: 'loading' });
  }

  const promise = enqueueIconRequest(() => fetchOne(path, isDirectory, kind))
    .then(data => {
      commitCache(key, data);
      return data;
    })
    .catch(() => {
      commitCache(key, null);
      return null;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

function applyBatchChunk(
  chunk: Array<{ path: string; isDirectory: boolean }>,
  batch: Record<string, string | null>,
  kind: IconRequestKind,
) {
  for (const req of chunk) {
    const key = iconKey(req.path, req.isDirectory, kind);
    if (cache.get(key)?.data) continue;
    const win = resolveShellIconPath(req.path) || toWindowsPath(req.path);
    const raw = lookupBatchIcon(batch, win, req.path, toWindowsPath(req.path));
    const data = toDataUrl(raw);
    if (data) commitCache(key, data);
  }
  for (const req of chunk) {
    const key = iconKey(req.path, req.isDirectory, kind);
    if (!cache.get(key)?.data && !inflight.has(key)) {
      void requestNativeIcon(req.path, req.isDirectory, kind);
    }
  }
}

/** Batch prefetch icons for a directory listing — one IPC round-trip per chunk. */
export async function prefetchIconsForEntities(
  entities: Array<{ path?: string; name: string; type?: string; isDirectory?: boolean }>,
  panePath: string,
  kind: IconRequestKind = 'shell',
): Promise<void> {
  const { joinPanePath } = await import('./pathUtils');
  const { IPC } = await import('./ipcBridge');

  const requests: Array<{ path: string; isDirectory: boolean }> = [];
  for (const ent of entities) {
    const fullPath = joinPanePath(panePath, ent);
    const isDir = entityShellIsDirectory(ent, fullPath);
    const key = iconKey(fullPath, isDir, kind);
    if (cache.get(key)?.data) continue;
    if (inflight.has(key)) continue;
    requests.push({ path: fullPath, isDirectory: isDir });
  }

  if (!requests.length) return;

  const CHUNK = 48;
  for (let i = 0; i < requests.length; i += CHUNK) {
    const chunk = requests.slice(i, i + CHUNK);
    if (IPC.isNative && IPC.getNativeShellIconsBatch) {
      try {
        const batch = await IPC.getNativeShellIconsBatch(chunk);
        applyBatchChunk(chunk, batch, kind);
        continue;
      } catch {
        /* fall through to per-item */
      }
    }
    await Promise.all(chunk.map(r => requestNativeIcon(r.path, r.isDirectory, kind)));
  }
}

/** Prefetch shell icons for navigation tree nodes (iconPath takes precedence over pane path). */
export async function prefetchShellIconPaths(
  items: Array<{ path: string; iconPath?: string }>,
): Promise<void> {
  if (!items.length) return;
  const requests = items
    .filter(i => i.iconPath || i.path)
    .map(i => {
      const fetchPath = i.iconPath || i.path;
      return { path: fetchPath, isDirectory: entityShellIsDirectory(null, fetchPath) };
    });

  const { IPC } = await import('./ipcBridge');
  const CHUNK = 32;
  for (let i = 0; i < requests.length; i += CHUNK) {
    const chunk = requests.slice(i, i + CHUNK);
    if (IPC.isNative && IPC.getNativeShellIconsBatch) {
      try {
        const batch = await IPC.getNativeShellIconsBatch(chunk);
        applyBatchChunk(chunk, batch, 'shell');
        continue;
      } catch {
        /* per-item fallback */
      }
    }
    await Promise.all(chunk.map(r => requestNativeIcon(r.path, r.isDirectory, 'shell')));
  }
}

export function clearIconCache() {
  const keys = [...new Set([...cache.keys(), ...listeners.keys()])];
  cache.clear();
  inflight.clear();
  requestAnimationFrame(() => keys.forEach(key => notify(key)));
}

/** Clear the in-memory icon cache once per config iconCacheBuster bump (not on every icon mount). */
export function applyIconCacheBuster(buster: number | undefined) {
  if (!buster || buster === lastAppliedCacheBuster) return;
  lastAppliedCacheBuster = buster;
  clearIconCache();
}
