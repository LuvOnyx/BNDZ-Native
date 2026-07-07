/**
 * Unified file-drag hit-testing helpers.
 * Used by BNDZUI pointer-drag session to resolve tabs, breadcrumbs, list folders, and nav tree targets.
 */

export type TabHoverTarget = { paneId: string; tabIndex: number; tabId: string };
export type ListFolderTarget = { id: string; type?: string; name?: string };

/** Hit-test a tab strip row at screen coordinates. */
export function hitTestTabAtPoint(clientX: number, clientY: number): TabHoverTarget | null {
  const hit = document.elementFromPoint(clientX, clientY);
  const tabEl = hit?.closest('[data-tab-id]') as HTMLElement | null;
  const tabId = tabEl?.getAttribute('data-tab-id');
  if (!tabId) return null;
  const paneEl = tabEl?.closest('[data-pane-id]') as HTMLElement | null;
  const paneId = paneEl?.getAttribute('data-pane-id') || '';
  const tabIndex = parseInt(tabEl?.getAttribute('data-tab-index') || '-1', 10);
  if (!paneId || tabIndex < 0) return { paneId: '', tabIndex: 0, tabId };
  return { paneId, tabIndex, tabId };
}

/** Hit-test the "+" new-tab drop zone. Returns pane id or null. */
export function hitTestNewTabZoneAtPoint(clientX: number, clientY: number): string | null {
  const hit = document.elementFromPoint(clientX, clientY);
  const el = hit?.closest('[data-new-tab-zone]') as HTMLElement | null;
  return el?.getAttribute('data-new-tab-zone') || null;
}

/** Hit-test a breadcrumb segment; returns normalized path or null. */
export function hitTestBreadcrumbAtPoint(clientX: number, clientY: number): string | null {
  const hit = document.elementFromPoint(clientX, clientY);
  const crumbEl = hit?.closest('[data-breadcrumb-path]') as HTMLElement | null;
  return crumbEl?.getAttribute('data-breadcrumb-path') || null;
}

/** Hit-test a nav-tree folder row; returns folder path or null. */
export function hitTestNavTreeAtPoint(clientX: number, clientY: number): string | null {
  const hit = document.elementFromPoint(clientX, clientY);
  const row = hit?.closest('[data-nav-path]') as HTMLElement | null;
  return row?.getAttribute('data-nav-path') || null;
}

/** Hit-test a list folder row during internal drag. */
export function hitTestListFolderAtPoint<T extends ListFolderTarget>(
  clientX: number,
  clientY: number,
  contents: T[] | undefined,
): T | null {
  const hit = document.elementFromPoint(clientX, clientY);
  const dropRow = hit?.closest('.fs-item-wrapper') as HTMLElement | null;
  const dropId = dropRow?.getAttribute('data-id');
  if (!dropId) return null;
  const dropEnt = contents?.find(c => c.id === dropId);
  if (dropEnt?.type === 'directory') return dropEnt;
  return null;
}

export type FileDragSessionState = {
  paths: string[];
  op: 'copy' | 'move';
  sourcePaneId: string;
  sourceTabPath: string;
};

let activeSession: FileDragSessionState | null = null;

export function beginFileDragSession(state: FileDragSessionState) {
  activeSession = state;
}

export function getFileDragSession(): FileDragSessionState | null {
  return activeSession;
}

export function endFileDragSession() {
  activeSession = null;
}

/** True when the pointer is over in-app chrome that accepts internal file drops (not desktop OLE). */
export function isInternalFileDragChromeAtPoint(clientX: number, clientY: number): boolean {
  const hit = document.elementFromPoint(clientX, clientY);
  if (!hit) return false;
  return !!(
    hit.closest('[data-pane-id]')
    || hit.closest('[data-tab-id]')
    || hit.closest('[data-new-tab-zone]')
    || hit.closest('[data-breadcrumb-path]')
    || hit.closest('[data-nav-path]')
    || hit.closest('[data-list-body]')
    || hit.closest('.fs-list-header')
    || hit.closest('.bndz-chrome-tabstrip')
    || hit.closest('.bndz-chrome-toolbar')
    || hit.closest('.bndz-chrome-omnibar')
    || hit.closest('.bndz-chrome-sidebar')
    || hit.closest('.bndz-chrome-menubar')
    || hit.closest('.bndz-chrome-workspace')
    || hit.closest('.bndz-chrome-bottom')
    || hit.closest('.bndz-chrome-preview')
    || hit.closest('.bndz-chrome-statusbar')
  );
}

/** Default tab auto-switch delay (ms) — short hover before switching. */
export const DEFAULT_TAB_HOVER_DELAY_MS = 200;

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
