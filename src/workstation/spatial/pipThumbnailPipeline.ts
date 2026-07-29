import { requestNativeIcon } from '../../lib/nativeIconService';

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();
const MAX_JOBS = 12;
let active = 0;
const queue: Array<() => void> = [];

function runNext() {
  if (active >= MAX_JOBS || !queue.length) return;
  active++;
  const job = queue.shift();
  job?.();
}

function finish() {
  active = Math.max(0, active - 1);
  runNext();
}

export function getPipThumbCached(path: string): string | null {
  return cache.get(path) ?? null;
}

export function requestPipThumb(path: string, isDir: boolean): Promise<string | null> {
  const hit = cache.get(path);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(path);
  if (pending) return pending;

  const promise = new Promise<string | null>(resolve => {
    const start = () => {
      requestNativeIcon(path, isDir, 'thumbnail', 96)
        .then(url => {
          if (url) cache.set(path, url);
          resolve(url);
        })
        .catch(() => resolve(null))
        .finally(() => {
          inflight.delete(path);
          finish();
        });
    };
    queue.push(start);
    runNext();
  });
  inflight.set(path, promise);
  return promise;
}
