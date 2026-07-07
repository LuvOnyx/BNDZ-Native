import { useEffect, useRef } from 'react';

export const CONTEXT_MENU_TREE_SELECTOR =
  '[data-bndz-context-menu], [data-bndz-submenu-flyout], [data-bndz-tab-context-menu]';

export function isInsideMenuTree(target: EventTarget | null): boolean {
  const el = target as Element | null;
  return !!el?.closest?.(CONTEXT_MENU_TREE_SELECTOR);
}

type PointRoot = { elementFromPoint(x: number, y: number): Element | null };

/** Hit-test menu tree at viewport coordinates (works across portaled flyouts). */
export function isPointerInsideMenuTree(x: number, y: number, root: PointRoot = document): boolean {
  const el = root.elementFromPoint(x, y);
  return isInsideMenuTree(el);
}

/**
 * Close a context menu when the pointer leaves the menu tree (main panel + portaled flyouts).
 * Uses elementFromPoint so geometry is authoritative; onClose is stored in a ref so parent
 * re-renders do not reset the dismiss timer.
 */
export function useContextMenuDismissOnLeave(active: boolean, onClose: () => void, graceMs = 180) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;

    let closeTimer: ReturnType<typeof setTimeout> | null = null;
    let armed = false;

    const clearTimer = () => {
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
    };

    const scheduleClose = () => {
      if (!armed) return;
      clearTimer();
      closeTimer = setTimeout(() => onCloseRef.current(), graceMs);
    };

    const syncPointer = (x: number, y: number) => {
      if (!armed) return;
      if (isPointerInsideMenuTree(x, y)) {
        clearTimer();
        return;
      }
      scheduleClose();
    };

    let lastX = 0;
    let lastY = 0;

    const onPointerMove = (e: PointerEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
      syncPointer(e.clientX, e.clientY);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!armed) return;
      if (isPointerInsideMenuTree(e.clientX, e.clientY)) {
        clearTimer();
        return;
      }
      onCloseRef.current();
    };

    const onBlur = () => scheduleClose();

    const armTimer = setTimeout(() => {
      armed = true;
      syncPointer(lastX, lastY);
    }, 120);

    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', onBlur);

    return () => {
      clearTimeout(armTimer);
      clearTimer();
      armed = false;
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [active, graceMs]);
}
