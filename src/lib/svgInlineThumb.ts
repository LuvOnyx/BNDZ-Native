/**
 * Inline SVG -> blob: URL for list/Lens thumbs when CAS/stream is empty.
 * Avoids bndz-stream (custom-scheme 404s) while Skia raster fills CAS.
 * LRU-capped so blob URLs do not leak forever across long sessions.
 */
import { IPC } from './ipcBridge';
import { toWindowsPath } from './pathUtils';

const MAX_CACHE = 200;
const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

function touch(key: string, url: string) {
  // Re-insert so Map iteration order reflects LRU (oldest = first).
  if (cache.has(key)) cache.delete(key);
  cache.set(key, url);
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest == null) break;
    const oldUrl = cache.get(oldest);
    cache.delete(oldest);
    if (oldUrl) {
      try { URL.revokeObjectURL(oldUrl); } catch { /* ignore */ }
    }
  }
}

export function revokeSvgInlineThumb(path: string) {
  const key = toWindowsPath(path).toLowerCase();
  const url = cache.get(key);
  if (url) {
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    cache.delete(key);
  }
}

export function clearSvgInlineThumbCache() {
  for (const url of cache.values()) {
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }
  cache.clear();
  inflight.clear();
}

export async function resolveSvgInlineThumb(path: string | null | undefined): Promise<string | null> {
  if (!path || !IPC.isNative) return null;
  const win = toWindowsPath(path);
  if (!win || !/\.svgz?$/i.test(win)) return null;
  const key = win.toLowerCase();
  const hit = cache.get(key);
  if (hit) {
    touch(key, hit);
    return hit;
  }
  const pending = inflight.get(key);
  if (pending) return pending;

  const job = (async () => {
    try {
      // Prefer UTF-8 text decode for .svg -- bndz-stream / CAS thumbs are flaky for vectors.
      if (/\.svg$/i.test(win)) {
        const res = await IPC.readTextFile(win, 4 * 1024 * 1024);
        const text = res?.content;
        if (text && typeof text === 'string' && text.length >= 8) {
          const sanitized = text
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
          const blob = new Blob([sanitized], { type: 'image/svg+xml' });
          const url = URL.createObjectURL(blob);
          const prev = cache.get(key);
          if (prev && prev !== url) {
            try { URL.revokeObjectURL(prev); } catch { /* ignore */ }
          }
          touch(key, url);
          return url;
        }
      }

      // .svgz or text-read miss -- fall back to media blob (binary) when available.
      try {
        const media = await IPC.getMediaBlob(win, 4 * 1024 * 1024);
        if (media?.base64 && !media.error) {
          const bin = atob(media.base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const mime = media.mime || (/\.svgz$/i.test(win) ? 'image/svg+xml' : 'image/svg+xml');
          // svgz is gzip -- browsers can't paint it as image/svg+xml; skip unless already inflated.
          if (/\.svgz$/i.test(win) && bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
            return null;
          }
          const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)], {
            type: mime.includes('svg') ? 'image/svg+xml' : mime,
          });
          const url = URL.createObjectURL(blob);
          const prev = cache.get(key);
          if (prev && prev !== url) {
            try { URL.revokeObjectURL(prev); } catch { /* ignore */ }
          }
          touch(key, url);
          return url;
        }
      } catch { /* ignore */ }

      return null;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, job);
  return job;
}
