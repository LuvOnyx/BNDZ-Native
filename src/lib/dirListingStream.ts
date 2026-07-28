/** Merge streamed directory chunks without duplicate rows. */
export function mergeDirEntryChunks(existing: any[], chunk: any[]): any[] {
  if (!chunk.length) return existing;
  if (!existing.length) return chunk.slice();
  const byKey = new Map<string, any>();
  const keyOf = (e: any) => String(e.id || e.path || e.name || '');
  for (const e of existing) {
    const k = keyOf(e);
    if (k) byKey.set(k, e);
  }
  for (const e of chunk) {
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
