/** Pause non-critical icon IPC while the user is actively scrolling. */
import { hideFloatingTooltip } from './floatingTooltip';

let scrolling = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const SCROLL_IDLE_MS = 120;

const MAX_CONCURRENT = 4;
const MAX_CONCURRENT_WHILE_SCROLLING = 2;
const VIEWPORT_PRIORITY_FLOOR = 1700;
const MAX_PENDING = 96;
let active = 0;

type Queued = { run: () => void; priority: number; reject?: (err: Error) => void };
const pending: Queued[] = [];

function concurrencyLimit(): number {
  if (!scrolling) return MAX_CONCURRENT;
  const hasViewportWork = pending.some(j => j.priority >= VIEWPORT_PRIORITY_FLOOR);
  return hasViewportWork ? MAX_CONCURRENT : MAX_CONCURRENT_WHILE_SCROLLING;
}

function dequeueHighestPriority(): Queued | undefined {
  if (!pending.length) return undefined;
  let bestIdx = 0;
  for (let i = 1; i < pending.length; i++) {
    if (pending[i].priority > pending[bestIdx].priority) bestIdx = i;
  }
  return pending.splice(bestIdx, 1)[0];
}

function pump() {
  const limit = concurrencyLimit();
  while (active < limit && pending.length > 0) {
    const job = dequeueHighestPriority();
    if (job) job.run();
  }
}

export function markScrolling(): void {
  scrolling = true;
  hideFloatingTooltip();
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    scrolling = false;
    idleTimer = null;
    pump();
  }, SCROLL_IDLE_MS);
}

export function isIconQueueScrolling(): boolean {
  return scrolling;
}

/** Depth of waiting + in-flight icon/thumb IPC work (Perf HUD). */
export function getIconQueueDepth(): number {
  return pending.length + active;
}

export function getIconQueueActive(): number {
  return active;
}

/**
 * @param priority Higher runs first.
 *   shell ≈ 0–99, list thumb ≈ 1000+, viewport boost adds distance score (closer = higher).
 */
export function enqueueIconRequest<T>(fn: () => Promise<T>, priority = 0): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      active++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          active--;
          pump();
        });
    };
    if (pending.length >= MAX_PENDING) {
      let lowestIdx = 0;
      for (let i = 1; i < pending.length; i++) {
        if (pending[i].priority < pending[lowestIdx].priority) lowestIdx = i;
      }
      const evicted = pending.splice(lowestIdx, 1)[0];
      // Reject so callers don't hang forever waiting on an evicted job.
      if (evicted?.reject) {
        evicted.reject(new Error('Icon request evicted from queue'));
      }
    }

    pending.push({ run, priority, reject });
    pump();
  });
}
