/**
 * Shared drag / marquee interaction guard — prevents accidental drags during
 * double-clicks, marquee selection, and enforces movement threshold.
 */

/** Movement before a list drag can arm (Explorer-like — reduces accidental drags). */
const DRAG_THRESHOLD_PX = 14;
const DOUBLE_CLICK_GUARD_MS = 400;
/** Hold time before drag can start after threshold is met. */
const DEFAULT_DRAG_DELAY_MS = 120;
/** Faster arm when dragging an already-selected item (Explorer-like). */
const SELECTED_DRAG_DELAY_MS = 40;

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

export function canStartDragFromList(disallowDrag?: boolean): boolean {
  if (disallowDrag) return false;
  if (marqueeActive) return false;
  if (isWithinDoubleClickGuard()) return false;
  return true;
}

/**
 * Prefer file drag over stealing into marquee from a select-cell pending gesture.
 * Shift always allows marquee. Already-selected rows never lose to horizontal flicks.
 */
export function preferFileDragOverMarquee(opts: {
  wasSelected: boolean;
  shiftKey: boolean;
  dx: number;
  dy: number;
}): boolean {
  if (opts.shiftKey) return false;
  if (opts.wasSelected) return true;
  // Unselected: clear sideways intent → marquee; otherwise prefer drag.
  const horizontalMarquee = opts.dx > 8 && opts.dx > opts.dy * 1.35;
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
