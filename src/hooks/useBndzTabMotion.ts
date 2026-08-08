import { useCallback, useEffect, useRef } from 'react';
import { motionEnter } from '../lib/bndzMotion';

/**
 * Tab strip enter/exit — native FM feel.
 * Close commits immediately (waiting on width-collapse felt clunky).
 * Enter is a tiny opacity wink only.
 */
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
      motionEnter(el, { y: 2, duration: 55 });
    });
  }, [paneRevision]);

  const animateTabClose = useCallback((_tabId: string, onComplete: () => void) => {
    // Instant remove — Explorer / Terminal style. Anime width collapse lagged siblings.
    onComplete();
  }, []);

  return { scheduleTabEnter, animateTabClose };
}
