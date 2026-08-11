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
 * Close a context menu on outside pointer-down or Escape.
 * Do NOT close on window blur — WebView2 / WinUI non-client hit-testing fires
 * spurious blur on right-click and instantly kills tab / list menus.
 */
export function useContextMenuDismissOnLeave(active: boolean, onClose: () => void, _graceMs = 180) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;

    let armed = false;

    const onPointerDown = (e: PointerEvent) => {
      if (!armed) return;
      if (isPointerInsideMenuTree(e.clientX, e.clientY)) return;
      onCloseRef.current();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };

    // Arm after the opening gesture's pointer cycle so we don't instantly dismiss.
    const armTimer = setTimeout(() => { armed = true; }, 80);

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      clearTimeout(armTimer);
      armed = false;
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [active]);
}
