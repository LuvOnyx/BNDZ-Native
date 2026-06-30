import { useCallback, useEffect, useRef } from 'react';
import { motionEnter, motionExit } from '../lib/bndzMotion';

/** Tab strip enter/exit animations — decoupled from BNDZUI render order. */
export function useBndzTabMotion(paneRevision: unknown) {
  const pendingTabIdRef = useRef<string | null>(null);

  const scheduleTabEnter = useCallback((tabId: string) => {
    pendingTabIdRef.current = tabId;
  }, []);

  useEffect(() => {
    const tabId = pendingTabIdRef.current;
    if (!tabId) return;
    pendingTabIdRef.current = null;
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-tab-id="${tabId}"]`) as HTMLElement | null;
      motionEnter(el, { y: 6, scale: 0.97, duration: 220 });
    });
  }, [paneRevision]);

  const animateTabClose = useCallback((tabId: string, onComplete: () => void) => {
    const el = document.querySelector(`[data-tab-id="${tabId}"]`) as HTMLElement | null;
    if (el) {
      motionExit(el, onComplete);
      return;
    }
    onComplete();
  }, []);

  return { scheduleTabEnter, animateTabClose };
}
