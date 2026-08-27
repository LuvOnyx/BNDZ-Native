/** Merge streamed directory chunks without duplicate rows. */
import { isUriJunkPath } from './pathUtils';

export function mergeDirEntryChunks(existing: any[], chunk: any[]): any[] {
  const clean = (e: any) => {
    if (!e || typeof e !== 'object') return e;
    const p = typeof e.path === 'string' ? e.path : '';
    if (p && isUriJunkPath(p)) {
      const { path: _drop, ...rest } = e;
      return rest;
    }
    return e;
  };
  if (!chunk.length) return existing;
  const cleanedChunk = chunk.map(clean);
  if (!existing.length) return cleanedChunk.slice();
  const byKey = new Map<string, any>();
  const keyOf = (e: any) => String(e.id || e.path || e.name || '');
  for (const e of existing.map(clean)) {
    const k = keyOf(e);
    if (k) byKey.set(k, e);
  }
  for (const e of cleanedChunk) {
    const k = keyOf(e);
    if (k) byKey.set(k, e);
  }
  return Array.from(byKey.values());
}

export function dispatchDirStream(path: string, items: any[], id?: string) {
  window.dispatchEvent(new CustomEvent('bndz-dir-stream', {
    detail: { id, path, items },
  }));
}

export function dispatchDirAppend(path: string, items: any[], id?: string) {
  window.dispatchEvent(new CustomEvent('bndz-dir-append', {
    detail: { id, path, items },
  }));
}
