import { generateId } from './generateId';

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
    if (!data?.type || !data?.id) return;

    const handler = pending.get(data.id);
    if (!handler || handler.responseType !== data.type) return;

    pending.delete(data.id);
    clearTimeout(handler.timer);
    handler.resolve(data.payload);
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
        console.warn(`[IPC] Timeout waiting for ${responseType} (id=${id})`);
        reject(new Error(`IPC timeout: ${responseType}`));
      }
    }, timeoutMs);

    pending.set(id, {
      responseType,
      resolve: resolve as (p: unknown) => void,
      reject,
      timer,
    });

    webview.postMessage(
      payload !== undefined ? { type, payload, id } : { type, id },
    );
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
