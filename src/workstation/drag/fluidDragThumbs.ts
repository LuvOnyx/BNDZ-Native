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

export async function fetchFluidDragThumb(path: string, isDirectory: boolean): Promise<string | null> {
  const key = thumbKey(path, isDirectory);
  const hit = thumbCache.get(key);
  if (hit) return hit || null;

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const dir = isDirectory;
      const shell = await requestNativeIcon(path, dir, 'shell', LIST_THUMB_PX);
      if (shell) {
        thumbCache.set(key, shell);
        return shell;
      }
      if (!isDirectory) {
        const thumb = await requestNativeIcon(path, false, 'thumbnail', LIST_THUMB_PX);
        if (thumb) {
          thumbCache.set(key, thumb);
          return thumb;
        }
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
