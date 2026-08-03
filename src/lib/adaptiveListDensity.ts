/**
 * Adaptive list density — RAF-throttled scroll velocity tracking.
 * Densifies rows during fast scroll; expands when idle or selection is focused.
 */

const DENSITY_MIN = 0.82;
const DENSITY_MAX = 1.1;
const DENSITY_IDLE = 1.0;
const DENSITY_FAST_SCROLL = 0.86;
const DENSITY_FOCUSED = 1.06;
const VELOCITY_FAST_THRESHOLD = 2.8;
const IDLE_MS = 420;

let currentDensity = DENSITY_IDLE;
let lastScrollTop = 0;
let lastScrollTime = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let rafPending = false;
let pendingVelocity = 0;
let hasFocusBoost = false;
let rootEl: HTMLElement | null = null;

function applyDensity(value: number) {
  const clamped = Math.min(DENSITY_MAX, Math.max(DENSITY_MIN, value));
  if (Math.abs(clamped - currentDensity) < 0.008) return;
  currentDensity = clamped;
  const el = rootEl ?? document.documentElement;
  el.style.setProperty('--bndz-list-density', clamped.toFixed(3));
}

function scheduleApply() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    const target = pendingVelocity >= VELOCITY_FAST_THRESHOLD
      ? DENSITY_FAST_SCROLL
      : hasFocusBoost
        ? DENSITY_FOCUSED
        : DENSITY_IDLE;
    applyDensity(target);
  });
}

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    pendingVelocity = 0;
    scheduleApply();
  }, IDLE_MS);
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

export function onAdaptiveListScroll(scrollTop: number) {
  const now = performance.now();
  const dt = Math.max(1, now - (lastScrollTime || now));
  const dy = Math.abs(scrollTop - lastScrollTop);
  pendingVelocity = dy / dt;
  lastScrollTop = scrollTop;
  lastScrollTime = now;
  scheduleApply();
  resetIdleTimer();
}

export function onAdaptiveListFocus(active: boolean) {
  hasFocusBoost = active;
  scheduleApply();
}

export function getAdaptiveListDensity(): number {
  return currentDensity;
}
