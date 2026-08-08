/**
 * Unified file-drop commit bus — external OLE, archive internal, and list pointer
 * sessions converge here before executeInternalDrop.
 */

import { isFsDropTargetPath } from './bndzVirtualViews';
import { getParentWinPath } from './dropDestination';
import { MESH_DROP_INBOX_DEST } from './fsPathRouting';
import { normalizePanePath, toWindowsPath } from './pathUtils';
import {
  consumeOleDragSession,
  hitTestArchiveRootAtPoint,
  hitTestListBodyAtPoint,
  hitTestNewTabZoneAtPoint,
  hitTestTabAtPoint,
  isArchiveInternalDropTargetAtPoint,
  resolveNativeFileDropTarget,
  type PaneTabSnapshot,
} from './fileDragSession';
import { recordExternalDragHover, recordPointerDragHover } from './fileDragHover';
import { hitTestMagnetAtPoint } from '../components/DropMagnetStrip';
import { IPC } from './ipcBridge';
import { appendDropStackPaths } from './dropStackStore';

export type DropSource = 'externalOle' | 'archiveInternal' | 'listPointer';

export type CoordSource = 'drop' | 'lastHover' | 'htmlTarget' | 'activeList' | 'fallback';

export type DropDebugInfo = {
  clientX: number;
  clientY: number;
  coordSource: CoordSource;
  destPath: string;
  source: DropSource;
  committed: boolean;
};

export type FileDropBusContext = {
  getPanes: () => PaneTabSnapshot[];
  getActivePaneId: () => string;
  getPathContents: (tabPath: string) => unknown[] | null | undefined;
  getHtmlDropTarget: () => { paneId: string; tabPath: string } | null;
  getActivePaneListCenter: () => { x: number; y: number } | null;
  activatePaneTab: (paneId: string, tabIndex: number) => void;
  applyHover: (clientX: number, clientY: number) => void;
  executeDrop: (op: 'copy' | 'move', paths: string[], destPath: string, sourcePath?: string) => void;
  addTab: (paneId: string, path: string) => void;
  setActivePaneId: (paneId: string) => void;
  toast: (message: string) => void;
  bottomPluginTab?: string | null;
  onArchiveAdd: (archivePath: string, paths: string[]) => void;
};

let busContext: FileDropBusContext | null = null;
let lastDropDebug: DropDebugInfo | null = null;
const pendingDrops: ResolveAndCommitDropOpts[] = [];

export function registerFileDropBusContext(ctx: FileDropBusContext) {
  busContext = ctx;
  const queued = pendingDrops.splice(0);
  for (const opts of queued) {
    if (opts.source === 'externalOle') void commitExternalOleDrop(opts);
    else if (opts.source === 'archiveInternal') commitArchiveInternalDrop(opts);
    else resolveAndCommitDrop(opts);
  }
}

/** True when coords are inside the WebView2 viewport (drop landed in BNDZ, not desktop). */
export function isWithinAppViewport(clientX?: number, clientY?: number): boolean {
  if (typeof clientX !== 'number' || typeof clientY !== 'number') return true;
  return clientX >= 0 && clientY >= 0
    && clientX <= window.innerWidth && clientY <= window.innerHeight;
}

/** Copy/move into the active (or hovered) real folder tab — bypasses hit-test. */
export function forceCommitToActivePaneFolder(
  paths: string[],
  op: 'copy' | 'move' = 'copy',
  source: DropSource = 'externalOle',
): boolean {
  const ctx = busContext;
  if (!ctx || !paths.length) return false;
  const ok = tryCommitToKnownListFolder(ctx, paths, op, source);
  if (ok) {
    lastDropDebug = {
      clientX: window.innerWidth / 2,
      clientY: window.innerHeight / 2,
      coordSource: 'activeList',
      destPath: 'active-pane-force',
      source,
      committed: true,
    };
    if (isDropDebugEnabled()) {
      window.dispatchEvent(new CustomEvent('bndz-drop-debug', { detail: lastDropDebug }));
    }
  }
  return ok;
}

export function getLastDropDebug(): DropDebugInfo | null {
  return lastDropDebug;
}

export function isDropDebugEnabled(): boolean {
  try {
    return localStorage.getItem('bndzDropDebug') === '1';
  } catch {
    return false;
  }
}

function canonicalDropPath(path: string): string {
  return toWindowsPath(path).replace(/\\+$/, '');
}

function resolveDropCoords(detail: {
  webViewX?: number;
  webViewY?: number;
  clientX?: number;
  clientY?: number;
}, source?: DropSource): { clientX: number; clientY: number; coordSource: CoordSource } {
  const candidates: Array<{ clientX: number; clientY: number; coordSource: CoordSource }> = [];

  const fromDropX = typeof detail.webViewX === 'number' ? detail.webViewX
    : typeof detail.clientX === 'number' ? detail.clientX : null;
  const fromDropY = typeof detail.webViewY === 'number' ? detail.webViewY
    : typeof detail.clientY === 'number' ? detail.clientY : null;
  if (fromDropX != null && fromDropY != null) {
    candidates.push({ clientX: fromDropX, clientY: fromDropY, coordSource: 'drop' });
  }

  if (recordExternalDragHover.last.valid) {
    const h = recordExternalDragHover.last;
    candidates.push({ clientX: h.clientX, clientY: h.clientY, coordSource: 'lastHover' });
  }

  if (recordPointerDragHover.last.valid) {
    const p = recordPointerDragHover.last;
    candidates.push({ clientX: p.clientX, clientY: p.clientY, coordSource: 'lastHover' });
  }

  const html = busContext?.getHtmlDropTarget() ?? null;
  if (html?.paneId) {
    const el = document.querySelector(`[data-list-body][data-list-pane-id="${html.paneId}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      candidates.push({
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        coordSource: 'htmlTarget',
      });
    }
  }

  const listCenter = busContext?.getActivePaneListCenter() ?? null;
  if (listCenter) {
    candidates.push({ clientX: listCenter.x, clientY: listCenter.y, coordSource: 'activeList' });
  }

  candidates.push({
    clientX: window.innerWidth / 2,
    clientY: window.innerHeight / 2,
    coordSource: 'fallback',
  });

  const wantsList = source === 'externalOle' || source === 'archiveInternal';
  if (wantsList) {
    for (const c of candidates) {
      if (hitTestListBodyAtPoint(c.clientX, c.clientY)) return c;
    }
    for (const c of candidates) {
      if (isArchiveInternalDropTargetAtPoint(c.clientX, c.clientY)) return c;
    }
  }

  return candidates[0] ?? {
    clientX: window.innerWidth / 2,
    clientY: window.innerHeight / 2,
    coordSource: 'fallback',
  };
}

function tryCommitToKnownListFolder(
  ctx: FileDropBusContext,
  paths: string[],
  op: 'copy' | 'move',
  source: DropSource,
): boolean {
  const html = ctx.getHtmlDropTarget();
  if (html?.tabPath) {
    const norm = normalizePanePath(html.tabPath);
    if (isFsDropTargetPath(norm)) {
      ctx.executeDrop(op, paths.map(toWindowsPath), canonicalDropPath(norm));
      return true;
    }
  }

  const panes = ctx.getPanes();
  const activeId = ctx.getActivePaneId();
  const pane = panes.find(p => p.id === activeId) ?? panes[0];
  const tabPath = normalizePanePath(pane?.tabs[pane.activeTabIndex]?.path || '');
  if (tabPath && isFsDropTargetPath(tabPath)) {
    ctx.executeDrop(op, paths.map(toWindowsPath), canonicalDropPath(tabPath));
    return true;
  }

  if (pane) {
    const real = findLastRealPathInHistory(panes, pane.id, pane.activeTabIndex);
    if (real) {
      ctx.executeDrop(op, paths.map(toWindowsPath), canonicalDropPath(real));
      return true;
    }
  }

  return false;
}

function findLastRealPathInHistory(panes: PaneTabSnapshot[], paneId: string, tabIndex: number): string | null {
  const pane = panes.find(p => p.id === paneId);
  const tab = pane?.tabs[tabIndex];
  if (!tab) return null;
  const history = (tab as { history?: string[] }).history;
  if (Array.isArray(history)) {
    for (let i = history.length - 1; i >= 0; i--) {
      const p = normalizePanePath(history[i] || '');
      if (p && isFsDropTargetPath(p)) return p;
    }
  }
  const current = normalizePanePath(tab.path || '');
  if (current && isFsDropTargetPath(current)) return current;
  return null;
}

export type ResolveAndCommitDropOpts = {
  paths: string[];
  webViewX?: number;
  webViewY?: number;
  clientX?: number;
  clientY?: number;
  source: DropSource;
  preferredEffect?: string;
  fromBndzOle?: boolean;
  op?: 'copy' | 'move';
  coordSourceHint?: string;
};

/** Single entry point for all cross-surface file drops. Returns true when committed. */
export function resolveAndCommitDrop(opts: ResolveAndCommitDropOpts): boolean {
  const ctx = busContext;
  if (!ctx || !opts.paths?.length) return false;

  const paths = opts.paths.filter(Boolean);
  if (!paths.length) return false;

  const { clientX, clientY, coordSource } = resolveDropCoords(opts, opts.source);
  ctx.applyHover(clientX, clientY);

  const dropStackEl = document.elementsFromPoint(clientX, clientY)
    .map(el => {
      const node = el as HTMLElement;
      return node.closest('[data-drop-stack-zone]')
        || node.closest('[data-plugin-tab-id="dropstack"]');
    })
    .find(Boolean);
  if (dropStackEl) {
    appendDropStackPaths(paths);
    window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', { detail: { id: 'dropstack' } }));
    lastDropDebug = { clientX, clientY, coordSource, destPath: 'drop-stack', source: opts.source, committed: true };
    if (isDropDebugEnabled()) {
      window.dispatchEvent(new CustomEvent('bndz-drop-debug', { detail: lastDropDebug }));
    }
    return true;
  }

  const meshDropInboxEl = document.elementsFromPoint(clientX, clientY)
    .map(el => (el as HTMLElement).closest('[data-mesh-drop-inbox]'))
    .find(Boolean);
  if (meshDropInboxEl) {
    const op: 'copy' | 'move' = opts.op === 'move' || opts.preferredEffect === 'move' ? 'move' : 'copy';
    ctx.executeDrop(op, paths.map(toWindowsPath), MESH_DROP_INBOX_DEST);
    lastDropDebug = { clientX, clientY, coordSource, destPath: MESH_DROP_INBOX_DEST, source: opts.source, committed: true };
    if (isDropDebugEnabled()) {
      window.dispatchEvent(new CustomEvent('bndz-drop-debug', { detail: lastDropDebug }));
    }
    return true;
  }

  const homeNavEl = document.elementsFromPoint(clientX, clientY)
    .map(el => (el as HTMLElement).closest('[data-home-nav-path]'))
    .find(Boolean) as HTMLElement | null;
  const homeNavPath = homeNavEl?.getAttribute('data-home-nav-path');
  if (homeNavPath && isFsDropTargetPath(homeNavPath)) {
    const op: 'copy' | 'move' = opts.preferredEffect === 'move' ? 'move' : 'copy';
    ctx.executeDrop(op, paths.map(toWindowsPath), canonicalDropPath(homeNavPath));
    lastDropDebug = { clientX, clientY, coordSource, destPath: homeNavPath, source: opts.source, committed: true };
    if (isDropDebugEnabled()) {
      window.dispatchEvent(new CustomEvent('bndz-drop-debug', { detail: lastDropDebug }));
    }
    return true;
  }

  // Icon Studio — only when drop point is over icon studio chrome
  if (ctx.bottomPluginTab === 'icon-studio') {
    const hit = document.elementFromPoint(clientX, clientY);
    if (hit?.closest('[data-icon-studio]') || hit?.closest('.icon-studio')) {
      return false;
    }
  }

  const favoriteEl = document.elementsFromPoint(clientX, clientY)
    .map(el => (el as HTMLElement).closest('[data-favorite-path]'))
    .find(Boolean) as HTMLElement | null;
  const favoritePath = favoriteEl?.getAttribute('data-favorite-path');
  if (favoritePath) {
    const op: 'copy' | 'move' = opts.preferredEffect === 'move' ? 'move' : 'copy';
    ctx.executeDrop(op, paths.map(toWindowsPath), canonicalDropPath(favoritePath));
    lastDropDebug = { clientX, clientY, coordSource, destPath: favoritePath, source: opts.source, committed: true };
    return true;
  }

  const newTabPaneId = hitTestNewTabZoneAtPoint(clientX, clientY);
  if (newTabPaneId) {
    const winPath = toWindowsPath(paths[0]);
    const parentWin = getParentWinPath(winPath);
    const openPath = `/${parentWin.replace(/\\/g, '/').replace(/^\/+/, '')}`;
    ctx.setActivePaneId(newTabPaneId);
    ctx.addTab(newTabPaneId, openPath);
    ctx.executeDrop('copy', paths.map(toWindowsPath), canonicalDropPath(openPath));
    lastDropDebug = { clientX, clientY, coordSource, destPath: openPath, source: opts.source, committed: true };
    return true;
  }

  const archiveEl = hitTestArchiveRootAtPoint(clientX, clientY);
  if (archiveEl && opts.source === 'externalOle') {
    const archivePath = archiveEl.getAttribute('data-archive-path');
    if (archivePath) {
      ctx.onArchiveAdd(archivePath, paths);
      lastDropDebug = { clientX, clientY, coordSource, destPath: archivePath, source: opts.source, committed: true };
      return true;
    }
  }

  const panes = ctx.getPanes();
  const tabHit = hitTestTabAtPoint(clientX, clientY);
  const listBody = hitTestListBodyAtPoint(clientX, clientY);
  let hover = tabHit?.paneId
    ? { paneId: tabHit.paneId, tabIndex: tabHit.tabIndex }
    : null;
  if (!hover && listBody) {
    const listPaneId = listBody.getAttribute('data-list-pane-id');
    const listPane = listPaneId ? panes.find(p => p.id === listPaneId) : null;
    if (listPane) hover = { paneId: listPane.id, tabIndex: listPane.activeTabIndex };
  }
  if (hover) ctx.activatePaneTab(hover.paneId, hover.tabIndex);

  const getContents = (tabPath: string) => {
    const norm = normalizePanePath(tabPath);
    return ctx.getPathContents(tabPath) ?? ctx.getPathContents(norm);
  };

  const { destPath, hover: resolvedHover } = resolveNativeFileDropTarget(
    clientX,
    clientY,
    panes,
    ctx.getActivePaneId(),
    getContents,
    ctx.getHtmlDropTarget(),
  );
  if (resolvedHover && (!hover || resolvedHover.paneId !== hover.paneId || resolvedHover.tabIndex !== hover.tabIndex)) {
    ctx.activatePaneTab(resolvedHover.paneId, resolvedHover.tabIndex);
  }

  let finalDest = destPath;
  if (!isFsDropTargetPath(finalDest)) {
    if (listBody && hover) {
      const real = findLastRealPathInHistory(ctx.getPanes(), hover.paneId, hover.tabIndex);
      if (real) finalDest = real;
    }
  }

  if (!isFsDropTargetPath(finalDest)) {
    const hoveredList = recordExternalDragHover.last.valid
      || recordPointerDragHover.last.overList
      || !!ctx.getHtmlDropTarget()?.tabPath;
    const fallbackOp: 'copy' | 'move' = opts.op === 'move' ? 'move' : 'copy';
    if (hoveredList && tryCommitToKnownListFolder(ctx, paths, fallbackOp, opts.source)) {
      lastDropDebug = { clientX, clientY, coordSource, destPath: 'active-list-fallback', source: opts.source, committed: true };
      if (isDropDebugEnabled()) {
        window.dispatchEvent(new CustomEvent('bndz-drop-debug', { detail: lastDropDebug }));
      }
      return true;
    }
    ctx.toast('Open a real folder to drop files here.');
    lastDropDebug = { clientX, clientY, coordSource, destPath: finalDest, source: opts.source, committed: false };
    return false;
  }

  const destCanon = canonicalDropPath(finalDest);
  let op: 'copy' | 'move' = opts.op === 'move' ? 'move' : 'copy';

  if (opts.source === 'externalOle') {
    const fromBndzOle = !!opts.fromBndzOle;
    const oleSession = fromBndzOle ? consumeOleDragSession() : null;
    if (!fromBndzOle) consumeOleDragSession();
    if (oleSession?.op === 'move' || oleSession?.op === 'copy') op = oleSession.op;
    else if (opts.preferredEffect === 'move') op = 'move';
    ctx.executeDrop(op, paths.map(toWindowsPath), destCanon, oleSession?.sourceTabPath);
  } else {
    ctx.executeDrop(op, paths.map(toWindowsPath), destCanon);
  }

  lastDropDebug = { clientX, clientY, coordSource, destPath: finalDest, source: opts.source, committed: true };
  if (isDropDebugEnabled()) {
    window.dispatchEvent(new CustomEvent('bndz-drop-debug', { detail: lastDropDebug }));
  }
  return true;
}

/**
 * External OLE drop from WPF host — only fires when drop landed in our window.
 * Falls back to active-pane folder when coord hit-tests miss (125% DPI, etc.).
 */
export async function commitExternalOleDrop(opts: ResolveAndCommitDropOpts): Promise<boolean> {
  if (!opts.paths?.length) return false;
  if (!busContext) {
    pendingDrops.push(opts);
    return false;
  }

  const { clientX, clientY } = resolveDropCoords(opts, 'externalOle');
  const magnetId = hitTestMagnetAtPoint(clientX, clientY);
  if (magnetId) {
    const res = await IPC.magnetApplyDrop(
      magnetId,
      opts.paths,
      opts.preferredEffect === 'move' ? 'move' : 'copy',
    );
    if (res.ok) {
      lastDropDebug = { clientX, clientY, coordSource: 'htmlTarget', destPath: `magnet:${magnetId}`, source: 'externalOle', committed: true };
      window.dispatchEvent(new CustomEvent('bndz-magnet-applied', { detail: { magnetId, paths: opts.paths } }));
      return true;
    }
    busContext.toast(res.error || 'Magnet drop failed.');
    return false;
  }

  if (resolveAndCommitDrop(opts)) return true;

  // Defer to Icon Studio plugin when drop is over its surface.
  if (busContext.bottomPluginTab === 'icon-studio') {
    const { clientX, clientY } = resolveDropCoords(opts, 'externalOle');
    const hit = document.elementFromPoint(clientX, clientY);
    if (hit?.closest('[data-icon-studio]') || hit?.closest('.icon-studio')) {
      return false;
    }
  }

  const op: 'copy' | 'move' = opts.preferredEffect === 'move' ? 'move' : 'copy';
  if (forceCommitToActivePaneFolder(opts.paths, op, 'externalOle')) return true;
  busContext.toast('Open a folder tab to receive dropped files.');
  lastDropDebug = {
    clientX: opts.webViewX ?? opts.clientX ?? 0,
    clientY: opts.webViewY ?? opts.clientY ?? 0,
    coordSource: 'fallback',
    destPath: 'none',
    source: 'externalOle',
    committed: false,
  };
  return false;
}

/** Archive extract-and-copy — never escalate to desktop OLE when still inside BNDZ. */
export function commitArchiveInternalDrop(opts: ResolveAndCommitDropOpts): boolean {
  if (!opts.paths?.length) return false;
  if (!busContext) {
    pendingDrops.push(opts);
    return false;
  }
  const withSource = { ...opts, source: 'archiveInternal' as const, op: opts.op ?? 'copy' as const };
  if (resolveAndCommitDrop(withSource)) return true;
  if (forceCommitToActivePaneFolder(opts.paths, 'copy', 'archiveInternal')) return true;
  busContext.toast('Open a folder tab to copy extracted archive files.');
  return false;
}
