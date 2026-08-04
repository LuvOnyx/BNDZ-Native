import { generateId } from './generateId';
import { decodeBnd1DirListing } from './dirListingBinary';
import { hydrateShellGlyphMap } from './nativeIconService';

/** Unique IPC request IDs — prevents response cross-wiring under burst load. */
export function generateIpcId(suffix?: string): string {
  const base = generateId();
  return suffix ? `${base}_${suffix}` : base;
}

type PendingHandler = {
  responseType: string;
  resolve: (payload: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, PendingHandler>();
let listenerInstalled = false;

/** Optional host→UI push handlers (ipcBridge registers here). */
type PushHandler = (data: { type: string; id?: string; payload?: unknown; [key: string]: unknown }) => void;
const pushHandlers = new Set<PushHandler>();

export function registerIpcPushHandler(handler: PushHandler): () => void {
  pushHandlers.add(handler);
  return () => pushHandlers.delete(handler);
}

function rejectPending(id: string | undefined, err: Error) {
  if (!id) return;
  const handler = pending.get(id);
  if (!handler) return;
  pending.delete(id);
  clearTimeout(handler.timer);
  handler.reject(err);
}

function resolvePending(id: string | undefined, type: string | undefined, payload: unknown) {
  if (!id || !type) return;
  const handler = pending.get(id);
  if (!handler || handler.responseType !== type) return;
  pending.delete(id);
  clearTimeout(handler.timer);
  handler.resolve(payload);
}

function ingestHostMessage(data: { type?: string; id?: string; payload?: unknown; [key: string]: unknown }) {
  if (!data?.type) return;

  // Listing-time glyphs — hydrate BEFORE dir contents resolve so first paint has type icons.
  if (data.type === 'SHELL_GLYPH_MAP' && data.payload && typeof data.payload === 'object') {
    hydrateShellGlyphMap(data.payload as Record<string, string>);
    window.dispatchEvent(new CustomEvent('bndz-shell-glyph-map', {
      detail: { id: data.id, path: (data as { path?: string }).path || '', glyphs: data.payload },
    }));
    return;
  }

  if (data.type === 'DIR_CONTENTS_APPEND' && Array.isArray(data.payload)) {
    window.dispatchEvent(new CustomEvent('bndz-dir-append', {
      detail: { id: data.id, path: (data as { path?: string }).path || '', items: data.payload },
    }));
    return;
  }

  if (data.type === 'DIR_CONTENTS_STREAM' && Array.isArray(data.payload)) {
    window.dispatchEvent(new CustomEvent('bndz-dir-stream', {
      detail: { id: data.id, path: (data as { path?: string }).path || '', items: data.payload },
    }));
    return;
  }

  if (data.id) {
    resolvePending(data.id, data.type, data.payload);
  }

  for (const handler of pushHandlers) {
    try { handler(data); } catch { /* best-effort */ }
  }
}

function ensureGlobalListener() {
  if (listenerInstalled || typeof window === 'undefined') return;
  const webview = (window as any).chrome?.webview;
  if (!webview) return;

  webview.addEventListener('message', (e: MessageEvent) => {
    let data: any = e.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }
    ingestHostMessage(data);
  });

  // Zero-copy SharedBuffer path for massive directory listings (and future bulk payloads).
  webview.addEventListener('sharedbufferreceived', (e: any) => {
    let pendingId: string | undefined;
    try {
      let meta: any = e.additionalData;
      if (typeof meta === 'string') {
        try {
          meta = JSON.parse(meta);
        } catch {
          meta = {};
        }
      }
      meta ??= {};
      const id = meta.id as string | undefined;
      pendingId = id;
      const type = meta.type as string | undefined;
      const format = meta.format as string | undefined;
      const buffer: ArrayBuffer | undefined = e.getBuffer?.();
      if (!buffer || !id || !type) {
        if (buffer) {
          try { webview.releaseBuffer?.(buffer); } catch { /* ignore */ }
        }
        return;
      }

      let payload: unknown;
      if (format === 'bnd1') {
        try {
          payload = decodeBnd1DirListing(buffer);
        } catch (decodeErr) {
          try { webview.releaseBuffer?.(buffer); } catch { /* ignore */ }
          rejectPending(id, decodeErr instanceof Error ? decodeErr : new Error(String(decodeErr)));
          return;
        }
      } else {
        try { webview.releaseBuffer?.(buffer); } catch { /* ignore */ }
        rejectPending(id, new Error(`Unsupported SharedBuffer format: ${format ?? 'unknown'}`));
        return;
      }

      try { webview.releaseBuffer?.(buffer); } catch { /* ignore */ }

      if (type === 'DIR_CONTENTS_APPEND') {
        const path = (meta.path as string | undefined) || '';
        window.dispatchEvent(new CustomEvent('bndz-dir-append', {
          detail: { id, path, items: payload },
        }));
        return;
      }

      if (type === 'DIR_CONTENTS_STREAM') {
        const path = (meta.path as string | undefined) || '';
        window.dispatchEvent(new CustomEvent('bndz-dir-stream', {
          detail: { id, path, items: payload },
        }));
        return;
      }

      resolvePending(id, type, payload);
    } catch (err) {
      console.warn('[IPC] SharedBuffer decode failed', err);
      if (pendingId) rejectPending(pendingId, err instanceof Error ? err : new Error(String(err)));
    }
  });

  listenerInstalled = true;
}

export function nativeCall<T>(
  type: string,
  responseType: string,
  payload?: unknown,
  timeoutMs = 15000,
): Promise<T> {
  ensureGlobalListener();
  const webview = (window as any).chrome?.webview;
  if (!webview) return Promise.reject(new Error('Not in native host'));

  const id = generateIpcId(type.toLowerCase());

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(id)) {
        // Quiet warn — callers often .catch() to empty defaults; avoid console spam storms.
        if (typeof console !== 'undefined' && console.debug) {
          console.debug(`[IPC] Timeout waiting for ${responseType} (id=${id})`);
        }
        reject(new Error(`IPC timeout: ${responseType}`));
      }
    }, timeoutMs);

    pending.set(id, {
      responseType,
      resolve: resolve as (p: unknown) => void,
      reject,
      timer,
    });

    try {
      webview.postMessage(
        payload !== undefined ? { type, payload, id } : { type, id },
      );
    } catch (err) {
      pending.delete(id);
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/** Deduplicate in-flight IPC calls keyed by a stable string (e.g. normalized path). */
export function dedupeInFlight<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const store = (dedupeInFlight as any)._map as Map<string, Promise<T>> | undefined;
  const map: Map<string, Promise<T>> = store ?? new Map();
  (dedupeInFlight as any)._map = map;

  const existing = map.get(key);
  if (existing) return existing;

  const promise = factory().finally(() => map.delete(key));
  map.set(key, promise);
  return promise;
}
