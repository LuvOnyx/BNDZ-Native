/**
 * Unified file-drag hover tracking for pointer sessions and native OLE drags.
 * WebView2 file surfaces use pointer + host OLE — not HTML5 DnD.
 */

import { isFsDropTargetPath } from './bndzVirtualViews';
import { normalizePanePath } from './pathUtils';
import {
  hitTestArchiveRootAtPoint,
  hitTestBreadcrumbAtPoint,
  hitTestListBodyAtPoint,
  hitTestNavTreeAtPoint,
  hitTestNewTabZoneAtPoint,
  hitTestTabAtPoint,
  type PaneTabSnapshot,
} from './fileDragSession';

export type FileDragHoverState = {
  navTreePath: string | null;
  breadcrumbPath: string | null;
  favoritePath: string | null;
  newTabPaneId: string | null;
  archivePath: string | null;
  htmlDropTarget: { paneId: string; tabPath: string } | null;
};

/** Last OLE drag-hover coords from WPF — used when drop coords are missing/invalid. */
export const recordExternalDragHover = {
  last: { clientX: 0, clientY: 0, valid: false as boolean },
};

export type DragHoverMemory = {
  clientX: number;
  clientY: number;
  valid: boolean;
  overList: boolean;
  navTreePath: string | null;
  breadcrumbPath: string | null;
  listFolderId: string | null;
};

const emptyDragHoverMemory = (): DragHoverMemory => ({
  clientX: 0,
  clientY: 0,
  valid: false,
  overList: false,
  navTreePath: null,
  breadcrumbPath: null,
  listFolderId: null,
});

/** Last in-app pointer-drag coords (archive / list) — mirrors external hover for drop commit. */
export const recordPointerDragHover = {
  last: emptyDragHoverMemory(),
};

export function setExternalDragHover(clientX: number, clientY: number) {
  recordExternalDragHover.last = { clientX, clientY, valid: true };
}

export function setPointerDragHover(
  clientX: number,
  clientY: number,
  overList: boolean,
  extras?: {
    navTreePath?: string | null;
    breadcrumbPath?: string | null;
    listFolderId?: string | null;
  },
) {
  recordPointerDragHover.last = {
    clientX,
    clientY,
    valid: true,
    overList,
    navTreePath: extras?.navTreePath ?? null,
    breadcrumbPath: extras?.breadcrumbPath ?? null,
    listFolderId: extras?.listFolderId ?? null,
  };
}

export function clearExternalDragHover() {
  recordExternalDragHover.last.valid = false;
}

export function clearPointerDragHover() {
  recordPointerDragHover.last = emptyDragHoverMemory();
}

/** WebView2 often poisons elementsFromPoint on pointer-up — recall last hover within slop. */
export function recallPointerDragHover(clientX: number, clientY: number, slopPx = 96): DragHoverMemory | null {
  const r = recordPointerDragHover.last;
  if (!r.valid) return null;
  if (Math.hypot(clientX - r.clientX, clientY - r.clientY) <= slopPx) return r;
  // Drop commit: trust last hover when pointer-up hit-test is poisoned but we were dragging recently.
  if (r.navTreePath || r.breadcrumbPath || r.listFolderId) return r;
  return null;
}

/** Resolve nav-tree drop path: live hit-test → live ref → recalled/sticky hover. */
export function resolveNavTreeDropPath(
  clientX: number,
  clientY: number,
  liveRef?: string | null,
): string | null {
  return hitTestNavTreeAtPoint(clientX, clientY)
    || liveRef
    || recallPointerDragHover(clientX, clientY)?.navTreePath
    || (recordPointerDragHover.last.valid ? recordPointerDragHover.last.navTreePath : null);
}

/** Resolve breadcrumb drop path with the same poisoned pointer-up fallbacks. */
export function resolveBreadcrumbDropPath(
  clientX: number,
  clientY: number,
  liveRef?: string | null,
): string | null {
  return hitTestBreadcrumbAtPoint(clientX, clientY)
    || liveRef
    || recallPointerDragHover(clientX, clientY)?.breadcrumbPath
    || (recordPointerDragHover.last.valid ? recordPointerDragHover.last.breadcrumbPath : null);
}

export function resolveFileDragHoverAtPoint(
  clientX: number,
  clientY: number,
  panes: PaneTabSnapshot[],
): FileDragHoverState {
  const archiveEl = hitTestArchiveRootAtPoint(clientX, clientY);
  const archivePath = archiveEl?.getAttribute('data-archive-path') || null;

  const navTreePath = resolveNavTreeDropPath(clientX, clientY);
  const breadcrumbPath = navTreePath ? null : resolveBreadcrumbDropPath(clientX, clientY);
  const newTabPaneId = hitTestNewTabZoneAtPoint(clientX, clientY);

  const favoriteEl = document.elementsFromPoint(clientX, clientY)
    .map(el => (el as HTMLElement).closest('[data-favorite-path]'))
    .find(Boolean) as HTMLElement | null;
  const favoritePath = favoriteEl?.getAttribute('data-favorite-path') || null;

  let htmlDropTarget: { paneId: string; tabPath: string } | null = null;
  const listBody = hitTestListBodyAtPoint(clientX, clientY);
  if (listBody) {
    const paneId = listBody.getAttribute('data-list-pane-id');
    const pane = paneId ? panes.find(p => p.id === paneId) : null;
    if (pane) {
      const tabHit = hitTestTabAtPoint(clientX, clientY);
      let tabIndex = pane.activeTabIndex;
      if (tabHit?.paneId === paneId && tabHit.tabIndex >= 0) tabIndex = tabHit.tabIndex;
      const tabPath = normalizePanePath(pane.tabs[tabIndex]?.path || '/');
      if (isFsDropTargetPath(tabPath)) {
        htmlDropTarget = { paneId: pane.id, tabPath };
      }
    }
  }

  return {
    navTreePath,
    breadcrumbPath,
    favoritePath,
    newTabPaneId,
    archivePath,
    htmlDropTarget,
  };
}
