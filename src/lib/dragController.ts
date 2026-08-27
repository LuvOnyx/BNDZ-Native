/**
 * Shared drag / marquee interaction guard — prevents accidental drags during
 * double-clicks, marquee selection, and enforces movement threshold.
 */

/**
 * Movement before a list drag can arm — slightly above SM_CXDRAG so a jittery
 * first click of a double-click does not hijack into fluid-drag.
 */
const DRAG_THRESHOLD_PX = 10;
const NATIVE_DRAG_THRESHOLD_PX = 6;
const DOUBLE_CLICK_GUARD_MS = 320;
/**
 * Hold after threshold before drag arms. Explorer-like DragDetect needs both
 * distance and a brief settle so double-click navigation wins over drag.
 */
const DEFAULT_DRAG_DELAY_MS = 140;
const SELECTED_DRAG_DELAY_MS = 110;
/** Legacy defer slot — row onClick handles clicks directly (0 = instant). */
export const LIST_CLICK_DEFER_MS = 0;

/** Marquee arm distance once intent prefers marquee. */
export const MARQUEE_ARM_PX = 5;

type DragSession = {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  startedAt: number;
  delayMs: number;
  ready: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  /** Consecutive move samples past threshold (filters single-sample noise). */
  thresholdHits: number;
};

let marqueeActive = false;
let marqueeDragOccurred = false;
let lastPointerDownAt = 0;
let session: DragSession | null = null;
let dragThresholdMet = false;

let dragThresholdPx = DRAG_THRESHOLD_PX;
let dragThresholdHitsRequired = 2;

/** WinUI / WebView2 native shell — snappier arm like Explorer DragDetect. */
export function configureExplorerGradeDragThreshold(enabled: boolean) {
  dragThresholdPx = enabled ? NATIVE_DRAG_THRESHOLD_PX : DRAG_THRESHOLD_PX;
  dragThresholdHitsRequired = enabled ? 1 : 2;
}

export function hasMetDragThreshold() {
  return dragThresholdMet;
}

export function setMarqueeActive(active: boolean) {
  marqueeActive = active;
}

export function isMarqueeActive() {
  return marqueeActive;
}

/** Replace window._marqueeDragOccurred with a module flag. */
export function setMarqueeDragOccurred(v: boolean) {
  marqueeDragOccurred = v;
  try {
    (window as any)._marqueeDragOccurred = v;
  } catch { /* ignore */ }
}

export function consumeMarqueeDragOccurred(): boolean {
  const v = marqueeDragOccurred || !!(window as any)._marqueeDragOccurred;
  marqueeDragOccurred = false;
  try {
    (window as any)._marqueeDragOccurred = false;
  } catch { /* ignore */ }
  return v;
}

export function peekMarqueeDragOccurred(): boolean {
  return marqueeDragOccurred || !!(window as any)._marqueeDragOccurred;
}

export function markPointerDown() {
  lastPointerDownAt = Date.now();
}

export function isWithinDoubleClickGuard() {
  return Date.now() - lastPointerDownAt < DOUBLE_CLICK_GUARD_MS;
}

/**
 * Whether a new list press may arm a file-drag session.
 * Must be evaluated BEFORE markPointerDown() on the current press — otherwise
 * the freshly stamped timestamp always trips the double-click guard and drag
 * never arms (HTML5 draggable is also disabled on rows).
 */
export function canStartDragFromList(disallowDrag?: boolean): boolean {
  if (disallowDrag) return false;
  if (marqueeActive) return false;
  if (isWithinDoubleClickGuard()) return false;
  return true;
}

/**
 * Legacy helper retained for call sites / tests. Item presses never convert to
 * marquee anymore — marquee is empty-canvas only (see list pointer-down path).
 */
export function preferFileDragOverMarquee(_opts: {
  wasSelected: boolean;
  shiftKey: boolean;
  ctrlKey?: boolean;
  dx: number;
  dy: number;
}): boolean {
  return true;
}

export function beginDragSession(
  pointerId: number,
  clientX: number,
  clientY: number,
  delayMs = DEFAULT_DRAG_DELAY_MS,
) {
  clearDragSession();
  dragThresholdMet = false;
  session = {
    pointerId,
    startX: clientX,
    startY: clientY,
    moved: false,
    startedAt: Date.now(),
    delayMs,
    ready: delayMs <= 0,
    timer: null,
    thresholdHits: 0,
  };
  if (delayMs > 0) {
    session.timer = setTimeout(() => {
      if (session) session.ready = true;
    }, delayMs);
  }
}

export function trackDragPointer(clientX: number, clientY: number): boolean {
  if (!session) return false;
  const dx = Math.abs(clientX - session.startX);
  const dy = Math.abs(clientY - session.startY);
  if (dx > dragThresholdPx || dy > dragThresholdPx) {
    session.thresholdHits += 1;
    // Require consecutive samples past threshold to ignore single-sample jitter (web default).
    if (session.thresholdHits >= dragThresholdHitsRequired) {
      session.moved = true;
      dragThresholdMet = true;
    }
  } else {
    session.thresholdHits = 0;
  }
  return session.moved;
}

export function isDragSessionReady(): boolean {
  return !!session?.ready;
}

/** Block HTML5 drag until pointer movement exceeds threshold (Explorer-style). */
export function shouldAllowDragStart(disallowDrag?: boolean): boolean {
  if (!canStartDragFromList(disallowDrag)) return false;
  if (!dragThresholdMet) return false;
  if (!session?.ready) return false;
  return true;
}

export function clearDragSession() {
  if (session?.timer) clearTimeout(session.timer);
  session = null;
  dragThresholdMet = false;
}

export const DRAG_THRESHOLD = DRAG_THRESHOLD_PX;
export const DRAG_DELAY_DEFAULT = DEFAULT_DRAG_DELAY_MS;
export const DRAG_DELAY_SELECTED = SELECTED_DRAG_DELAY_MS;
