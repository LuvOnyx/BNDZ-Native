import { IPC } from './ipcBridge';

type PendingEntry = {
  value: string;
  timer: ReturnType<typeof setTimeout>;
  resolve: () => void;
};

const pending = new Map<string, PendingEntry>();
const inFlight = new Map<string, Promise<boolean>>();

/** Debounced meta write — coalesces rapid saves (spatial zoom, automation edits). */
export function writeBndzMetaDebounced(
  key: string,
  value: string,
  delayMs = 400,
): Promise<void> {
  if (!IPC.isNative) {
    try { localStorage.setItem(`bndz_meta_${key}`, value); } catch { /* */ }
    return Promise.resolve();
  }
  const prev = pending.get(key);
  if (prev) {
    clearTimeout(prev.timer);
    prev.resolve();
  }
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      pending.delete(key);
      void flushBndzMeta(key, value).finally(() => resolve());
    }, delayMs);
    pending.set(key, { value, timer, resolve });
  });
}

/** Immediate meta write with in-flight coalescing per key. Never throws — logs and returns false. */
export async function flushBndzMeta(key: string, value: string): Promise<boolean> {
  if (!IPC.isNative) {
    try {
      localStorage.setItem(`bndz_meta_${key}`, value);
      return true;
    } catch {
      return false;
    }
  }
  const existing = inFlight.get(key);
  if (existing) {
    try { await existing; } catch { /* superseded */ }
  }
  const p = IPC.setBndzMeta(key, value).catch(err => {
    console.warn(`[BNDZ] Meta save failed (${key}):`, err);
    return false;
  });
  inFlight.set(key, p);
  try {
    return await p;
  } finally {
    if (inFlight.get(key) === p) inFlight.delete(key);
  }
}
