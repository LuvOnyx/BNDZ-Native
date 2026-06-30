/**
 * Shared drag / marquee interaction guard — prevents accidental drags during
 * double-clicks, marquee selection, and enforces movement threshold.
 */

const DRAG_THRESHOLD_PX = 8;
const DOUBLE_CLICK_GUARD_MS = 400;
const DEFAULT_DRAG_DELAY_MS = 0;

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

export function beginDragSession(
  pointerId: number,
  clientX: number,
  clientY: number,
  delayMs = DEFAULT_DRAG_DELAY_MS,
) {
  clearDragSession();
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
  }
  return session.moved;
}

export function isDragSessionReady(): boolean {
  return !!session?.ready;
}

export function shouldAllowDragStart(disallowDrag?: boolean): boolean {
  if (!canStartDragFromList(disallowDrag)) return false;
  if (!session) return false;
  if (!session.ready) return false;
  if (!session.moved) return false;
  return true;
}

export function clearDragSession() {
  if (session?.timer) clearTimeout(session.timer);
  session = null;
}

export const DRAG_THRESHOLD = DRAG_THRESHOLD_PX;
