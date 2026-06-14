import type { HoverTooltipContent, HoverTooltipTheme } from '../components/HoverTooltip';

export interface FloatingTooltipState {
  content: HoverTooltipContent;
  x: number;
  y: number;
  theme: HoverTooltipTheme;
}

interface HoverPending {
  content: HoverTooltipContent;
  x: number;
  y: number;
  theme: HoverTooltipTheme;
}

let state: FloatingTooltipState | null = null;
let hoverPending: HoverPending | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

/** Grace period before fade-out when the pointer leaves */
export const FADE_OUT_DELAY_MS = 180;
export const FADE_OUT_MS = 120;

function notify() {
  listeners.forEach(fn => fn());
}

function clearHideTimer() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function clearVisibleTooltip() {
  clearHideTimer();
  if (!state) return;
  state = null;
  notify();
}

export function subscribeFloatingTooltip(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getFloatingTooltip(): FloatingTooltipState | null {
  return state;
}

export function getHoverPending(): HoverPending | null {
  return hoverPending;
}

/** Register hovered item — tooltip appears only while Left Shift is held */
export function setHoverPending(
  content: HoverTooltipContent | null,
  x: number,
  y: number,
  theme: HoverTooltipTheme = 'glass',
  showImmediately = false,
) {
  clearHideTimer();
  if (!content) {
    hoverPending = null;
    clearVisibleTooltip();
    return;
  }
  hoverPending = { content, x, y, theme };
  const canShow = showImmediately || isShiftKeyHeld();
  if (canShow) {
    state = { content, x, y, theme };
    notify();
  } else {
    clearVisibleTooltip();
  }
}

export function updateHoverPendingPosition(x: number, y: number) {
  if (!hoverPending) return;
  hoverPending = { ...hoverPending, x, y };
  if (!isShiftKeyHeld()) {
    clearVisibleTooltip();
    return;
  }
  if (state) {
    state = { ...state, x, y };
    notify();
  }
}

export function refreshTooltipForShiftChange(shiftHeld: boolean) {
  if (shiftHeld && hoverPending) {
    clearHideTimer();
    state = {
      content: hoverPending.content,
      x: hoverPending.x,
      y: hoverPending.y,
      theme: hoverPending.theme,
    };
    notify();
    return;
  }
  clearVisibleTooltip();
}

function dismissVisibleTooltip(opts?: { delayMs?: number; fadeMs?: number }) {
  const delayMs = opts?.delayMs ?? FADE_OUT_DELAY_MS;
  const fadeMs = opts?.fadeMs ?? FADE_OUT_MS;
  clearHideTimer();
  if (!state) return;
  hideTimer = setTimeout(() => {
    hideTimer = setTimeout(() => {
      state = null;
      notify();
      hideTimer = null;
    }, fadeMs);
  }, delayMs);
}

export function moveFloatingTooltip(x: number, y: number) {
  updateHoverPendingPosition(x, y);
}

/** Mouse left the row — clear pending hover and fade out */
export function hideFloatingTooltip() {
  hoverPending = null;
  dismissVisibleTooltip();
}

/** Left Shift only — avoids accidental tooltip reveal from right Shift */
let leftShiftKeyHeld = false;

export function isShiftKeyHeld(): boolean {
  return leftShiftKeyHeld;
}

export function initShiftTooltipKeys() {
  if (typeof window === 'undefined') return;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code !== 'ShiftLeft' || leftShiftKeyHeld) return;
    leftShiftKeyHeld = true;
    refreshTooltipForShiftChange(true);
    notifyShiftKeyListeners();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code !== 'ShiftLeft' || !leftShiftKeyHeld) return;
    leftShiftKeyHeld = false;
    refreshTooltipForShiftChange(false);
    notifyShiftKeyListeners();
  };
  const onBlur = () => {
    if (!leftShiftKeyHeld) return;
    leftShiftKeyHeld = false;
    refreshTooltipForShiftChange(false);
    notifyShiftKeyListeners();
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
}

const shiftKeyListeners = new Set<() => void>();

export function subscribeShiftKey(listener: () => void): () => void {
  shiftKeyListeners.add(listener);
  return () => shiftKeyListeners.delete(listener);
}

function notifyShiftKeyListeners() {
  shiftKeyListeners.forEach(fn => fn());
}

initShiftTooltipKeys();
