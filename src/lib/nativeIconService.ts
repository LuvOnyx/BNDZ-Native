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
  /** Epoch ms when error was recorded — skip retries until TTL or cache buster. */
  errorAt?: number;
}

const NEGATIVE_TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, IconCacheEntry>();
const typeGlyphCache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();
const listeners = new Map<string, Set<() => void>>();
let lastAppliedCacheBuster = 0;

function canonicalizeIconPath(path: string): string {
  let win = (resolveShellIconPath(path) || toWindowsPath(path) || '').trim();
  if (!win) return '';
  win = win.replace(/\//g, '\\');
  // Shell / GUID paths keep case — filesystem paths normalize for Map hits across casing.
  if (/^shell:/i.test(win) || win.includes('::{')) return win;
  // Collapse trailing separators except drive roots (C:\).
  if (/^[A-Za-z]:\\/.test(win)) {
    const drive = win.slice(0, 2).toUpperCase();
    let rest = win.slice(2).replace(/\\+$/, '');
    if (!rest) return `${drive}\\`;
    return `${drive}${rest.toLowerCase()}`;
  }
  return win.replace(/\\+$/, '').toLowerCase();
}

function iconKey(path: string, isDirectory: boolean, kind: IconRequestKind, thumbPx = LIST_THUMB_PX): string {
  const win = canonicalizeIconPath(path);
  const base = `${kind}:${win}:${isDirectory ? 'd' : 'f'}`;
  return kind === 'thumbnail' ? `${base}:${thumbPx}` : base;
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
  // Stale URLs from before bndz-media scheme — rewrite so we don't hit folder-map 404s.
  if (res.includes('/assets/native-icon/')) {
    const hash = res.split('/').pop()?.replace(/\.png$/i, '') ?? '';
    if (/^[a-f0-9]{16,}$/i.test(hash)) return `bndz-media://cas/${hash.toLowerCase()}.png`;
    return null;
  }
  if (
    res.startsWith('data:')
    || res.startsWith('http://')
    || res.startsWith('https://')
    || res.startsWith('blob:')
    || res.startsWith('bndz-media:')
  ) {
    return res;
  }
  return `data:image/png;base64,${res}`;
}

const FOLDER_GLYPH_KEY = '__folder__';

/** Hydrate type glyphs from listing-time SHELL_GLYPH_MAP (before first row paint). */
export function hydrateShellGlyphMap(glyphs: Record<string, string> | null | undefined): void {
  if (!glyphs || typeof glyphs !== 'object') return;
  for (const [rawKey, rawVal] of Object.entries(glyphs)) {
    if (!rawVal) continue;
    const data = toDataUrl(rawVal);
    if (!data) continue;
    const key = rawKey === FOLDER_GLYPH_KEY || rawKey.toLowerCase() === FOLDER_GLYPH_KEY
      ? FOLDER_GLYPH_KEY
      : (rawKey.startsWith('.') ? rawKey.toLowerCase() : `.${rawKey.toLowerCase()}`);
    typeGlyphCache.set(key, data);
  }
  // Notify all shell listeners so rows that already mounted pick up glyphs.
  for (const [ck, entry] of cache) {
    if (!ck.startsWith('shell:')) continue;
    if (entry.status === 'ready' && entry.data) continue;
    notify(ck);
  }
  for (const [key, set] of listeners) {
    if (!key.startsWith('shell:')) continue;
    set.forEach(fn => fn());
  }
  void warmImageBitmaps([...typeGlyphCache.values()].slice(0, 48));
}

/** Decode-once so subsequent paints skip PNG decode cost. Prefer Image() over fetch —
 *  bndz-media:// is cross-origin from http://bndz.local; fetch needs CORS headers. */
const bitmapWarmed = new Set<string>();
async function warmImageBitmaps(urls: string[]): Promise<void> {
  for (const url of urls) {
    if (!url || bitmapWarmed.has(url)) continue;
    // Never warm broken legacy folder-map URLs (console ERR_FILE_NOT_FOUND flood).
    if (url.includes('/assets/native-icon/')) continue;
    bitmapWarmed.add(url);
    try {
      // data: / http(s) may use createImageBitmap via fetch; custom schemes use Image decode.
      if (url.startsWith('data:') && typeof createImageBitmap === 'function') {
        const res = await fetch(url);
        if (!res.ok) continue;
        const blob = await res.blob();
        if (!blob || blob.size === 0) continue;
        const bmp = await createImageBitmap(blob);
        bmp.close();
        continue;
      }
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = url;
      });
    } catch {
      /* best-effort — never surface to console as uncaught */
    }
  }
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

function commitCache(key: string, data: string | null, typeKey?: string | null, kind: IconRequestKind = 'shell') {
  const existing = cache.get(key);
  if (existing?.data && !data) return;
  if (data) {
    cache.set(key, { data, status: 'ready' });
    // Extension type glyphs only. NEVER write per-path folder icons into __folder__ —
    // that poisons every directory with Downloads/Desktop/etc.
    if (typeKey && typeKey.startsWith('.')) typeGlyphCache.set(typeKey, data);
    void warmImageBitmaps([data]);
  } else if (kind === 'shell') {
    // Transient shell misses (queue saturation / IPC timeout) must not poison for 10 minutes.
    cache.delete(key);
  } else {
    cache.set(key, { data: null, status: 'error', errorAt: Date.now() });
  }
  notify(key);
}

export function getCachedIcon(path: string, isDirectory: boolean, kind: IconRequestKind = 'shell', thumbPx = LIST_THUMB_PX): string | null {
  const key = iconKey(path, isDirectory, kind, thumbPx);
  const entry = cache.get(key);
  if (entry?.status === 'ready' && entry.data) return entry.data;
  if (kind === 'shell') {
    // Provisional only — do NOT cache.set ready, or per-path fetch never runs.
    if (isDirectory) {
      const folderGlyph = typeGlyphCache.get(FOLDER_GLYPH_KEY);
      if (folderGlyph) return folderGlyph;
    }
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

function isNegativeFresh(entry: IconCacheEntry | undefined): boolean {
  if (!entry || entry.status !== 'error') return false;
  const at = entry.errorAt ?? 0;
  return Date.now() - at < NEGATIVE_TTL_MS;
}

export function subscribeIcon(path: string, isDirectory: boolean, kind: IconRequestKind, cb: () => void, thumbPx = LIST_THUMB_PX): () => void {
  const key = iconKey(path, isDirectory, kind, thumbPx);
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
  priorityBoost = 0,
): Promise<string | null> {
  if (!path) return Promise.resolve(null);
  const key = iconKey(path, isDirectory, kind, thumbPx);
  const typeKey = kind === 'shell' ? hostIconCacheKey(path, isDirectory) : null;

  const cached = cache.get(key);
  if (cached?.status === 'ready' && cached.data) return Promise.resolve(cached.data);
  if (cached?.status === 'loading' && inflight.has(key)) return inflight.get(key)!;
  // Negative CAS — thumbnails only; shell icons retry on next visible row.
  if (kind !== 'shell' && isNegativeFresh(cached)) return Promise.resolve(null);

  if (typeKey?.startsWith('.')) {
    const glyph = typeGlyphCache.get(typeKey);
    if (glyph) {
      commitCache(key, glyph, typeKey);
      return Promise.resolve(glyph);
    }
  }
  // Directories: __folder__ is provisional paint only (via getCachedIcon). Always
  // fetch the real shell icon so Downloads/Desktop/Libraries keep unique glyphs.

  const existing = inflight.get(key);
  if (existing) return existing;

  if (typeKey?.startsWith('.')) {
    const typeInflight = inflight.get(`type:${typeKey}`);
    if (typeInflight) {
      const shared = typeInflight.then(data => {
        commitCache(key, data, typeKey, kind);
        return data;
      });
      inflight.set(key, shared);
      return shared;
    }
  }

  if (!cached?.data) cache.set(key, { data: cached?.data ?? null, status: 'loading' });

  // Priority: viewport shells ≥1700; thumbs 1000+; offscreen shells lower.
  // Split queues: shell concurrency ≥6, thumb ≤3 — shells never wait behind media extract.
  const boost = Math.max(0, priorityBoost | 0);
  const priority = kind === 'thumbnail'
    ? 1000 + Math.min(900, boost)
    : boost >= 800
      ? 1700 + Math.min(200, boost - 800)
      : 250 + Math.min(749, boost);
  const queueKind = kind === 'thumbnail' ? 'thumb' as const : 'shell' as const;
  const promise = enqueueIconRequest(() => fetchOne(path, isDirectory, kind, thumbPx), priority, queueKind)
    .then(data => {
      // Never pass FOLDER_GLYPH_KEY — per-path folder extracts must not poison the shared glyph.
      commitCache(key, data, typeKey?.startsWith('.') ? typeKey : null, kind);
      return data;
    })
    .catch(() => {
      commitCache(key, null, typeKey, kind);
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
  thumbPx = LIST_THUMB_PX,
) {
  for (const req of chunk) {
    const key = iconKey(req.path, req.isDirectory, kind, thumbPx);
    if (cache.get(key)?.data) continue;
    const win = canonicalizeIconPath(req.path);
    const raw = lookupBatchIcon(batch, win, req.path, toWindowsPath(req.path));
    const data = toDataUrl(raw);
    // Directories: store per-path only — never as __folder__.
    const typeKey = kind === 'shell' && !req.isDirectory
      ? hostIconCacheKey(req.path, req.isDirectory)
      : null;
    if (data) commitCache(key, data, typeKey, kind);
  }
  for (const req of chunk) {
    const key = iconKey(req.path, req.isDirectory, kind, thumbPx);
    if (!cache.get(key)?.data && !inflight.has(key)) {
      if (kind === 'shell' && !req.isDirectory) {
        const typeKey = hostIconCacheKey(req.path, req.isDirectory);
        if (typeKey?.startsWith('.') && typeGlyphCache.has(typeKey)) {
          commitCache(key, typeGlyphCache.get(typeKey)!, typeKey);
          continue;
        }
      }
      // Directories always per-path fetch (provisional __folder__ comes from getCachedIcon).
      void requestNativeIcon(req.path, req.isDirectory, kind, thumbPx);
    }
  }
}

export async function prefetchIconsForEntities(
  entities: Array<{ path?: string; name: string; type?: string; isDirectory?: boolean }>,
  panePath: string,
  kind: IconRequestKind = 'shell',
  limit = 160,
): Promise<void> {
  const { joinPanePath } = await import('./pathUtils');
  const { IPC } = await import('./ipcBridge');
  const requests: Array<{ path: string; isDirectory: boolean }> = [];
  const seenTypes = new Set<string>();
  const seenDirs = new Set<string>();
  for (const ent of entities) {
    if (requests.length >= limit) break;
    const fullPath = joinPanePath(panePath, ent);
    const isDir = entityShellIsDirectory(ent, fullPath);
    const key = iconKey(fullPath, isDir, kind);
    if (cache.get(key)?.data || inflight.has(key)) continue;
    if (kind === 'shell') {
      if (isDir) {
        const dirKey = fullPath.toLowerCase();
        if (seenDirs.has(dirKey)) continue;
        seenDirs.add(dirKey);
      } else {
        const typeKey = hostIconCacheKey(fullPath, isDir);
        if (typeKey?.startsWith('.') && typeGlyphCache.has(typeKey)) {
          commitCache(key, typeGlyphCache.get(typeKey)!, typeKey);
          continue;
        }
        if (typeKey?.startsWith('.')) {
          if (seenTypes.has(typeKey)) continue;
          seenTypes.add(typeKey);
        }
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
          if (isDir) continue; // per-path via applyBatchChunk / requestNativeIcon
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
  limit = 192,
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
    const key = iconKey(fullPath, !!isDir, 'thumbnail', LIST_THUMB_PX);
    if (cache.get(key)?.data || inflight.has(key)) continue;
    media.push({ path: fullPath, isDirectory: !!isDir });
    if (media.length >= limit) break;
  }
  if (!media.length) return;

  const CHUNK = 12;
  for (let i = 0; i < media.length; i += CHUNK) {
    const chunk = media.slice(i, i + CHUNK);
    if (IPC.isNative && typeof IPC.getNativeThumbnailsBatch === 'function') {
      try {
        const batch = await enqueueIconRequest(
          () => IPC.getNativeThumbnailsBatch(chunk.map(c => c.path), LIST_THUMB_PX),
          750,
          'thumb',
        );
        applyBatchChunk(chunk, batch, 'thumbnail', LIST_THUMB_PX);
        continue;
      } catch { /* per-item */ }
    }
    for (const r of chunk) {
      await requestNativeIcon(r.path, r.isDirectory, 'thumbnail', LIST_THUMB_PX);
    }
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

export function prefetchListingVisuals(
  entities: Array<{ path?: string; name: string; type?: string; isDirectory?: boolean; extension?: string }>,
  panePath: string,
  options?: { iconLimit?: number; thumbLimit?: number; includeFolderThumbs?: boolean },
) {
  if (!entities?.length) return;
  const iconLimit = options?.iconLimit ?? 160;
  const thumbLimit = options?.thumbLimit ?? 192;
  void Promise.all([
    prefetchIconsForEntities(entities, panePath, 'shell', iconLimit),
    prefetchMediaThumbnailsForEntities(entities, panePath, thumbLimit, {
      includeFolders: options?.includeFolderThumbs === true,
    }),
  ]);
}

/** Drop a poisoned cache entry so the next paint can refetch (broken CAS / 404 img). */
export function invalidateIconUrl(url: string | null | undefined): void {
  if (!url) return;
  for (const [key, entry] of cache) {
    if (entry.data === url) {
      cache.delete(key);
      notify(key);
    }
  }
  for (const [tk, data] of typeGlyphCache) {
    if (data === url) typeGlyphCache.delete(tk);
  }
  bitmapWarmed.delete(url);
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
  // Host ThumbNegatives + disk CAS — FE buster alone cannot un-poison failed SVG thumbs.
  void import('./ipcBridge').then(({ IPC }) => {
    if (IPC.isNative) void IPC.clearIconCache?.();
  });
}
