/**
 * Warm lazy chunks after the file manager has painted, so the first Space (Quick Look), image
 * preview or workspace-tool visit does not wait on a network-free but still non-zero
 * parse/compile. Each key loads at most once; failures are ignored (the real import retries).
 */
type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
};

const started = new Set<string>();

export function prefetchWhenIdle(key: string, loader: () => Promise<unknown>, timeoutMs = 5000): void {
  if (typeof window === 'undefined' || started.has(key)) return;
  started.add(key);
  const run = () => { void loader().catch(() => { started.delete(key); }); };
  const ric = (window as IdleWindow).requestIdleCallback;
  if (typeof ric === 'function') ric(run, { timeout: timeoutMs });
  else window.setTimeout(run, Math.min(timeoutMs, 1500));
}
