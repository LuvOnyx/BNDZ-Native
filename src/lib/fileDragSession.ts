/**
 * Unified file-drag hit-testing helpers.
 * Used by BNDZUI pointer-drag session to resolve tabs, breadcrumbs, list folders, and nav tree targets.
 */

import { isFsDropTargetPath } from './bndzVirtualViews';
import { joinPanePath } from './pathUtils';

export type TabHoverTarget = { paneId: string; tabIndex: number; tabId: string };
export type ListFolderTarget = { id: string; type?: string; name?: string };

function elementsAtPoint(clientX: number, clientY: number): Element[] {
  if (typeof document.elementsFromPoint === 'function') {
    return document.elementsFromPoint(clientX, clientY);
  }
  const hit = document.elementFromPoint(clientX, clientY);
  return hit ? [hit] : [];
}

/** Walk the hit stack for the first element matching a selector (or closest). */
export function hitTestClosestAtPoint(
  clientX: number,
  clientY: number,
  selector: string,
  probes?: Array<[number, number]>,
): HTMLElement | null {
  const points = probes ?? [
    [clientX, clientY],
    [clientX, clientY - 6],
    [clientX, clientY + 6],
    [clientX - 8, clientY],
    [clientX + 8, clientY],
  ];
  for (const [x, y] of points) {
    for (const el of elementsAtPoint(x, y)) {
      const match = el.closest(selector) as HTMLElement | null;
      if (match) return match;
    }
  }
  return null;
}

function resolveTabFromElement(tabEl: HTMLElement | null): TabHoverTarget | null {
  if (!tabEl) return null;
  const tabId = tabEl.getAttribute('data-tab-id');
  if (!tabId) return null;
  const paneEl = tabEl.closest('[data-pane-id]') as HTMLElement | null;
  const paneId = paneEl?.getAttribute('data-pane-id') || '';
  const tabIndex = parseInt(tabEl.getAttribute('data-tab-index') || '-1', 10);
  if (!paneId || tabIndex < 0) return null;
  return { paneId, tabIndex, tabId };
}

/** Rect hit-test fallback when WebView2 hit stacks omit tab chrome under pointer capture. */
function hitTestTabByRect(clientX: number, clientY: number): TabHoverTarget | null {
  const probes: Array<[number, number]> = [
    [clientX, clientY],
    [clientX, clientY - 6],
    [clientX, clientY + 6],
    [clientX - 8, clientY],
    [clientX + 8, clientY],
  ];
  const tabs = document.querySelectorAll<HTMLElement>('.bndz-chrome-tabstrip [data-tab-id]');
  for (const [x, y] of probes) {
    for (const tabEl of tabs) {
      const rect = tabEl.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        const hit = resolveTabFromElement(tabEl);
        if (hit) return hit;
      }
    }
  }
  return null;
}

/** Hit-test a tab strip row at screen coordinates (tolerant of small gaps / icon-only hits). */
export function hitTestTabAtPoint(clientX: number, clientY: number): TabHoverTarget | null {
  // Rect first — WebView2 pointer capture poisons elementsFromPoint for tab chrome.
  const fromRect = hitTestTabByRect(clientX, clientY);
  if (fromRect) return fromRect;
  const tabEl = hitTestClosestAtPoint(clientX, clientY, '[data-tab-id]');
  return resolveTabFromElement(tabEl);
}

/** Hit-test the "+" new-tab drop zone. Returns pane id or null. */
export function hitTestNewTabZoneAtPoint(clientX: number, clientY: number): string | null {
  const el = hitTestClosestAtPoint(clientX, clientY, '[data-new-tab-zone]');
  return el?.getAttribute('data-new-tab-zone') || null;
}

/** Hit-test a breadcrumb segment; returns normalized path or null. */
export function hitTestBreadcrumbAtPoint(clientX: number, clientY: number): string | null {
  const crumbEl = hitTestClosestAtPoint(clientX, clientY, '[data-breadcrumb-path]')
    ?? hitTestSelectorByRect(clientX, clientY, '[data-breadcrumb-path]');
  return crumbEl?.getAttribute('data-breadcrumb-path') || null;
}

/** Hit-test a nav-tree folder row; returns folder path or null. */
export function hitTestNavTreeAtPoint(clientX: number, clientY: number): string | null {
  const row = hitTestClosestAtPoint(clientX, clientY, '[data-nav-path]')
    ?? hitTestSelectorByRect(clientX, clientY, '[data-nav-path]');
  return row?.getAttribute('data-nav-path') || null;
}

const HIT_PROBES = (clientX: number, clientY: number): Array<[number, number]> => [
  [clientX, clientY],
  [clientX, clientY - 6],
  [clientX, clientY + 6],
  [clientX - 8, clientY],
  [clientX + 8, clientY],
];

/** Rect hit-test when WebView2 poisons elementsFromPoint during pointer drags. */
function hitTestSelectorByRect(
  clientX: number,
  clientY: number,
  selector: string,
): HTMLElement | null {
  const probes = HIT_PROBES(clientX, clientY);
  const nodes = document.querySelectorAll<HTMLElement>(selector);
  for (const [x, y] of probes) {
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return node;
      }
    }
  }
  return null;
}

/** True when pointer is over any list body (active or inactive pane). */
export function hitTestListBodyAtPoint(clientX: number, clientY: number): HTMLElement | null {
  return hitTestClosestAtPoint(clientX, clientY, '[data-list-body]')
    ?? hitTestSelectorByRect(clientX, clientY, '[data-list-body]');
}

/** Spatial Canvas / Automation — drops here must not fall through to the file list. */
export function hitTestWorkspaceSurfaceAtPoint(clientX: number, clientY: number): HTMLElement | null {
  return hitTestClosestAtPoint(clientX, clientY, '[data-bndz-workspace-surface]')
    ?? hitTestSelectorByRect(clientX, clientY, '[data-bndz-workspace-surface]');
}

/** Hit-test a list folder row during internal drag. */
export function hitTestListFolderAtPoint<T extends ListFolderTarget>(
  clientX: number,
  clientY: number,
  contents: T[] | undefined,
): T | null {
  const dropRow = hitTestClosestAtPoint(clientX, clientY, '.fs-item-wrapper')
    ?? hitTestSelectorByRect(clientX, clientY, '.fs-item-wrapper');
  const dropId = dropRow?.getAttribute('data-id');
  if (!dropId) return null;
  // Miller items carry a full pane path — prefer that when present.
  const millerPath = dropRow?.getAttribute('data-miller-path');
  const isDirAttr = dropRow?.getAttribute('data-is-dir');
  if (millerPath && isDirAttr === 'true') {
    const ent = contents?.find(c => c.id === dropId);
    if (ent?.type === 'directory') return ent;
    // Contents may be for a different column — return a synthetic folder target.
    return { id: dropId, type: 'directory', name: millerPath.split('/').pop() || millerPath } as T;
  }
  const dropEnt = contents?.find(c => c.id === dropId);
  if (dropEnt?.type === 'directory') return dropEnt;
  return null;
}

/**
 * Absolute drop destination for Columns (Miller) view.
 * Folder item → that folder’s path; empty column chrome → that column’s folder.
 */
export function hitTestMillerDropPathAtPoint(clientX: number, clientY: number): string | null {
  const item = hitTestClosestAtPoint(clientX, clientY, '[data-miller-path][data-is-dir="true"]')
    ?? hitTestSelectorByRect(clientX, clientY, '[data-miller-path][data-is-dir="true"]');
  const itemPath = item?.getAttribute('data-miller-path');
  if (itemPath) return itemPath;

  const col = hitTestClosestAtPoint(clientX, clientY, '[data-miller-col-path]')
    ?? hitTestSelectorByRect(clientX, clientY, '[data-miller-col-path]');
  return col?.getAttribute('data-miller-col-path') || null;
}

export type FileDragSessionState = {
  paths: string[];
  op: 'copy' | 'move';
  sourcePaneId: string;
  sourceTabPath: string;
};

let activeSession: FileDragSessionState | null = null;
/** Survives pointer-up while native OLE DoDragDrop runs, so drop-back keeps move intent. */
let pendingOleSession: FileDragSessionState | null = null;

export function beginFileDragSession(state: FileDragSessionState) {
  activeSession = state;
  pendingOleSession = null;
  try {
    window.dispatchEvent(new CustomEvent('bndz-pointer-file-drag-active', { detail: { active: true } }));
  } catch { /* ignore */ }
}

export function getFileDragSession(): FileDragSessionState | null {
  return activeSession ?? pendingOleSession;
}

export function endFileDragSession() {
  activeSession = null;
  // Keep pendingOleSession — OLE DoDragDrop may still complete after pointer-up.
  try {
    window.dispatchEvent(new CustomEvent('bndz-pointer-file-drag-active', { detail: { active: false } }));
  } catch { /* ignore */ }
}

/** Call when escalating an in-app drag to native OLE so move/copy intent survives the drop. */
export function stashOleDragSession(state?: FileDragSessionState | null) {
  const s = state ?? activeSession;
  const stashed = s ? { ...s, paths: [...s.paths] } : null;
  pendingOleSession = stashed;
  if (stashed) {
    window.setTimeout(() => {
      // Stale OLE stash must not poison later Explorer→BNDZ drops.
      if (pendingOleSession === stashed) pendingOleSession = null;
    }, 60_000);
  }
}

/** Read and clear OLE/in-app session for an EXTERNAL_FILES_DROPPED that originated from BNDZ. */
export function consumeOleDragSession(): FileDragSessionState | null {
  const s = pendingOleSession ?? activeSession;
  pendingOleSession = null;
  activeSession = null;
  return s;
}

const INTERNAL_DRAG_CHROME_SELECTORS = [
  '[data-pane-id]',
  '[data-tab-id]',
  '[data-tabstrip]',
  '[data-new-tab-zone]',
  '[data-breadcrumb-path]',
  '[data-nav-path]',
  '[data-list-body]',
  '[data-bndz-workspace-surface]',
  '[data-mesh-drop-inbox]',
  '[data-drop-stack-zone]',
  '.fs-list-header',
  '.bndz-chrome-tabstrip',
  '.bndz-chrome-toolbar',
  '.bndz-chrome-omnibar',
  '.bndz-chrome-sidebar',
  '.bndz-chrome-menubar',
  '.bndz-chrome-workspace',
  '.bndz-chrome-bottom',
  '.bndz-chrome-preview',
  '.bndz-chrome-statusbar',
  '.bndz-archive-root',
  '.sidebar-pin-row',
];

/**
 * Selectors used only for OLE edge-band veto. Full-bleed workspace/pane wrappers are
 * excluded — they cover the entire viewport including the 10px edge and blocked escalate.
 */
const OLE_EDGE_CHROME_SELECTORS = [
  '[data-tab-id]',
  '[data-tabstrip]',
  '[data-new-tab-zone]',
  '[data-breadcrumb-path]',
  '[data-nav-path]',
  '[data-list-body]',
  '[data-mesh-drop-inbox]',
  '[data-drop-stack-zone]',
  '.fs-list-header',
  '.bndz-chrome-tabstrip',
  '.bndz-chrome-toolbar',
  '.bndz-chrome-omnibar',
  '.bndz-chrome-sidebar',
  '.bndz-chrome-menubar',
  '.bndz-chrome-bottom',
  '.bndz-chrome-preview',
  '.bndz-chrome-statusbar',
  '.bndz-archive-root',
  '.sidebar-pin-row',
  '[data-bndz-workspace-surface]',
];

/** Archive preview surface at pointer (for drag-out / drop-in routing). */
export function hitTestArchiveRootAtPoint(clientX: number, clientY: number): HTMLElement | null {
  return hitTestClosestAtPoint(clientX, clientY, '.bndz-archive-root[data-archive-path]')
    ?? hitTestSelectorByRect(clientX, clientY, '.bndz-archive-root[data-archive-path]');
}

/** True when pointer left the archive preview (OLE drag-out to Explorer/desktop). */
export function isOutsideArchivePreviewAtPoint(clientX: number, clientY: number): boolean {
  return !hitTestArchiveRootAtPoint(clientX, clientY);
}

/** True when the pointer is over in-app chrome that accepts internal file drops (not desktop OLE). */
export function isInternalFileDragChromeAtPoint(clientX: number, clientY: number): boolean {
  for (const el of elementsAtPoint(clientX, clientY)) {
    for (const selector of INTERNAL_DRAG_CHROME_SELECTORS) {
      if (el.closest(selector)) return true;
    }
  }
  // Rect fallbacks — WebView2 pointer drags often return empty/poisoned hit stacks.
  if (hitTestTabByRect(clientX, clientY)) return true;
  if (hitTestListBodyAtPoint(clientX, clientY)) return true;
  if (hitTestSelectorByRect(clientX, clientY, '[data-nav-path]')) return true;
  if (hitTestSelectorByRect(clientX, clientY, '[data-breadcrumb-path]')) return true;
  if (hitTestSelectorByRect(clientX, clientY, '.bndz-archive-root')) return true;
  if (hitTestSelectorByRect(clientX, clientY, '.bndz-chrome-sidebar')) return true;
  if (hitTestSelectorByRect(clientX, clientY, '[data-tabstrip]')) return true;
  return false;
}

/** Narrow chrome check for OLE edge escalate (excludes full-bleed workspace wrappers). */
export function isOleEdgeChromeAtPoint(clientX: number, clientY: number): boolean {
  for (const el of elementsAtPoint(clientX, clientY)) {
    for (const selector of OLE_EDGE_CHROME_SELECTORS) {
      if (el.closest(selector)) return true;
    }
  }
  if (hitTestTabByRect(clientX, clientY)) return true;
  if (hitTestListBodyAtPoint(clientX, clientY)) return true;
  if (hitTestSelectorByRect(clientX, clientY, '[data-nav-path]')) return true;
  if (hitTestSelectorByRect(clientX, clientY, '[data-breadcrumb-path]')) return true;
  if (hitTestSelectorByRect(clientX, clientY, '.bndz-archive-root')) return true;
  if (hitTestSelectorByRect(clientX, clientY, '.bndz-chrome-sidebar')) return true;
  if (hitTestSelectorByRect(clientX, clientY, '[data-tabstrip]')) return true;
  return false;
}

/** True when the pointer left the WebView CSS viewport (desktop / other apps) — OLE escalate. */
export function isPointerOutsideWebViewViewport(clientX: number, clientY: number, marginPx = 8): boolean {
  const w = typeof window !== 'undefined' ? window.innerWidth : 0;
  const h = typeof window !== 'undefined' ? window.innerHeight : 0;
  return clientX < -marginPx || clientY < -marginPx || clientX > w + marginPx || clientY > h + marginPx;
}

/** WebView2 clamps client coords — desktop drags usually hit the viewport edge first. */
export function isPointerNearWebViewViewportEdge(clientX: number, clientY: number, edgePx = 10): boolean {
  const w = typeof window !== 'undefined' ? window.innerWidth : 0;
  const h = typeof window !== 'undefined' ? window.innerHeight : 0;
  if (w <= 0 || h <= 0) return false;
  return clientX <= edgePx || clientY <= edgePx || clientX >= w - edgePx || clientY >= h - edgePx;
}

/**
 * Side/bottom viewport rim only — never the top band (React menubar lives there).
 * Top exit must use screen-space leave (isPointerOutsideScreenWindow) so OLE does not
 * start DoDragDrop while the cursor is still over the menubar / WinUI caption.
 */
export function isPointerNearWebViewSideOrBottomEdge(clientX: number, clientY: number, edgePx = 10): boolean {
  const w = typeof window !== 'undefined' ? window.innerWidth : 0;
  const h = typeof window !== 'undefined' ? window.innerHeight : 0;
  if (w <= 0 || h <= 0) return false;
  return clientX <= edgePx || clientX >= w - edgePx || clientY >= h - edgePx;
}

export function isPointerOverMenubar(clientX: number, clientY: number): boolean {
  if (typeof document === 'undefined') return false;
  for (const el of elementsAtPoint(clientX, clientY)) {
    if (el.closest('.bndz-chrome-menubar, [data-bndz-menubar-logo], [data-menu-trigger]')) return true;
  }
  const bar = document.querySelector('.bndz-chrome-menubar');
  if (!bar) return false;
  const r = bar.getBoundingClientRect();
  return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
}

/** Screen-space leave check — works when clientX/Y are clamped by WebView2. */
export function isPointerOutsideScreenWindow(screenX: number, screenY: number, marginPx = 4): boolean {
  if (typeof window === 'undefined') return false;
  const left = window.screenX;
  const top = window.screenY;
  const right = left + window.outerWidth;
  const bottom = top + window.outerHeight;
  return screenX < left - marginPx
    || screenY < top - marginPx
    || screenX > right + marginPx
    || screenY > bottom + marginPx;
}

/** True when pointer is in the top caption/menubar band (screen coords). */
export function isPointerNearWindowTopChrome(screenY: number, chromePx = 48): boolean {
  if (typeof window === 'undefined') return false;
  const top = window.screenY;
  const band = Math.max(24, chromePx);
  return screenY >= top && screenY < top + band;
}

/**
 * Escalate in-app pointer drag to native OLE (Explorer/desktop).
 * Host FILE_DRAG_ACTIVE poll is authoritative; this is the FE backup path.
 */
export function shouldEscalateFileDragToOle(
  clientX: number,
  clientY: number,
  overInternalChrome: boolean,
  outsideChromeStreak: number,
  screenX?: number,
  screenY?: number,
): boolean {
  // True leave of the OS window → host OLE. Do NOT treat "outside WebView viewport"
  // alone as escalate — that killed FluidDragStack tooltips while still inside BNDZ.
  if (typeof screenX === 'number' && typeof screenY === 'number'
    && isPointerOutsideScreenWindow(screenX, screenY)) {
    return true;
  }
  if (overInternalChrome || outsideChromeStreak < 2) return false;
  if (isPointerOverMenubar(clientX, clientY)) return false;
  return isPointerNearWebViewSideOrBottomEdge(clientX, clientY);
}

/** True when archive drag should escalate to native OLE (desktop / Explorer), not in-app list. */
export function shouldArchiveEscalateToOle(
  clientX: number,
  clientY: number,
  outsideChromeStreak = 0,
  screenX?: number,
  screenY?: number,
): boolean {
  if (isArchiveInternalDropTargetAtPoint(clientX, clientY)) return false;
  if (typeof screenX === 'number' && typeof screenY === 'number'
    && isPointerOutsideScreenWindow(screenX, screenY)) {
    return true;
  }
  if (!isOutsideArchivePreviewAtPoint(clientX, clientY)) return false;
  if (isInternalFileDragChromeAtPoint(clientX, clientY)) return false;
  if (outsideChromeStreak < 2) return false;
  if (isPointerOverMenubar(clientX, clientY)) return false;
  return isPointerNearWebViewSideOrBottomEdge(clientX, clientY);
}

/** True when pointer is over an in-app drop target for archive extract-and-copy. */
export function isArchiveInternalDropTargetAtPoint(clientX: number, clientY: number): boolean {
  // Still inside archive preview — not an FM list drop.
  if (hitTestArchiveRootAtPoint(clientX, clientY)) return false;
  if (hitTestListBodyAtPoint(clientX, clientY)) return true;
  if (hitTestTabAtPoint(clientX, clientY)) return true;
  if (hitTestNavTreeAtPoint(clientX, clientY)) return true;
  if (hitTestBreadcrumbAtPoint(clientX, clientY)) return true;
  // Extra rect fallbacks — WebView2 poisons elementsFromPoint during pointer drags.
  if (hitTestSelectorByRect(clientX, clientY, '[data-list-body]')) return true;
  if (hitTestSelectorByRect(clientX, clientY, '[data-nav-path]')) return true;
  if (hitTestSelectorByRect(clientX, clientY, '[data-breadcrumb-path]')) return true;
  if (hitTestSelectorByRect(clientX, clientY, '[data-favorite-path]')) return true;
  if (hitTestSelectorByRect(clientX, clientY, '.bndz-chrome-tabstrip')) return true;
  if (hitTestSelectorByRect(clientX, clientY, '.bndz-chrome-sidebar')) return true;
  if (hitTestTabByRect(clientX, clientY)) return true;
  return isInternalFileDragChromeAtPoint(clientX, clientY)
    && !hitTestArchiveRootAtPoint(clientX, clientY);
}

/** Default tab auto-switch delay (ms) — short hover before switching. */
export const DEFAULT_TAB_HOVER_DELAY_MS = 120;

export type PaneTabSnapshot = {
  id: string;
  tabs: Array<{ id: string; path: string; locked?: boolean }>;
  activeTabIndex: number;
};

/** Resolve drop destination from hovered tab + live pane state + folder hit-test. */
export function resolveFileDropDestination(
  clientX: number,
  clientY: number,
  hover: { paneId: string; tabIndex: number } | null,
  panes: PaneTabSnapshot[],
  sourcePaneId: string,
  sourceTabPath: string,
  getContentsForPath: (path: string) => ListFolderTarget[] | null | undefined,
  breadcrumbPath: string | null,
  navTreePath: string | null,
): { paneId: string; tabIndex: number; tabPath: string; folderEnt: ListFolderTarget | null } {
  let paneId = sourcePaneId;
  let tabIndex = panes.find(p => p.id === sourcePaneId)?.activeTabIndex ?? 0;

  if (hover) {
    paneId = hover.paneId;
    tabIndex = hover.tabIndex;
  } else {
    const tabHit = hitTestTabAtPoint(clientX, clientY);
    if (tabHit?.tabId) {
      for (const p of panes) {
        const idx = p.tabs.findIndex(t => t.id === tabHit.tabId);
        if (idx >= 0) {
          paneId = p.id;
          tabIndex = idx;
          break;
        }
      }
    }
  }

  const paneState = panes.find(p => p.id === paneId);
  const tabPath = paneState?.tabs[tabIndex]?.path ?? sourceTabPath;
  if (navTreePath) return { paneId, tabIndex, tabPath: navTreePath, folderEnt: null };
  if (breadcrumbPath) return { paneId, tabIndex, tabPath: breadcrumbPath, folderEnt: null };

  const tabContents = getContentsForPath(tabPath);
  const folderEnt = hitTestListFolderAtPoint(clientX, clientY, tabContents ?? undefined) ?? null;
  return { paneId, tabIndex, tabPath, folderEnt };
}

/** Resolve native (Explorer/desktop) drop target from viewport coordinates. */
export function resolveNativeFileDropTarget(
  clientX: number,
  clientY: number,
  panes: PaneTabSnapshot[],
  activePaneId: string,
  getContentsForPath: (path: string) => ListFolderTarget[] | null | undefined,
  htmlDropTarget: { paneId: string; tabPath: string } | null,
): {
  hover: { paneId: string; tabIndex: number } | null;
  destPath: string;
  folderEnt: ListFolderTarget | null;
} {
  const activePane = panes.find(p => p.id === activePaneId) ?? panes[0];
  const activePath = activePane?.tabs[activePane.activeTabIndex]?.path ?? '/';

  const listBody = hitTestListBodyAtPoint(clientX, clientY);
  const listWins = !!listBody;

  const navTreePath = listWins ? null : hitTestNavTreeAtPoint(clientX, clientY);
  const breadcrumbPath = listWins ? null : (navTreePath ? null : hitTestBreadcrumbAtPoint(clientX, clientY));
  const tabHit = hitTestTabAtPoint(clientX, clientY);

  let hover: { paneId: string; tabIndex: number } | null = null;
  if (listBody) {
    const paneId = listBody.getAttribute('data-list-pane-id');
    const pane = paneId ? panes.find(p => p.id === paneId) : null;
    if (pane) {
      let tabIndex = pane.activeTabIndex;
      if (tabHit?.paneId === paneId && tabHit.tabIndex >= 0) tabIndex = tabHit.tabIndex;
      hover = { paneId: pane.id, tabIndex };
    }
  }
  if (!hover && tabHit?.paneId) {
    hover = { paneId: tabHit.paneId, tabIndex: tabHit.tabIndex };
  }

  const resolution = resolveFileDropDestination(
    clientX,
    clientY,
    hover,
    panes,
    activePaneId,
    activePath,
    getContentsForPath,
    breadcrumbPath,
    navTreePath,
  );

  let destPath = resolution.tabPath;
  if (resolution.folderEnt) {
    destPath = joinPanePath(resolution.tabPath, {
      name: resolution.folderEnt.name || resolution.folderEnt.id || 'folder',
      path: (resolution.folderEnt as { path?: string }).path,
      id: resolution.folderEnt.id,
    });
  }

  if ((!isFsDropTargetPath(destPath)) && htmlDropTarget?.tabPath) {
    destPath = htmlDropTarget.tabPath;
    if (!hover && htmlDropTarget.paneId) {
      const pane = panes.find(p => p.id === htmlDropTarget.paneId);
      if (pane) hover = { paneId: pane.id, tabIndex: pane.activeTabIndex };
    }
  }

  if ((!isFsDropTargetPath(destPath)) && hover) {
    const pane = panes.find(p => p.id === hover!.paneId);
    const tabPath = pane?.tabs[hover!.tabIndex]?.path;
    if (tabPath && isFsDropTargetPath(tabPath)) {
      destPath = tabPath;
    }
  }

  // Last resort: active pane folder when hit-test misses (WebView2 coord drift).
  if (!isFsDropTargetPath(destPath)) {
    const activePane = panes.find(p => p.id === activePaneId) ?? panes[0];
    const tabPath = activePane?.tabs[activePane.activeTabIndex]?.path;
    if (tabPath && isFsDropTargetPath(tabPath)) {
      destPath = tabPath;
      if (!hover && activePane) {
        hover = { paneId: activePane.id, tabIndex: activePane.activeTabIndex };
      }
    }
  }

  return {
    hover,
    destPath,
    folderEnt: resolution.folderEnt,
  };
}
