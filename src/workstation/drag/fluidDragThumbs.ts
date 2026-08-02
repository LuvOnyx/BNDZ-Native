import { LIST_THUMB_PX, requestNativeIcon } from '../../lib/nativeIconService';

export type FluidDragItem = {
  path: string;
  name: string;
  isDirectory: boolean;
};

const thumbCache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

function thumbKey(path: string, isDirectory: boolean): string {
  return `${isDirectory ? 'd' : 'f'}:${path.toLowerCase()}`;
}

/** Sync cache peek — avoids Icons8→native flash when a prior fetch already landed. */
export function peekFluidDragThumb(path: string, isDirectory: boolean): string | null {
  const hit = thumbCache.get(thumbKey(path, isDirectory));
  return hit || null;
}

export function peekFluidDragThumbs(items: FluidDragItem[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of items) {
    const data = peekFluidDragThumb(item.path, item.isDirectory);
    if (data) out[item.path] = data;
  }
  return out;
}

export async function fetchFluidDragThumb(path: string, isDirectory: boolean): Promise<string | null> {
  const key = thumbKey(path, isDirectory);
  const hit = thumbCache.get(key);
  if (hit !== undefined) return hit || null;

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const dir = isDirectory;
      // Prefer thumbnail for files so drag cards match list thumbs (not shell→thumb swap).
      if (!dir) {
        const thumb = await requestNativeIcon(path, false, 'thumbnail', LIST_THUMB_PX);
        if (thumb) {
          thumbCache.set(key, thumb);
          return thumb;
        }
      }
      const shell = await requestNativeIcon(path, dir, 'shell', LIST_THUMB_PX);
      if (shell) {
        thumbCache.set(key, shell);
        return shell;
      }
      thumbCache.set(key, '');
      return null;
    } catch {
      thumbCache.set(key, '');
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

export async function prefetchFluidDragThumbs(items: FluidDragItem[], limit = 8): Promise<Record<string, string>> {
  const slice = items.slice(0, limit);
  const out: Record<string, string> = {};
  await Promise.all(slice.map(async item => {
    const data = await fetchFluidDragThumb(item.path, item.isDirectory);
    if (data) out[item.path] = data;
  }));
  return out;
}
