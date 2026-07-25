import { entityShellIsDirectory, resolveShellIconPath } from './shellPaths';
import { toWindowsPath } from './pathUtils';
import { enqueueIconRequest } from './iconRequestQueue';

export type IconRequestKind = 'shell' | 'thumbnail';

/** Canonical list/grid CAS thumb size — one size = one cache key = warm after first visit. */
export const LIST_THUMB_PX = 96;
/** Side-panel / Quick Look CAS size — still tiny vs full-file stream. */
export const PREVIEW_THUMB_PX = 256;

interface IconCacheEntry {
  data: string | null;
  status: 'ready' | 'loading' | 'error';
}

const cache = new Map<string, IconCacheEntry>();
const typeGlyphCache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();
const listeners = new Map<string, Set<() => void>>();
let lastAppliedCacheBuster = 0;

function iconKey(path: string, isDirectory: boolean, kind: IconRequestKind): string {
  const win = resolveShellIconPath(path) || toWindowsPath(path);
  return `${kind}:${win}:${isDirectory ? 'd' : 'f'}`;
}

export function hostIconCacheKey(path: string, isDirectory: boolean): string | null {
  const win = (resolveShellIconPath(path) || toWindowsPath(path) || '').trim();
  if (!win) return null;
  const lower = win.toLowerCase();
  const isVirtual = lower.startsWith('shell:') || lower.includes('::{');
  if (!isVirtual && !isDirectory
      && !lower.endsWith('.exe')
      && !lower.endsWith('.lnk')
      && !lower.endsWith('.ico')) {
    const dot = win.lastIndexOf('.');
    if (dot > 0 && dot < win.length - 1) {
      const sep = Math.max(win.lastIndexOf('\\'), win.lastIndexOf('/'));
      if (dot > sep) return win.slice(dot).toLowerCase();
    }
  }
  return win;
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

function commitCache(key: string, data: string | null, typeKey?: string | null) {
  const existing = cache.get(key);
  if (existing?.data && !data) return;
  if (data) {
    cache.set(key, { data, status: 'ready' });
    if (typeKey && typeKey.startsWith('.')) typeGlyphCache.set(typeKey, data);
  } else {
    cache.set(key, { data: null, status: 'error' });
  }
  notify(key);
}

export function getCachedIcon(path: string, isDirectory: boolean, kind: IconRequestKind = 'shell'): string | null {
  const key = iconKey(path, isDirectory, kind);
  const entry = cache.get(key);
  if (entry?.status === 'ready' && entry.data) return entry.data;
  if (kind === 'shell') {
    const typeKey = hostIconCacheKey(path, isDirectory);
    if (typeKey?.startsWith('.')) {
      const glyph = typeGlyphCache.get(typeKey);
      if (glyph) {
        cache.set(key, { data: glyph, status: 'ready' });
        return glyph;
      }
    }
  }
  return null;
}

export function subscribeIcon(path: string, isDirectory: boolean, kind: IconRequestKind, cb: () => void): () => void {
  const key = iconKey(path, isDirectory, kind);
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(cb);
  return () => listeners.get(key)?.delete(cb);
}

async function fetchOne(
  path: string,
  isDirectory: boolean,
  kind: IconRequestKind,
  thumbPx: number,
): Promise<string | null> {
  const { IPC } = await import('./ipcBridge');
  const winPath = resolveShellIconPath(path) || toWindowsPath(path);
  if (!winPath) return null;
  if (kind === 'thumbnail') {
    const res = await IPC.getNativeThumbnailBase64(winPath, thumbPx);
    return toDataUrl(res);
  }
  const res = await IPC.getNativeShellIconBase64(winPath, isDirectory);
  return toDataUrl(res);
}

export function requestNativeIcon(
  path: string | null | undefined,
  isDirectory: boolean,
  kind: IconRequestKind = 'shell',
  thumbPx = LIST_THUMB_PX,
): Promise<string | null> {
  if (!path) return Promise.resolve(null);
  const key = iconKey(path, isDirectory, kind);
  const typeKey = kind === 'shell' ? hostIconCacheKey(path, isDirectory) : null;

  const cached = cache.get(key);
  if (cached?.status === 'ready' && cached.data) return Promise.resolve(cached.data);

  if (typeKey?.startsWith('.')) {
    const glyph = typeGlyphCache.get(typeKey);
    if (glyph) {
      commitCache(key, glyph, typeKey);
      return Promise.resolve(glyph);
    }
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  if (typeKey?.startsWith('.')) {
    const typeInflight = inflight.get(`type:${typeKey}`);
    if (typeInflight) {
      const shared = typeInflight.then(data => {
        commitCache(key, data, typeKey);
        return data;
      });
      inflight.set(key, shared);
      return shared;
    }
  }

  if (!cached?.data) cache.set(key, { data: cached?.data ?? null, status: 'loading' });

  const priority = kind === 'thumbnail' ? 1 : 0;
  const promise = enqueueIconRequest(() => fetchOne(path, isDirectory, kind, thumbPx), priority)
    .then(data => {
      commitCache(key, data, typeKey);
      return data;
    })
    .catch(() => {
      commitCache(key, null);
      return null;
    })
    .finally(() => {
      inflight.delete(key);
      if (typeKey?.startsWith('.')) inflight.delete(`type:${typeKey}`);
    });

  inflight.set(key, promise);
  if (typeKey?.startsWith('.')) inflight.set(`type:${typeKey}`, promise);
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
    const typeKey = kind === 'shell' ? hostIconCacheKey(req.path, req.isDirectory) : null;
    if (data) commitCache(key, data, typeKey);
  }
  for (const req of chunk) {
    const key = iconKey(req.path, req.isDirectory, kind);
    if (!cache.get(key)?.data && !inflight.has(key)) {
      if (kind === 'shell') {
        const typeKey = hostIconCacheKey(req.path, req.isDirectory);
        if (typeKey?.startsWith('.') && typeGlyphCache.has(typeKey)) {
          commitCache(key, typeGlyphCache.get(typeKey)!, typeKey);
          continue;
        }
      }
      void requestNativeIcon(req.path, req.isDirectory, kind);
    }
  }
}

export async function prefetchIconsForEntities(
  entities: Array<{ path?: string; name: string; type?: string; isDirectory?: boolean }>,
  panePath: string,
  kind: IconRequestKind = 'shell',
): Promise<void> {
  const { joinPanePath } = await import('./pathUtils');
  const { IPC } = await import('./ipcBridge');
  const requests: Array<{ path: string; isDirectory: boolean }> = [];
  const seenTypes = new Set<string>();
  for (const ent of entities) {
    const fullPath = joinPanePath(panePath, ent);
    const isDir = entityShellIsDirectory(ent, fullPath);
    const key = iconKey(fullPath, isDir, kind);
    if (cache.get(key)?.data || inflight.has(key)) continue;
    if (kind === 'shell') {
      const typeKey = hostIconCacheKey(fullPath, isDir);
      if (typeKey?.startsWith('.') && typeGlyphCache.has(typeKey)) {
        commitCache(key, typeGlyphCache.get(typeKey)!, typeKey);
        continue;
      }
      if (typeKey?.startsWith('.') && !isDir) {
        if (seenTypes.has(typeKey)) continue;
        seenTypes.add(typeKey);
      }
    }
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
        for (const ent of entities) {
          const fullPath = joinPanePath(panePath, ent);
          const isDir = entityShellIsDirectory(ent, fullPath);
          const key = iconKey(fullPath, isDir, kind);
          if (cache.get(key)?.data) continue;
          const typeKey = hostIconCacheKey(fullPath, isDir);
          if (typeKey?.startsWith('.') && typeGlyphCache.has(typeKey)) {
            commitCache(key, typeGlyphCache.get(typeKey)!, typeKey);
          }
        }
        continue;
      } catch { /* per-item */ }
    }
    await Promise.all(chunk.map(r => requestNativeIcon(r.path, r.isDirectory, kind)));
  }
}

const MEDIA_THUMB_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif', 'heic', 'jfif', 'avif',
  'mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'wmv', 'mpg', 'mpeg', 'flv', 'ts', 'm2ts',
  'mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'wma', 'opus', 'aiff', 'ape',
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'cab', 'iso',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'psd',
]);

function entityMediaExt(ent: { extension?: string; name?: string }): string {
  const direct = (ent.extension || '').toLowerCase().replace(/^\./, '');
  if (direct) return direct;
  const name = String(ent.name || '');
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

export async function prefetchMediaThumbnailsForEntities(
  entities: Array<{ path?: string; name: string; type?: string; isDirectory?: boolean; extension?: string }>,
  panePath: string,
  limit = 96,
  opts?: { includeFolders?: boolean },
): Promise<void> {
  const { joinPanePath } = await import('./pathUtils');
  const { IPC } = await import('./ipcBridge');
  const media: Array<{ path: string; isDirectory: boolean }> = [];
  for (const ent of entities) {
    const isDir = ent.type === 'directory' || ent.isDirectory;
    if (isDir) {
      if (!opts?.includeFolders) continue;
    } else if (!MEDIA_THUMB_EXTS.has(entityMediaExt(ent))) {
      continue;
    }
    const fullPath = joinPanePath(panePath, ent);
    const key = iconKey(fullPath, !!isDir, 'thumbnail');
    if (cache.get(key)?.data || inflight.has(key)) continue;
    media.push({ path: fullPath, isDirectory: !!isDir });
    if (media.length >= limit) break;
  }
  if (!media.length) return;

  const CHUNK = 24;
  for (let i = 0; i < media.length; i += CHUNK) {
    const chunk = media.slice(i, i + CHUNK);
    if (IPC.isNative && typeof IPC.getNativeThumbnailsBatch === 'function') {
      try {
        const batch = await IPC.getNativeThumbnailsBatch(chunk.map(c => c.path), LIST_THUMB_PX);
        applyBatchChunk(chunk, batch, 'thumbnail');
        continue;
      } catch { /* per-item */ }
    }
    await Promise.all(chunk.map(r => requestNativeIcon(r.path, r.isDirectory, 'thumbnail', LIST_THUMB_PX)));
  }
}

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
      } catch { /* per-item */ }
    }
    await Promise.all(chunk.map(r => requestNativeIcon(r.path, r.isDirectory, 'shell')));
  }
}

export function clearIconCache() {
  const keys = [...new Set([...cache.keys(), ...listeners.keys()])];
  cache.clear();
  typeGlyphCache.clear();
  inflight.clear();
  requestAnimationFrame(() => keys.forEach(key => notify(key)));
}

export function applyIconCacheBuster(buster: number | undefined) {
  if (!buster || buster === lastAppliedCacheBuster) return;
  lastAppliedCacheBuster = buster;
  clearIconCache();
}
