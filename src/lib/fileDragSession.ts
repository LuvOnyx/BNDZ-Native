/**
 * Unified file-drag hit-testing helpers.
 * Used by BNDZUI pointer-drag session to resolve tabs, breadcrumbs, list folders, and nav tree targets.
 */

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
  if (!paneId || tabIndex < 0) return { paneId: '', tabIndex: 0, tabId };
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
  const tabs = document.querySelectorAll<HTMLElement>('.bndz-chrome-tabstrip [data-tab-id], [data-tab-id]');
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
/** Survives pointer-up while native OLE DoDragDrop runs, so drop-back keeps move intent. */
let pendingOleSession: FileDragSessionState | null = null;

export function beginFileDragSession(state: FileDragSessionState) {
  activeSession = state;
  pendingOleSession = null;
}

export function getFileDragSession(): FileDragSessionState | null {
  return activeSession ?? pendingOleSession;
}

export function endFileDragSession() {
  activeSession = null;
  // Keep pendingOleSession — OLE DoDragDrop may still complete after pointer-up.
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
