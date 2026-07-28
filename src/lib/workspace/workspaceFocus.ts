/** Returns true when focus is in a text-editing control. */
export function isWorkspaceTextInputFocused(): boolean {
  const ae = document.activeElement as HTMLElement | null;
  if (!ae) return false;
  const tag = ae.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return !!ae.isContentEditable;
}

/** Workspace surface is visible and in the active pane (not hidden by another tab layout). */
export function isWorkspaceSurfaceLive(surface: HTMLElement | null): boolean {
  if (!surface) return false;
  if (surface.offsetParent === null) return false;
  const rect = surface.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const pane = surface.closest('[data-list-pane-id]');
  if (pane && pane.getBoundingClientRect().width < 2) return false;
  return true;
}

/** Keyboard shortcuts may run when the workspace tab is showing and no text field is focused. */
export function shouldHandleWorkspaceKeys(surface: HTMLElement | null): boolean {
  if (!isWorkspaceSurfaceLive(surface)) return false;
  if (isWorkspaceTextInputFocused()) return false;
  return true;
}

export function focusWorkspaceSurface(surface: HTMLElement | null): void {
  if (!surface || !isWorkspaceSurfaceLive(surface)) return;
  if (document.activeElement !== surface) {
    surface.focus({ preventScroll: true });
  }
}

/**
 * Isolate list-pane marquee from workspace without pointer-events:none (which breaks hit-testing).
 * Call from list body pointerdown capture — returns true when the event target is inside a workspace.
 */
export function isWorkspacePointerTarget(target: EventTarget | null): boolean {
  return !!(target as Element)?.closest?.(
    '[data-bndz-workspace-surface], [data-bndz-workspace-menu], .react-flow__pane',
  );
}
