/**
 * Shared drag / marquee interaction guard — prevents accidental drags during
 * double-clicks, marquee selection, and enforces movement threshold.
 */

/** Movement before a list drag can arm — high enough that marquee can win first. */
const DRAG_THRESHOLD_PX = 12;
const DOUBLE_CLICK_GUARD_MS = 280;
/** Hold time before drag can start after threshold is met. */
const DEFAULT_DRAG_DELAY_MS = 70;
/** Slightly faster arm when dragging an already-selected item. */
const SELECTED_DRAG_DELAY_MS = 45;
/** Defer synthetic click so native dblclick can win. */
export const LIST_CLICK_DEFER_MS = 50;

type DragSession = {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  startedAt: number;
  delayMs: number;
  ready: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

let marqueeActive = false;
let lastPointerDownAt = 0;
let session: DragSession | null = null;
let dragThresholdMet = false;

export function hasMetDragThreshold() {
  return dragThresholdMet;
}

export function setMarqueeActive(active: boolean) {
  marqueeActive = active;
}

export function isMarqueeActive() {
  return marqueeActive;
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
 * Prefer file drag vs converting a select-cell pending gesture into marquee.
 * Vertical-dominant sweeps always marquee (range select). Shift always marquee.
 * Ctrl prefers copy-drag. Already-selected rows prefer drag unless vertical.
 */
export function preferFileDragOverMarquee(opts: {
  wasSelected: boolean;
  shiftKey: boolean;
  ctrlKey?: boolean;
  dx: number;
  dy: number;
}): boolean {
  if (opts.shiftKey) return false;
  const verticalMarquee = opts.dy > 10 && opts.dy > opts.dx * 1.15;
  if (verticalMarquee) return false;
  if (opts.ctrlKey) return true;
  const horizontalMarquee = opts.dx > 14 && opts.dx > opts.dy * 1.55;
  if (horizontalMarquee && !opts.wasSelected) return false;
  if (opts.wasSelected) return true;
  return !horizontalMarquee;
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
  if (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX) {
    session.moved = true;
    dragThresholdMet = true;
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
