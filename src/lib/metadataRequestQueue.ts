/**
 * Serializes GET_EXTENDED_METADATA IPC — backend allows only 3 concurrent metadata slots.
 * Unbounded parallel calls from custom columns / tooltips caused EXTENDED_METADATA_RESULT timeouts.
 */
import { isIconQueueScrolling } from './iconRequestQueue';

const MAX_CONCURRENT = 3;
const MAX_CONCURRENT_WHILE_SCROLLING = 1;
const MAX_PENDING = 48;

let active = 0;

type Queued = { run: () => void; priority: number };
const pending: Queued[] = [];

function concurrencyLimit(): number {
  return isIconQueueScrolling() ? MAX_CONCURRENT_WHILE_SCROLLING : MAX_CONCURRENT;
}

function pump() {
  const limit = concurrencyLimit();
  while (active < limit && pending.length > 0) {
    pending.sort((a, b) => b.priority - a.priority);
    const job = pending.shift();
    if (job) job.run();
  }
}

export function getMetadataQueueDepth(): number {
  return pending.length + active;
}

/** Higher priority = sooner (preview/tooltip > visible column > background). */
export function enqueueMetadataRequest<T>(fn: () => Promise<T>, priority = 400): Promise<T> {
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
      // Drop lowest-priority waiter — column cells will retry on next visibility pass.
      pending.sort((a, b) => a.priority - b.priority);
      pending.shift();
    }

    pending.push({ run, priority });
    pump();
  });
}
