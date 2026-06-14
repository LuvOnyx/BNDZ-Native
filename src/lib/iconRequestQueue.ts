/** Limits concurrent native shell icon IPC calls to avoid WebView2/backend saturation. */
const MAX_CONCURRENT = 14;
let active = 0;
const pending: Array<() => void> = [];

function pump() {
  while (active < MAX_CONCURRENT && pending.length > 0) {
    const job = pending.shift();
    if (job) job();
  }
}

export function enqueueIconRequest<T>(fn: () => Promise<T>): Promise<T> {
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
    pending.push(run);
    pump();
  });
}
