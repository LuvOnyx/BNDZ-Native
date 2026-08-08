/** Split icon IPC queues: shell glyphs stay snappy; media thumbs never starve shells. */
import { hideFloatingTooltip } from './floatingTooltip';

let scrolling = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
/** Short idle so icons resume quickly after finger-lift without fighting the scroll frame. */
const SCROLL_IDLE_MS = 90;

const MAX_SHELL = 6;
const MAX_SHELL_SCROLLING = 3;
const MAX_THUMB = 3;
const MAX_THUMB_SCROLLING = 1;
const VIEWPORT_PRIORITY_FLOOR = 1700;
/** Raised so listing prefetch + viewport shells coexist without mass eviction. */
const MAX_PENDING = 192;

type QueueKind = 'shell' | 'thumb';

type Queued = { run: () => void; priority: number; reject?: (err: Error) => void; kind: QueueKind };
const pending: Queued[] = [];
let activeShell = 0;
let activeThumb = 0;

function shellLimit(): number {
  if (!scrolling) return MAX_SHELL;
  const hasViewport = pending.some(j => j.kind === 'shell' && j.priority >= VIEWPORT_PRIORITY_FLOOR);
  return hasViewport ? MAX_SHELL_SCROLLING + 1 : MAX_SHELL_SCROLLING;
}

function thumbLimit(): number {
  if (!scrolling) return MAX_THUMB;
  return MAX_THUMB_SCROLLING;
}

function dequeueHighest(kind: QueueKind): Queued | undefined {
  let bestIdx = -1;
  for (let i = 0; i < pending.length; i++) {
    if (pending[i].kind !== kind) continue;
    if (bestIdx < 0 || pending[i].priority > pending[bestIdx].priority) bestIdx = i;
  }
  if (bestIdx < 0) return undefined;
  return pending.splice(bestIdx, 1)[0];
}

function pump() {
  while (activeShell < shellLimit()) {
    const job = dequeueHighest('shell');
    if (!job) break;
    job.run();
  }
  while (activeThumb < thumbLimit()) {
    const job = dequeueHighest('thumb');
    if (!job) break;
    job.run();
  }
}

function setScrollingClass(on: boolean) {
  try {
    document.documentElement.classList.toggle('bndz-scrolling', on);
  } catch { /* ignore */ }
}

export function markScrolling(): void {
  scrolling = true;
  setScrollingClass(true);
  hideFloatingTooltip();
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    scrolling = false;
    idleTimer = null;
    setScrollingClass(false);
    pump();
  }, SCROLL_IDLE_MS);
}

export function isIconQueueScrolling(): boolean {
  return scrolling;
}

/** Depth of waiting + in-flight icon/thumb IPC work (Perf HUD). */
export function getIconQueueDepth(): number {
  return pending.length + activeShell + activeThumb;
}

export function getIconQueueActive(): number {
  return activeShell + activeThumb;
}

export function getIconQueueSplit(): { shell: number; thumb: number; pendingShell: number; pendingThumb: number } {
  return {
    shell: activeShell,
    thumb: activeThumb,
    pendingShell: pending.filter(j => j.kind === 'shell').length,
    pendingThumb: pending.filter(j => j.kind === 'thumb').length,
  };
}

function isProtectedFromEviction(job: Queued): boolean {
  // Viewport shells must never be dropped for thumb floods.
  return job.kind === 'shell' && job.priority >= VIEWPORT_PRIORITY_FLOOR;
}

/**
 * @param priority Higher runs first.
 *   shell ≈ 0–99 (+ viewport boost), list thumb ≈ 1000+.
 * @param kind Defaults from priority: ≥500 → thumb, else shell.
 */
export function enqueueIconRequest<T>(
  fn: () => Promise<T>,
  priority = 0,
  kind?: QueueKind,
): Promise<T> {
  const resolvedKind: QueueKind = kind ?? (priority >= 500 ? 'thumb' : 'shell');
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      if (resolvedKind === 'shell') activeShell++;
      else activeThumb++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          if (resolvedKind === 'shell') activeShell--;
          else activeThumb--;
          pump();
        });
    };
    if (pending.length >= MAX_PENDING) {
      let lowestIdx = -1;
      for (let i = 0; i < pending.length; i++) {
        if (isProtectedFromEviction(pending[i])) continue;
        if (lowestIdx < 0 || pending[i].priority < pending[lowestIdx].priority) lowestIdx = i;
      }
      // Prefer dropping thumbs before non-viewport shells when all shells are protected.
      if (lowestIdx < 0) {
        for (let i = 0; i < pending.length; i++) {
          if (pending[i].kind !== 'thumb') continue;
          if (lowestIdx < 0 || pending[i].priority < pending[lowestIdx].priority) lowestIdx = i;
        }
      }
      if (lowestIdx >= 0) {
        const evicted = pending.splice(lowestIdx, 1)[0];
        if (evicted?.reject) {
          evicted.reject(new Error('Icon request evicted from queue'));
        }
      }
    }

    pending.push({ run, priority, reject, kind: resolvedKind });
    pump();
  });
}
