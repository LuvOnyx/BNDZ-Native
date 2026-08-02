/** Panel resize handles keep their own cursor; workspace surfaces reset chrome drag cursors. */
const RESIZE_HANDLE_SELECTOR =
  '.bndz-resize-handle, [data-separator], [data-separator="active"], .bndz-col-resize-handle, [data-panel-resize-handle], .cursor-col-resize, .cursor-row-resize';

const SPATIAL_BOARD_SELECTOR = '[data-spatial-board], .bndz-spatial-board';

export function clearChromeDragCursor(): void {
  document.body.style.removeProperty('cursor');
  document.documentElement.style.removeProperty('cursor');
  // WebView2 often keeps the last CSS hover cursor (col-resize from splitters).
  // Force a recompute by briefly assigning default then clearing.
  try {
    document.documentElement.style.setProperty('cursor', 'default', 'important');
    document.body.style.setProperty('cursor', 'default', 'important');
    requestAnimationFrame(() => {
      document.body.style.removeProperty('cursor');
      document.documentElement.style.removeProperty('cursor');
    });
  } catch { /* ignore */ }
}

/** Call when entering / leaving workspace tools so splitter cursors cannot leak. */
export function resetWorkspacePointerChrome(): void {
  clearChromeDragCursor();
}

function isResizeHandleTarget(target: EventTarget | null): boolean {
  const el = target as Element | null;
  if (!el?.closest) return false;
  // Only treat actual separators as resize targets — not every element that
  // happens to sit under a transient body cursor style.
  return !!(
    el.closest('.bndz-resize-handle')
    || el.closest('[data-separator]')
    || el.closest('[data-panel-resize-handle]')
    || el.closest('.bndz-col-resize-handle')
  );
}

function isSpatialBoardTarget(target: EventTarget | null): boolean {
  return !!(target as Element)?.closest?.(SPATIAL_BOARD_SELECTOR);
}

/** Drop resize / panel-drag cursors when entering a workspace surface (spatial, automation, etc.). */
export function bindWorkspaceCursorGuard(surface: HTMLElement): () => void {
  const forceWorkspaceCursor = (clientX: number, clientY: number) => {
    const hit = document.elementFromPoint(clientX, clientY);
    if (!hit) return;
    if (!surface.contains(hit)) return;
    if (isResizeHandleTarget(hit)) return;
    clearChromeDragCursor();
    surface.style.cursor = 'default';
    if (isSpatialBoardTarget(hit)) {
      const board = (hit as Element).closest(SPATIAL_BOARD_SELECTOR) as HTMLElement | null;
      if (board) board.style.cursor = 'default';
    }
  };

  const onMove = (e: PointerEvent) => forceWorkspaceCursor(e.clientX, e.clientY);
  const onGlobalEnd = () => clearChromeDragCursor();

  surface.addEventListener('pointerenter', onMove);
  surface.addEventListener('pointerover', onMove, true);
  surface.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onGlobalEnd, true);
  window.addEventListener('pointercancel', onGlobalEnd, true);

  return () => {
    surface.removeEventListener('pointerenter', onMove);
    surface.removeEventListener('pointerover', onMove, true);
    surface.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onGlobalEnd, true);
    window.removeEventListener('pointercancel', onGlobalEnd, true);
  };
}

/**
 * Global guard: when the pointer is over any non-separator UI, strip col-resize
 * bleed from panel separators (file list, Spatial, automation, etc.).
 */
export function bindGlobalSpatialCursorGuard(): () => void {
  const onMove = (e: PointerEvent) => {
    // While actively resizing (buttons down on separator), leave cursor alone.
    if (e.buttons !== 0) {
      const hitWhileDown = document.elementFromPoint(e.clientX, e.clientY);
      if (isResizeHandleTarget(hitWhileDown) || isResizeHandleTarget(e.target)) return;
    }
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    if (!hit) return;
    if (isResizeHandleTarget(hit)) return;
    clearChromeDragCursor();
    if (isSpatialBoardTarget(hit)) {
      const board = (hit as Element).closest(SPATIAL_BOARD_SELECTOR) as HTMLElement | null;
      if (board) board.style.cursor = 'default';
    }
  };
  const onEnd = () => {
    clearChromeDragCursor();
    // After separator release, force one more pass under the pointer.
    requestAnimationFrame(() => {
      const x = (window as Window & { __bndzLastPtrX?: number }).__bndzLastPtrX ?? window.innerWidth / 2;
      const y = (window as Window & { __bndzLastPtrY?: number }).__bndzLastPtrY ?? window.innerHeight / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit && !isResizeHandleTarget(hit)) clearChromeDragCursor();
    });
  };
  const track = (e: PointerEvent) => {
    (window as Window & { __bndzLastPtrX?: number }).__bndzLastPtrX = e.clientX;
    (window as Window & { __bndzLastPtrY?: number }).__bndzLastPtrY = e.clientY;
    onMove(e);
  };
  window.addEventListener('pointermove', track, true);
  window.addEventListener('pointerup', onEnd, true);
  window.addEventListener('pointercancel', onEnd, true);
  window.addEventListener('blur', onEnd);
  return () => {
    window.removeEventListener('pointermove', track, true);
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
