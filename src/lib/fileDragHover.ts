/**
 * Unified file-drag hover tracking for pointer sessions and native OLE drags.
 * WebView2 file surfaces use pointer + host OLE — not HTML5 DnD.
 */

import { isBndzVirtualPath } from './bndzVirtualViews';
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

/** Last in-app pointer-drag coords (archive / list) — mirrors external hover for drop commit. */
export const recordPointerDragHover = {
  last: { clientX: 0, clientY: 0, valid: false as boolean, overList: false as boolean },
};

export function setExternalDragHover(clientX: number, clientY: number) {
  recordExternalDragHover.last = { clientX, clientY, valid: true };
}

export function setPointerDragHover(clientX: number, clientY: number, overList: boolean) {
  recordPointerDragHover.last = { clientX, clientY, valid: true, overList };
}

export function clearExternalDragHover() {
  recordExternalDragHover.last.valid = false;
}

export function clearPointerDragHover() {
  recordPointerDragHover.last.valid = false;
  recordPointerDragHover.last.overList = false;
}

export function resolveFileDragHoverAtPoint(
  clientX: number,
  clientY: number,
  panes: PaneTabSnapshot[],
): FileDragHoverState {
  const archiveEl = hitTestArchiveRootAtPoint(clientX, clientY);
  const archivePath = archiveEl?.getAttribute('data-archive-path') || null;

  const navTreePath = hitTestNavTreeAtPoint(clientX, clientY);
  const breadcrumbPath = navTreePath ? null : hitTestBreadcrumbAtPoint(clientX, clientY);
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
      if (!isBndzVirtualPath(tabPath) && tabPath !== '/' && tabPath !== '/this-pc') {
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
