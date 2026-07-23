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

/**
 * Finished transfer-row exit: right→left dissolve (reverse load / diffusion).
 * Uses clip-path + opacity so the bar appears to unload backward.
 */
export function motionTransferDismiss(
  el: HTMLElement | null | undefined,
  onComplete?: () => void,
) {
  if (!el) {
    onComplete?.();
    return;
  }
  animate(el, {
    opacity: [1, 0],
    translateX: [0, -28],
    filter: ['blur(0px)', 'blur(6px)'],
    clipPath: ['inset(0% 0% 0% 0%)', 'inset(0% 100% 0% 0%)'],
    duration: 520,
    ease: 'inOutCubic',
    onComplete,
  });
}

/** Morph bottom plugin panel into immersive workspace cover. */
export function motionPanelImmersiveEnter(el: HTMLElement | null | undefined) {
  if (!el) return;
  animate(el, {
    opacity: [0, 1],
    translateY: ['12%', '0%'],
    scale: [0.985, 1],
    duration: MOTION.slow,
    ease: MOTION.easeOut,
  });
}

export function motionPanelImmersiveExit(
  el: HTMLElement | null | undefined,
  onComplete?: () => void,
) {
  if (!el) {
    onComplete?.();
    return;
  }
  animate(el, {
    opacity: [1, 0],
    translateY: ['0%', '8%'],
    scale: [1, 0.99],
    duration: MOTION.normal,
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
