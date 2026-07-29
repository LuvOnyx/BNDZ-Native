/** Panel resize handles keep their own cursor; workspace surfaces reset chrome drag cursors. */
const RESIZE_HANDLE_SELECTOR =
  '.bndz-resize-handle, [data-separator="active"], .bndz-col-resize-handle, [data-panel-resize-handle]';

const SPATIAL_BOARD_SELECTOR = '[data-spatial-board], .bndz-spatial-board';

export function clearChromeDragCursor(): void {
  document.body.style.removeProperty('cursor');
  document.documentElement.style.removeProperty('cursor');
}

function isResizeHandleTarget(target: EventTarget | null): boolean {
  return !!(target as Element)?.closest?.(RESIZE_HANDLE_SELECTOR);
}

function isSpatialBoardTarget(target: EventTarget | null): boolean {
  return !!(target as Element)?.closest?.(SPATIAL_BOARD_SELECTOR);
}

function forceDefaultCursor(target: EventTarget | null) {
  if (isResizeHandleTarget(target)) return;
  clearChromeDragCursor();
  const el = target as HTMLElement | null;
  if (el && isSpatialBoardTarget(el)) {
    el.style.cursor = 'default';
  }
}

/** Drop resize / panel-drag cursors when entering a workspace surface (spatial, automation, etc.). */
export function bindWorkspaceCursorGuard(surface: HTMLElement): () => void {
  const forceWorkspaceCursor = (target: EventTarget | null) => {
    if (!surface.contains(target as Node)) return;
    forceDefaultCursor(target);
    if (!isResizeHandleTarget(target)) {
      surface.style.cursor = 'default';
    }
  };

  const onEnter = (e: Event) => forceWorkspaceCursor(e.target);
  const onMove = (e: PointerEvent) => forceWorkspaceCursor(e.target);
  const onGlobalEnd = () => clearChromeDragCursor();

  surface.addEventListener('pointerenter', onEnter);
  surface.addEventListener('pointerover', onEnter, true);
  surface.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onGlobalEnd, true);
  window.addEventListener('pointercancel', onGlobalEnd, true);

  return () => {
    surface.removeEventListener('pointerenter', onEnter);
    surface.removeEventListener('pointerover', onEnter, true);
    surface.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onGlobalEnd, true);
    window.removeEventListener('pointercancel', onGlobalEnd, true);
  };
}

/**
 * Global guard: when the pointer is over spatial canvas empty space, strip col-resize
 * bleed from panel separators that leaked onto body / hit targets.
 */
export function bindGlobalSpatialCursorGuard(): () => void {
  const onMove = (e: PointerEvent) => {
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    if (!hit) return;
    if (!isSpatialBoardTarget(hit)) return;
    if (isResizeHandleTarget(hit)) return;
    clearChromeDragCursor();
    const board = (hit as Element).closest(SPATIAL_BOARD_SELECTOR) as HTMLElement | null;
    if (board) board.style.cursor = 'default';
  };
  const onEnd = () => clearChromeDragCursor();
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onEnd, true);
  window.addEventListener('pointercancel', onEnd, true);
  window.addEventListener('blur', onEnd);
  return () => {
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onEnd, true);
    window.removeEventListener('pointercancel', onEnd, true);
    window.removeEventListener('blur', onEnd);
  };
}

/** App-wide: panel resize drags often leave col-resize on body after pointer-up. */
export function bindGlobalChromeCursorReset(): () => void {
  const onEnd = () => clearChromeDragCursor();
  window.addEventListener('pointerup', onEnd, true);
  window.addEventListener('pointercancel', onEnd, true);
  window.addEventListener('blur', onEnd);
  return () => {
    window.removeEventListener('pointerup', onEnd, true);
    window.removeEventListener('pointercancel', onEnd, true);
    window.removeEventListener('blur', onEnd);
  };
}
