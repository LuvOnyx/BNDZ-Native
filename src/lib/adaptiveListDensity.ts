/**
 * Adaptive list density — focus boost only.
 * Mid-scroll row-height densify was removed: changing --bndz-list-density while
 * scrolling reflows virtual rows against a fixed estimateSize and flashes.
 */

const DENSITY_IDLE = 1.0;
const DENSITY_FOCUSED = 1.04;

let currentDensity = DENSITY_IDLE;
let hasFocusBoost = false;
let rootEl: HTMLElement | null = null;
let rafPending = false;

function applyDensity(value: number) {
  const clamped = Math.min(1.08, Math.max(0.95, value));
  if (Math.abs(clamped - currentDensity) < 0.004) return;
  currentDensity = clamped;
  const el = rootEl ?? document.documentElement;
  el.style.setProperty('--bndz-list-density', clamped.toFixed(3));
}

function scheduleApply() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    applyDensity(hasFocusBoost ? DENSITY_FOCUSED : DENSITY_IDLE);
  });
}

export function initAdaptiveListDensity(enabled: boolean, persistValue?: number | null) {
  rootEl = document.documentElement;
  if (!enabled) {
    applyDensity(1);
    return;
  }
  if (typeof persistValue === 'number' && persistValue > 0) {
    applyDensity(persistValue);
  } else {
    applyDensity(DENSITY_IDLE);
  }
}

/** Kept for call-site compatibility — no layout mutation during scroll. */
export function onAdaptiveListScroll(_scrollTop: number) {
  // Intentionally empty: scroll velocity must not resize rows.
}

export function onAdaptiveListFocus(active: boolean) {
  hasFocusBoost = active;
  scheduleApply();
}

export function getAdaptiveListDensity(): number {
  return currentDensity;
}
