import { animate } from 'animejs';

/** Shared motion tokens for BNDZ File Manager chrome. */
export const MOTION = {
  fast: 180,
  normal: 260,
  slow: 360,
  easeOut: 'outCubic',
  easeIn: 'inCubic',
  spring: 'outElastic(1, .72)',
} as const;

export function motionEnter(
  el: HTMLElement | null | undefined,
  opts?: { x?: number; y?: number; scale?: number; duration?: number },
) {
  if (!el) return;
  animate(el, {
    opacity: [0, 1],
    translateX: opts?.x != null ? [opts.x, 0] : undefined,
    translateY: opts?.y != null ? [opts.y, 0] : undefined,
    scale: opts?.scale != null ? [opts.scale, 1] : undefined,
    duration: opts?.duration ?? MOTION.normal,
    ease: MOTION.easeOut,
  });
}

export function motionExit(
  el: HTMLElement | null | undefined,
  onComplete?: () => void,
  opts?: { duration?: number },
) {
  if (!el) {
    onComplete?.();
    return;
  }
  animate(el, {
    opacity: [1, 0],
    scale: [1, 0.96],
    duration: opts?.duration ?? MOTION.fast,
    ease: MOTION.easeIn,
    onComplete,
  });
}

export function motionPulse(el: HTMLElement | null | undefined) {
  if (!el) return;
  animate(el, {
    scale: [1, 1.02, 1],
    duration: MOTION.normal,
    ease: MOTION.easeOut,
  });
}
