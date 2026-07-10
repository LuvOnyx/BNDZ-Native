/** Minimum gap between clicks before a slow double-click can arm rename (ms). */
export const SLOW_DOUBLE_CLICK_MIN_MS = 1000;

/** Maximum gap — faster than this is a normal double-click (open), not rename (ms). */
export const SLOW_DOUBLE_CLICK_MAX_MS = 2200;

/** Hold period after the second click before rename field appears (ms). */
export const SLOW_DOUBLE_CLICK_ARM_MS = 400;

export type SlowClickStamp = { key: string; time: number } | null;

export function clearSlowDoubleClickTimer(
  timerRef: { current: ReturnType<typeof setTimeout> | null },
): void {
  if (timerRef.current) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

/**
 * Explorer-style slow double-click rename: second click on an already-active item
 * after a deliberate pause arms inline rename (never on first click).
 */
export function advanceSlowDoubleClickRename(opts: {
  key: string;
  wasAlreadyActive: boolean;
  lastClick: SlowClickStamp;
  now?: number;
  timerRef: { current: ReturnType<typeof setTimeout> | null };
  onRename: () => void;
}): SlowClickStamp {
  const now = opts.now ?? Date.now();
  clearSlowDoubleClickTimer(opts.timerRef);

  if (opts.wasAlreadyActive && opts.lastClick?.key === opts.key) {
    const delay = now - opts.lastClick.time;
    if (delay >= SLOW_DOUBLE_CLICK_MIN_MS && delay <= SLOW_DOUBLE_CLICK_MAX_MS) {
      opts.timerRef.current = setTimeout(() => {
        opts.timerRef.current = null;
        opts.onRename();
      }, SLOW_DOUBLE_CLICK_ARM_MS);
    }
  }

  return { key: opts.key, time: now };
}
