import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';

/** Debounced save — coalesces bursts; skips identical serialized payloads. */
export function useWorkspaceAutosave(
  serialize: () => string,
  save: (payload: string) => Promise<boolean>,
  delayMs: number,
  enabled: boolean,
) {
  const lastSaved = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serializeRef = useRef(serialize);
  const saveRef = useRef(save);
  serializeRef.current = serialize;
  saveRef.current = save;

  const flush = useCallback(async (force = false) => {
    if (!enabled) return true;
    const snap = serializeRef.current();
    if (!snap || snap === 'null') return false;
    if (!force && snap === lastSaved.current) return true;
    const ok = await saveRef.current(snap);
    if (ok) lastSaved.current = snap;
    return ok;
  }, [enabled]);

  const schedule = useCallback(() => {
    if (!enabled) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void flush();
    }, delayMs);
  }, [enabled, delayMs, flush]);

  const seed = useCallback((snap: string) => {
    if (snap && snap !== 'null') lastSaved.current = snap;
  }, []);

  /** Flush pending edits when leaving the workspace — runs before unmount paint. */
  useLayoutEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      if (!enabled) return;
      const snap = serializeRef.current();
      if (!snap || snap === 'null') return;
      void saveRef.current(snap).then(ok => {
        if (ok) lastSaved.current = snap;
      });
    };
  }, [enabled]);

  return useMemo(() => ({ schedule, flush, seed }), [schedule, flush, seed]);
}
