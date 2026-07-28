import { IPC } from './ipcBridge';

type PendingEntry = {
  value: string;
  timer: ReturnType<typeof setTimeout>;
  resolve: () => void;
};

const pending = new Map<string, PendingEntry>();
let metaWriteChain: Promise<boolean> = Promise.resolve(true);
const lastFlushed = new Map<string, string>();
/** Latest value per key — coalesces bursts so only the newest payload hits SQLite. */
const latestQueued = new Map<string, string>();

function cacheLocal(key: string, value: string) {
  try { localStorage.setItem(`bndz_meta_${key}`, value); } catch { /* */ }
}

function readLocalMeta(key: string): string | null {
  try { return localStorage.getItem(`bndz_meta_${key}`); } catch { return null; }
}

function metaUpdatedAt(raw: string | null): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as { updatedAt?: number };
    return typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0;
  } catch {
    return 0;
  }
}

/** Read meta from local cache + native store — prefers the newest `updatedAt` payload. */
export async function readBndzMeta(key: string): Promise<string | null> {
  const localRaw = readLocalMeta(key);
  if (!IPC.isNative) return localRaw;

  let remoteRaw: string | null = null;
  try {
    remoteRaw = await IPC.getBndzMeta(key);
  } catch {
    remoteRaw = null;
  }

  if (!localRaw) return remoteRaw;
  if (!remoteRaw) return localRaw;

  const localTs = metaUpdatedAt(localRaw);
  const remoteTs = metaUpdatedAt(remoteRaw);
  const winner = localTs >= remoteTs ? localRaw : remoteRaw;
  cacheLocal(key, winner);
  if (IPC.isNative && winner !== remoteRaw) {
    void enqueueMetaFlush(key, winner);
  }
  return winner;
}

/** Serialize all meta IPC writes — prevents burst timeouts from overlapping SET_BNDZ_META calls. */
function enqueueMetaFlush(key: string, value: string): Promise<boolean> {
  cacheLocal(key, value);
  if (!IPC.isNative) return Promise.resolve(true);
  latestQueued.set(key, value);
  if (lastFlushed.get(key) === value) {
    latestQueued.delete(key);
    return Promise.resolve(true);
  }

  const run = async (): Promise<boolean> => {
    const toWrite = latestQueued.get(key);
    if (!toWrite) return true;
    latestQueued.delete(key);
    if (lastFlushed.get(key) === toWrite) return true;
    try {
      const ok = await IPC.setBndzMeta(key, toWrite);
      if (ok) lastFlushed.set(key, toWrite);
      return ok;
    } catch (err) {
      console.warn(`[BNDZ] Meta save failed (${key}):`, err);
      return false;
    } finally {
      if (latestQueued.has(key)) {
        const newer = latestQueued.get(key)!;
        latestQueued.delete(key);
        if (lastFlushed.get(key) !== newer) {
          return enqueueMetaFlush(key, newer);
        }
      }
    }
  };

  metaWriteChain = metaWriteChain.then(run, run);
  return metaWriteChain;
}

/** Debounced meta write — coalesces rapid saves (spatial zoom, automation edits). */
export function writeBndzMetaDebounced(
  key: string,
  value: string,
  delayMs = 800,
): Promise<void> {
  cacheLocal(key, value);
  if (!IPC.isNative) return Promise.resolve();
  latestQueued.set(key, value);
  if (lastFlushed.get(key) === value) return Promise.resolve();

  const delay = Math.max(1200, delayMs);

  const prev = pending.get(key);
  if (prev) {
    if (prev.value === value) return Promise.resolve();
    clearTimeout(prev.timer);
    prev.resolve();
  }
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      pending.delete(key);
      const latest = latestQueued.get(key) ?? value;
      void enqueueMetaFlush(key, latest).finally(() => resolve());
    }, delay);
    pending.set(key, { value, timer, resolve });
  });
}

/** Immediate meta write — still serialized through the global chain. */
export async function flushBndzMeta(key: string, value: string): Promise<boolean> {
  const prev = pending.get(key);
  if (prev) {
    clearTimeout(prev.timer);
    pending.delete(key);
    prev.resolve();
  }
  latestQueued.set(key, value);
  return enqueueMetaFlush(key, value);
}
