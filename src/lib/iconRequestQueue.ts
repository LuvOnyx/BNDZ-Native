/** Pause non-critical icon IPC while the user is actively scrolling. */
import { hideFloatingTooltip } from './floatingTooltip';

let scrolling = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const SCROLL_IDLE_MS = 120;

const MAX_CONCURRENT = 16;
const MAX_CONCURRENT_WHILE_SCROLLING = 6;
let active = 0;

type Queued = { run: () => void; priority: number };
const pending: Queued[] = [];

function concurrencyLimit(): number {
  return scrolling ? MAX_CONCURRENT_WHILE_SCROLLING : MAX_CONCURRENT;
}

function pump() {
  const limit = concurrencyLimit();
  while (active < limit && pending.length > 0) {
    // Higher priority first (thumbnails > shell glyphs).
    pending.sort((a, b) => b.priority - a.priority);
    const job = pending.shift();
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

/** @param priority 0 = shell glyph, 1 = list thumbnail (preferred) */
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
    pending.push({ run, priority });
    pump();
  });
}
