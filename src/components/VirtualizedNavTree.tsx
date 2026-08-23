import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Icons8Icon, DragHandleGlyph } from './Icons8Icon';
import { TreeShellIcon } from './TreeShellIcon';
import { IPC } from '../lib/ipcBridge';
import { buildSettingsRuntime, evaluateColorFilter } from '../lib/settingsRuntime';
import { filterTreeListEntities } from '../lib/treeListItemFilter';
import { reorderNavTreeKeys } from '../lib/navTreeOrder';
import type { AppConfig } from '../data/configContext';
import { buildTreeTooltipContent } from '../lib/treeTooltip';
import { shouldShowTreeTooltip, bindFloatingTooltipHandlers } from '../lib/tooltipSettings';
import { markScrolling as markIconQueueScrolling } from '../lib/iconRequestQueue';
import {
  BNDZ_TREE_REORDER_MIME,
  type BndzFileDragPayload,
} from '../lib/bndzDrag';
import {
  beginFileDragSession,
  endFileDragSession,
  getFileDragSession,
  hitTestNavTreeAtPoint,
  isInternalFileDragChromeAtPoint,
  isPointerOutsideWebViewViewport,
  stashOleDragSession,
} from '../lib/fileDragSession';
import {
  dispatchPointerFileDragActive,
  dispatchPointerFileDragMove,
} from '../lib/pointerFileDragBridge';
import type { ClipboardAction } from '../data/ClipboardContext';
import { getClipboardMarkForEntity } from '../lib/clipboardVisual';
import { panePathsEqual } from '../lib/pathUtils';
import { toWindowsPath } from '../lib/pathUtils';
import { resolveDropOperation } from '../lib/dropOperation';
import { isPathUnderIndexedRoot } from '../lib/indexedRoots';
import {
  flattenNavTree,
  dirEntryToTreeNode,
  shouldExpandOnBrowse,
  type NavTreeSourceNode,
  type DynamicTreeState,
  type FlatNavRow,
} from '../lib/navTreeModel';
import {
  advanceSlowDoubleClickRename,
  clearSlowDoubleClickTimer,
  type SlowClickStamp,
} from '../lib/slowDoubleClickRename';

const ROW_HEIGHT = 28;
const VIRTUAL_THRESHOLD = 32;
const TREE_STATE_STORAGE_KEY = 'bndz.navTree.expanded';

function loadRememberedExpandedPaths(): string[] {
  try {
    const raw = localStorage.getItem(TREE_STATE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

function saveRememberedExpandedPaths(paths: string[]) {
  try {
    localStorage.setItem(TREE_STATE_STORAGE_KEY, JSON.stringify(paths.slice(0, 400)));
  } catch {
    /* ignore quota */
  }
}

interface VirtualizedNavTreeProps {
  nodes: NavTreeSourceNode[];
  config: AppConfig;
  currentPath?: string;
  onNavigate: (path: string) => void;
  onStaticNavigate?: () => void;
  onContextMenu: (e: React.MouseEvent, path: string | undefined, label: string) => void;
  onBackgroundContextMenu?: (e: React.MouseEvent) => void;
  inlineRename: { path: string; entityId: string; currentName: string } | null;
  setInlineRename: (v: VirtualizedNavTreeProps['inlineRename']) => void;
  navTreeOrder?: string[];
  onTreeOrderChange?: (order: string[]) => void;
  onFileDrop?: (payload: BndzFileDragPayload, destPath: string, op: 'copy' | 'move') => void;
  disallowDragFromTree?: boolean;
  indexedRoots?: string[];
  showIndexBadges?: boolean;
  /** External file-drop hover path (e.g. internal pointer drag from list pane). */
  fileDropTarget?: string | null;
  clipboard?: { items: string[]; action: ClipboardAction | null };
  /** Hover-prefetch child listing for dynamic folder rows. */
  onPrefetchPath?: (path: string) => void;
  /** When Settings → Remember tree scroll position per tab, persist scroll against this key. */
  treeScrollKey?: string;
  /** Settings → Folder contents preview (In tree + mouse up). */
  onFolderContentsPeek?: (path: string, label: string, clientX: number, clientY: number) => void;
}

async function loadDirectoryChildren(
  path: string,
  showHidden: boolean,
  skipInvisible: boolean,
  config?: AppConfig,
): Promise<NavTreeSourceNode[]> {
  try {
    const isShellish = /^\/?shell:/i.test(path || '') || path === '/' || path === '';
    let items: any[];
    if (isShellish) {
      try {
        items = await IPC.getDirContents(path);
      } catch {
        items = await IPC.getSubDirectories(path, showHidden);
      }
    } else {
      items = await IPC.getSubDirectories(path, showHidden);
    }
    let dirs = (items || []).filter((item: { type?: string; isDirectory?: boolean }) => item.type === 'directory' || item.isDirectory);
    if (skipInvisible) {
      dirs = dirs.filter((d: { name?: string }) => !(d.name || '').startsWith('.'));
    }
    if (config) {
      dirs = filterTreeListEntities(dirs, config);
    }
    return dirs
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))
      .map((d: { name: string; path?: string }) => dirEntryToTreeNode(d, true));
  } catch {
    const items = await IPC.getDirContents(path);
    const dirs = items.filter((item: { type?: string }) => item.type === 'directory');
    return dirs
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))
      .map((d: { name: string; path?: string }) => dirEntryToTreeNode(d, true));
  }
}

function TreeRow({
  row,
  config,
  treeRt,
  currentPath,
  onToggle,
  onNavigate,
  onStaticNavigate,
  onContextMenu,
  inlineRename,
  setInlineRename,
  isDragging,
  dropBefore,
  dropAfter,
  isVirtualRow,
  onReorderPointerDown,
  onDragOver,
  onDragEnd,
  onDrop,
  onFilePointerDown,
  suppressTreeClickRef,
  fileDropTarget,
  tipHandlers,
  disallowDragFromTree,
  indexedRoots,
  showIndexBadges,
  clipboard,
  treeLastClickRef,
  treeRenameTimerRef,
  onPrefetchPath,
  onFolderContentsPeek,
}: {
  row: FlatNavRow;
  config: AppConfig;
  treeRt: ReturnType<typeof buildSettingsRuntime>['tree'];
  currentPath?: string;
  onToggle: (row: FlatNavRow) => void;
  onNavigate: (path: string) => void;
  onStaticNavigate?: () => void;
  onContextMenu: VirtualizedNavTreeProps['onContextMenu'];
  inlineRename: VirtualizedNavTreeProps['inlineRename'];
  setInlineRename: VirtualizedNavTreeProps['setInlineRename'];
  isDragging?: boolean;
  dropBefore?: boolean;
  dropAfter?: boolean;
  isVirtualRow?: boolean;
  onReorderPointerDown?: (row: FlatNavRow, e: React.PointerEvent) => void;
  onDragOver?: (e: React.DragEvent, row: FlatNavRow) => void;
  onDragEnd?: () => void;
  onDrop?: (e: React.DragEvent, row: FlatNavRow) => void;
  onFilePointerDown?: (row: FlatNavRow, e: React.PointerEvent) => void;
  suppressTreeClickRef?: React.MutableRefObject<boolean>;
  fileDropTarget?: string | null;
  tipHandlers?: ReturnType<typeof bindFloatingTooltipHandlers>;
  disallowDragFromTree?: boolean;
  indexedRoots?: string[];
  showIndexBadges?: boolean;
  clipboard?: VirtualizedNavTreeProps['clipboard'];
  treeLastClickRef: React.MutableRefObject<SlowClickStamp>;
  treeRenameTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  onPrefetchPath?: (path: string) => void;
  onFolderContentsPeek?: VirtualizedNavTreeProps['onFolderContentsPeek'];
}) {
  const isSelected = row.selected || (row.path && panePathsEqual(currentPath, row.path));
  const isRenaming = inlineRename?.entityId === 'TREE' && inlineRename?.path === row.path;
  const expandOnSingleClick = !!config?.expandTreeNodesOnSingleClick
    && !(treeRt.lockState || !!config.lockTreeState);
  const treeColorFilter = (treeRt.applyColorFilters
    || (!!config.applyColorFiltersToTheTree && config.enableColorFilters !== false))
    && row.path
    ? evaluateColorFilter({ name: row.label, path: row.path, type: 'directory' }, config.colorFilters, config)
    : null;
  const indentPx = row.depth * 18 + 10;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (suppressTreeClickRef?.current) {
      suppressTreeClickRef.current = false;
      return;
    }
    if (row.isPlaceholder) return;

    if (expandOnSingleClick && row.hasChildren && row.path) {
      onToggle(row);
    }

    if (row.path) {
      onNavigate(row.path);
    } else {
      onStaticNavigate?.();
      row.staticClick?.();
    }

    if (row.path && !e.ctrlKey && !e.shiftKey) {
      const wasAlreadySelected = row.path ? panePathsEqual(currentPath, row.path) : false;
      if (wasAlreadySelected) {
        treeLastClickRef.current = advanceSlowDoubleClickRename({
          key: row.path,
          wasAlreadyActive: true,
          lastClick: treeLastClickRef.current,
          timerRef: treeRenameTimerRef,
          onRename: () => setInlineRename({ path: row.path!, entityId: 'TREE', currentName: row.label }),
        });
      } else {
        clearSlowDoubleClickTimer(treeRenameTimerRef);
        treeLastClickRef.current = { key: row.path, time: Date.now() };
      }
    }
  };

  const canReorder = !!row.draggable && !row.isPlaceholder && !disallowDragFromTree;
  const canDragFile = !!row.path && !row.isPlaceholder && !disallowDragFromTree;
  const isFileDropTarget = !!row.path && fileDropTarget === row.path;
  const clipboardMark = row.path && clipboard?.items?.length && clipboard.action
    ? getClipboardMarkForEntity(toWindowsPath(row.path), clipboard as { items: string[]; action: ClipboardAction })
    : null;

  const rowEl = (
      <div
      className={`nav-tree-row group/tree group flex items-center pr-2 cursor-pointer whitespace-nowrap transition-colors duration-100 ${
        isSelected ? 'nav-tree-row-selected' : row.pathTrace ? 'nav-tree-row-trace' : ''
      } ${row.isPlaceholder ? 'opacity-50 cursor-default italic' : ''} ${isDragging ? 'nav-tree-row-dragging' : ''} ${isFileDropTarget ? 'nav-tree-file-drop-target' : ''} ${treeColorFilter?.className || ''} ${clipboardMark === 'copy' ? 'fs-item-clipboard-copy' : clipboardMark === 'cut' ? 'fs-item-clipboard-cut' : ''}`}
      style={{ paddingLeft: `${indentPx}px`, ...(treeColorFilter?.inlineStyle && !isSelected ? treeColorFilter.inlineStyle : {}) }}
      data-nav-path={row.path || undefined}
      data-tree-key={row.treeKey || undefined}
      data-depth={row.depth}
      onPointerDown={canDragFile ? (e) => {
        if (e.button !== 0) return;
        onFilePointerDown?.(row, e);
      } : undefined}
      onDragOver={e => {
        if (canReorder) onDragOver?.(e, row);
      }}
      onDrop={e => {
        onDrop?.(e, row);
      }}
      onDragEnd={canReorder ? onDragEnd : undefined}
      onMouseEnter={(e) => {
        tipHandlers?.onMouseEnter?.(e);
        if (row.path && row.hasChildren && onPrefetchPath) onPrefetchPath(row.path);
      }}
      onMouseMove={tipHandlers?.onMouseMove}
      onMouseLeave={tipHandlers?.onMouseLeave}
      onClick={handleClick}
      onDoubleClick={e => {
        e.stopPropagation();
        clearSlowDoubleClickTimer(treeRenameTimerRef);
        treeLastClickRef.current = null;
        if (!treeRt.lockState && !expandOnSingleClick && row.hasChildren) onToggle(row);
        else if (row.path) onNavigate(row.path);
      }}
      onMouseDown={e => {
        if (e.button === 2) e.preventDefault();
      }}
      onMouseUp={e => {
        if (!row.path || row.isPlaceholder || !onFolderContentsPeek) return;
        if (!config.folderContentsPreview || !config.inTree) return;
        const leftOk = e.button === 0 && !!config.onLeftMouseUp;
        const rightOk = e.button === 2 && !!config.onRightMouseUp;
        const midOk = e.button === 1 && !!config.onMiddleMouseDown;
        if (!leftOk && !rightOk && !midOk) return;
        e.preventDefault();
        e.stopPropagation();
        onFolderContentsPeek(row.path, row.label, e.clientX, e.clientY);
      }}
      onContextMenu={e => {
        e.preventDefault();
        e.stopPropagation();
        if (!row.isPlaceholder) onContextMenu(e, row.path, row.label);
      }}
    >
      {canReorder && (
        <div
          className="nav-tree-reorder-grip shrink-0 opacity-30 group-hover/tree:opacity-60 hover:!opacity-90 cursor-grab active:cursor-grabbing p-0.5 -ml-1 mr-0.5 rounded touch-none"
          title="Drag to reorder"
          onPointerDown={e => {
            e.stopPropagation();
            onReorderPointerDown?.(row, e);
          }}
        >
          <DragHandleGlyph size={10} />
        </div>
      )}
      {row.hasChildren ? (
        <button
          type="button"
          className="w-4 h-4 mr-0.5 flex items-center justify-center text-gray-500 hover:text-white shrink-0 rounded-sm hover:bg-white/5"
          onClick={e => {
            e.stopPropagation();
            onToggle(row);
          }}
          aria-label={row.isExpanded ? 'Collapse' : 'Expand'}
        >
          <Icons8Icon id={row.isExpanded ? 'chevron_down' : 'chevron_right'} size={11} />
        </button>
      ) : (
        <span className="w-4 mr-0.5 shrink-0" />
      )}

      {(row.iconPath || row.path) && row.useShellIcon !== false ? (
        <span className="mr-1.5 shrink-0">
          <TreeShellIcon path={row.path} iconPath={row.iconPath} size={15} fallbackIcon={row.icon} />
        </span>
      ) : row.icon ? (
        <span className="mr-1.5 shrink-0">
          <Icons8Icon id={row.icon} size={15} />
        </span>
      ) : row.path && (/^\/bndz(\/|$)/i.test(row.path) || row.path.toLowerCase().startsWith('/vf/')) ? (
        // Virtual BNDZ nodes without an explicit icon still must not hit shell fetch (white files).
        <span className="mr-1.5 shrink-0">
          <Icons8Icon id="sparkles_ui" size={15} />
        </span>
      ) : null}

      {isRenaming ? (
        <input
          type="text"
          autoFocus
          className="bg-[#111] text-white border border-[#007acc] px-1.5 outline-none text-[12px] w-[140px] rounded-sm"
          value={inlineRename.currentName}
          onChange={e => setInlineRename({ ...inlineRename, currentName: e.target.value })}
          onBlur={() => {
            if (inlineRename.currentName !== row.label && row.path) {
              const parentPath = row.path.substring(0, row.path.lastIndexOf('/'));
              IPC.executeFsOperation(`rename-${Date.now()}`, 'move', row.path, `${parentPath}/${inlineRename.currentName}`);
            }
            setInlineRename(null);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur();
            else if (e.key === 'Escape') setInlineRename(null);
          }}
          onClick={e => e.stopPropagation()}
          onDoubleClick={e => e.stopPropagation()}
        />
      ) : (
        <span className="text-[12px] select-none truncate nav-tree-label transition-colors flex items-center gap-1 min-w-0" title={row.label}>
          <span className="truncate">{row.label}</span>
          {showIndexBadges && indexedRoots?.length && row.path && isPathUnderIndexedRoot(row.path, indexedRoots) && (
            <span className="shrink-0 px-1 py-px text-[8px] font-medium bg-[#094771]/70 text-[#99c9f0]" title="Search indexed">IDX</span>
          )}
        </span>
      )}
    </div>
  );

  if (isVirtualRow) {
    // Virtual mode: container has fixed height — use absolute indicators so they
    // straddle the row boundary without expanding the slot.
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {dropBefore && (
          <div
            className="nav-tree-drop-indicator"
            style={{ position: 'absolute', top: -1, left: 4, right: 4, margin: 0 }}
          />
        )}
        {rowEl}
        {dropAfter && (
          <div
            className="nav-tree-drop-indicator"
            style={{ position: 'absolute', bottom: -1, left: 4, right: 4, margin: 0 }}
          />
        )}
      </div>
    );
  }

  // Non-virtual mode: fragment lets the indicator push siblings in the flex column.
  return (
    <>
      {dropBefore && <div className="nav-tree-drop-indicator" />}
      {rowEl}
      {dropAfter && <div className="nav-tree-drop-indicator" />}
    </>
  );
}

function areTreeRowPropsEqual(
  prev: {
    row: FlatNavRow;
    currentPath?: string;
    isDragging?: boolean;
    dropBefore?: boolean;
    dropAfter?: boolean;
    fileDropTarget?: string | null;
    inlineRename: VirtualizedNavTreeProps['inlineRename'];
    showIndexBadges?: boolean;
    treeRt: ReturnType<typeof buildSettingsRuntime>['tree'];
    config: AppConfig;
  },
  next: {
    row: FlatNavRow;
    currentPath?: string;
    isDragging?: boolean;
    dropBefore?: boolean;
    dropAfter?: boolean;
    fileDropTarget?: string | null;
    inlineRename: VirtualizedNavTreeProps['inlineRename'];
    showIndexBadges?: boolean;
    treeRt: ReturnType<typeof buildSettingsRuntime>['tree'];
    config: AppConfig;
  },
): boolean {
  return (
    prev.row.id === next.row.id
    && prev.row.treeKey === next.row.treeKey
    && prev.row.label === next.row.label
    && prev.row.path === next.row.path
    && prev.row.depth === next.row.depth
    && prev.row.isExpanded === next.row.isExpanded
    && prev.row.hasChildren === next.row.hasChildren
    && prev.row.selected === next.row.selected
    && prev.row.isPlaceholder === next.row.isPlaceholder
    && prev.currentPath === next.currentPath
    && prev.isDragging === next.isDragging
    && prev.dropBefore === next.dropBefore
    && prev.dropAfter === next.dropAfter
    && prev.fileDropTarget === next.fileDropTarget
    && prev.inlineRename?.path === next.inlineRename?.path
    && prev.inlineRename?.entityId === next.inlineRename?.entityId
    && prev.showIndexBadges === next.showIndexBadges
    && prev.treeRt === next.treeRt
    && prev.config.colorFilters === next.config.colorFilters
    && prev.config.expandTreeNodesOnSingleClick === next.config.expandTreeNodesOnSingleClick
    && prev.config.lockTreeState === next.config.lockTreeState
    && prev.config.applyColorFiltersToTheTree === next.config.applyColorFiltersToTheTree
    && prev.config.enableColorFilters === next.config.enableColorFilters
  );
}

const TreeRowMemo = React.memo(TreeRow, areTreeRowPropsEqual);

export function VirtualizedNavTree({
  nodes,
  config,
  currentPath,
  onNavigate,
  onStaticNavigate,
  onContextMenu,
  onBackgroundContextMenu,
  inlineRename,
  setInlineRename,
  navTreeOrder,
  onTreeOrderChange,
  onFileDrop,
  disallowDragFromTree,
  indexedRoots,
  fileDropTarget: externalFileDropTarget,
  clipboard,
  onPrefetchPath,
  treeScrollKey,
  onFolderContentsPeek,
}: VirtualizedNavTreeProps) {
  const showIndexBadges = config.showNavIndexBadges === true;
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dynamicState, setDynamicState] = useState<Record<string, DynamicTreeState>>({});
  const didRestoreTreeStateRef = useRef(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const [dropAfter, setDropAfter] = useState(false);
  const effectiveFileDropTarget = externalFileDropTarget;
  const treeLastClickRef = useRef<SlowClickStamp>(null);
  const treeRenameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const treePrefetchTimerRef = useRef<Map<string, number>>(new Map());
  const expandDragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressTreeClickRef = useRef(false);

  const rt = useMemo(() => {
    const base = buildSettingsRuntime(config);
    return {
      ...base,
      tree: {
        ...base.tree,
        lockState: base.tree.lockState || !!config.lockTreeState,
        expandOnBrowse: base.tree.expandOnBrowse || !!config.expandTreeNodesOnBrowse,
        rememberState: base.tree.rememberState || !!config.rememberStateOfTree,
        applyColorFilters: base.tree.applyColorFilters
          || (!!config.applyColorFiltersToTheTree && config.enableColorFilters !== false),
      },
    };
  }, [
    config,
    config.lockTreeState,
    config.expandTreeNodesOnBrowse,
    config.rememberStateOfTree,
    config.applyColorFiltersToTheTree,
    config.enableColorFilters,
  ]);

  // Persist expanded paths when "Remember state of tree" is enabled.
  useEffect(() => {
    if (!rt.tree.rememberState) return;
    const expanded = Object.entries(dynamicState)
      .filter(([, s]) => s.expanded)
      .map(([p]) => p);
    saveRememberedExpandedPaths(expanded);
  }, [dynamicState, rt.tree.rememberState]);

  // Restore remembered expanded paths (and load their children).
  useEffect(() => {
    if (!rt.tree.rememberState || didRestoreTreeStateRef.current) return;
    didRestoreTreeStateRef.current = true;
    const remembered = loadRememberedExpandedPaths().slice(0, 40);
    if (!remembered.length) return;
    setDynamicState(prev => {
      const next = { ...prev };
      for (const p of remembered) {
        if (!next[p]?.expanded) {
          next[p] = { expanded: true, children: next[p]?.children ?? null, loading: true };
        }
      }
      return next;
    });
    let cancelled = false;
    remembered.forEach(p => {
      loadDirectoryChildren(p, rt.tree.showHidden, !!config?.skipInvisibleSubfolders, config).then(children => {
        if (cancelled) return;
        setDynamicState(inner => ({
          ...inner,
          [p]: { expanded: true, children, loading: false },
        }));
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt.tree.rememberState]);

  // Auto-optimize: collapse branches that are not ancestors of the current path.
  useEffect(() => {
    if (!config.autoOptimizeTree || !currentPath || rt.tree.lockState) return;
    setDynamicState(prev => {
      let changed = false;
      const next = { ...prev };
      for (const [p, state] of Object.entries(prev)) {
        if (!state.expanded) continue;
        const isSelf = panePathsEqual(p, currentPath);
        const isAncestor = currentPath.replace(/\\/g, '/').toLowerCase().startsWith(
          `${p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()}/`,
        );
        if (!isSelf && !isAncestor) {
          next[p] = { ...state, expanded: false };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [currentPath, config.autoOptimizeTree, rt.tree.lockState]);

  const clearExpandDragTimer = useCallback(() => {
    if (expandDragTimerRef.current) {
      clearTimeout(expandDragTimerRef.current);
      expandDragTimerRef.current = null;
    }
  }, []);

  // When tree expansion is locked, stop browse-driven auto-expansion from fighting the frozen state.
  useEffect(() => {
    if (!rt.tree.lockState) return;
    clearExpandDragTimer();
  }, [rt.tree.lockState, clearExpandDragTimer]);

  useEffect(() => () => {
    clearExpandDragTimer();
  }, [clearExpandDragTimer]);

  const FILE_DRAG_THRESHOLD_PX = 6;

  const handleFilePointerDown = useCallback((row: FlatNavRow, e: React.PointerEvent) => {
    if (!row.path || disallowDragFromTree) return;
    const winPath = toWindowsPath(row.path);
    const startX = e.clientX;
    const startY = e.clientY;
    const capturePointerId = e.pointerId;
    const rowEl = (e.currentTarget as HTMLElement);
    let oleStarted = false;
    let outsideChromeStreak = 0;
    let sessionStarted = false;
    let captured = false;

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (captured) {
        try { rowEl.releasePointerCapture(capturePointerId); } catch { /* ignore */ }
      }
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== capturePointerId || oleStarted) return;
      if (!sessionStarted) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < FILE_DRAG_THRESHOLD_PX) return;
        sessionStarted = true;
        suppressTreeClickRef.current = true;
        try {
          rowEl.setPointerCapture(capturePointerId);
          captured = true;
        } catch { /* ignore */ }
        beginFileDragSession({
          paths: [winPath],
          op: ev.ctrlKey || ev.altKey ? 'copy' : 'move',
          sourcePaneId: 'tree',
          sourceTabPath: row.path!,
        });
        dispatchPointerFileDragActive(true);
      }
      dispatchPointerFileDragMove(ev.clientX, ev.clientY);
      if (!isPointerOutsideWebViewViewport(ev.clientX, ev.clientY)) {
        outsideChromeStreak = 0;
        return;
      }
      outsideChromeStreak++;
      if (outsideChromeStreak < 2) return;
      oleStarted = true;
      suppressTreeClickRef.current = true;
      dispatchPointerFileDragActive(false);
      stashOleDragSession(getFileDragSession());
      endFileDragSession();
      cleanup();
      IPC.startDrag([winPath], {
        extended: !!config.extendedCompatibilityForClipboardAndDragAndDrop,
      });
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== capturePointerId) return;
      cleanup();
      if (oleStarted) return;
      const session = getFileDragSession();
      if (!session) {
        dispatchPointerFileDragActive(false);
        return;
      }
      const destPath = hitTestNavTreeAtPoint(ev.clientX, ev.clientY);
      if (destPath && destPath !== row.path && onFileDrop) {
        suppressTreeClickRef.current = true;
        const op = resolveDropOperation({
          payloadCopy: ev.ctrlKey || ev.altKey,
          ctrlKey: ev.ctrlKey || ev.metaKey,
          altKey: ev.altKey,
          shiftKey: ev.shiftKey,
          sourcePaths: session.paths,
          destDir: destPath,
          sameDriveDefault: config.dragDropSameVolumeAction ?? config.selectConfig2,
          crossDriveDefault: config.dragDropCrossVolumeAction ?? config.selectConfig3,
        });
        onFileDrop(
          { paths: session.paths, sourcePath: row.path, fromTree: true },
          destPath,
          op,
        );
      }
      endFileDragSession();
      dispatchPointerFileDragActive(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [config.dragDropSameVolumeAction, config.dragDropCrossVolumeAction, config.selectConfig2, config.selectConfig3, disallowDragFromTree, onFileDrop]);

  const handleDragOver = useCallback((e: React.DragEvent, row: FlatNavRow) => {
    if (!dragKey || !row.treeKey || dragKey === row.treeKey || row.depth !== 0) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    setDropTargetKey(row.treeKey);
    setDropAfter(after);
  }, [dragKey]);

  const toggleRowRef = useRef<(row: FlatNavRow) => void>(() => {});

  const handleDrop = useCallback((e: React.DragEvent, row: FlatNavRow) => {
    e.preventDefault();
    e.stopPropagation();
    clearExpandDragTimer();

    const reorderKey = e.dataTransfer.getData(BNDZ_TREE_REORDER_MIME) || dragKey;
    if (!reorderKey || !row.treeKey || !onTreeOrderChange || row.depth !== 0) return;
    const base = navTreeOrder?.length ? [...navTreeOrder] : nodes.map(n => n.treeKey!).filter(Boolean);
    const next = reorderNavTreeKeys(base, reorderKey, row.treeKey, dropAfter);
    onTreeOrderChange(next);
    setDragKey(null);
    setDropTargetKey(null);
  }, [dragKey, dropAfter, navTreeOrder, nodes, onTreeOrderChange, clearExpandDragTimer]);

  const handleDragEnd = useCallback(() => {
    setDragKey(null);
    setDropTargetKey(null);
    clearExpandDragTimer();
  }, [clearExpandDragTimer]);

  const flatRows = useMemo(
    () => flattenNavTree(nodes, {
      dynamicState,
      currentPath,
      markIntermediateNodes: !!config?.markIntermediateNodes,
      checkExistence: !!config?.checkExistenceOfSubfoldersInTree,
      pathsEqual: panePathsEqual,
    }),
    [nodes, dynamicState, currentPath, config?.markIntermediateNodes, config?.checkExistenceOfSubfoldersInTree],
  );

  const handleReorderPointerDown = useCallback((row: FlatNavRow, e: React.PointerEvent) => {
    if (!row.treeKey || !row.draggable || !onTreeOrderChange || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const gripEl = e.currentTarget as HTMLElement;
    const captureId = e.pointerId;
    try { gripEl.setPointerCapture(captureId); } catch { /* ignore */ }

    const reorderKey = row.treeKey;
    setDragKey(reorderKey);
    suppressTreeClickRef.current = true;

    const resolveTarget = (clientX: number, clientY: number) => {
      const hit = document.elementsFromPoint(clientX, clientY)
        .map(el => (el as HTMLElement).closest('[data-tree-key]'))
        .find(Boolean) as HTMLElement | null;
      const targetKey = hit?.getAttribute('data-tree-key');
      if (!targetKey || targetKey === reorderKey) return;
      const targetRow = flatRows.find(r => r.treeKey === targetKey && r.depth === 0);
      if (!targetRow?.treeKey) return;
      const rect = hit!.getBoundingClientRect();
      const after = clientY > rect.top + rect.height / 2;
      setDropTargetKey(targetRow.treeKey);
      setDropAfter(after);
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== captureId) return;
      resolveTarget(ev.clientX, ev.clientY);
    };

    const finish = (ev: PointerEvent) => {
      if (ev.pointerId !== captureId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      try { gripEl.releasePointerCapture(captureId); } catch { /* ignore */ }

      const hit = document.elementsFromPoint(ev.clientX, ev.clientY)
        .map(el => (el as HTMLElement).closest('[data-tree-key]'))
        .find(Boolean) as HTMLElement | null;
      const targetKey = hit?.getAttribute('data-tree-key');
      if (targetKey && targetKey !== reorderKey) {
        const targetRow = flatRows.find(r => r.treeKey === targetKey && r.depth === 0);
        if (targetRow?.treeKey) {
          const rect = hit!.getBoundingClientRect();
          const after = ev.clientY > rect.top + rect.height / 2;
          const base = navTreeOrder?.length ? [...navTreeOrder] : nodes.map(n => n.treeKey!).filter(Boolean);
          const next = reorderNavTreeKeys(base, reorderKey, targetRow.treeKey, after);
          onTreeOrderChange(next);
          suppressTreeClickRef.current = true;
        }
      }
      setDragKey(null);
      setDropTargetKey(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }, [flatRows, navTreeOrder, nodes, onTreeOrderChange]);

  useEffect(() => {
    if (rt.tree.lockState || !rt.tree.expandOnBrowse || !currentPath) return;

    const pathsToExpand: string[] = [];
    const walk = (list: NavTreeSourceNode[]) => {
      for (const node of list) {
        if (node.isDynamic && node.path && shouldExpandOnBrowse(node.path, currentPath, rt.tree.lockState, rt.tree.expandOnBrowse)) {
          pathsToExpand.push(node.path);
        }
        if (node.childrenItems) walk(node.childrenItems);
      }
    };
    walk(nodes);

    pathsToExpand.forEach(p => {
      setDynamicState(prev => {
        if (prev[p]?.expanded && (prev[p]?.children || prev[p]?.loading)) return prev;
        const needsLoad = !prev[p]?.children;
        if (needsLoad) {
          loadDirectoryChildren(p, rt.tree.showHidden, !!config?.skipInvisibleSubfolders, config).then(children => {
            setDynamicState(inner => ({
              ...inner,
              [p]: { expanded: true, children, loading: false },
            }));
          });
        }
        return {
          ...prev,
          [p]: { expanded: true, children: prev[p]?.children ?? null, loading: needsLoad },
        };
      });
    });
  }, [currentPath, nodes, rt.tree.lockState, rt.tree.expandOnBrowse, rt.tree.showHidden, config?.skipInvisibleSubfolders]);

  const handleToggle = useCallback(
    async (row: FlatNavRow) => {
      if (row.isPlaceholder) return;

      if (row.staticToggle) {
        row.staticToggle();
        return;
      }

      if (!row.path) return;

      const path = row.path;
      const current = dynamicState[path];
      const nextExpanded = !current?.expanded;

      if (!nextExpanded) {
        setDynamicState(prev => ({
          ...prev,
          [path]: { ...prev[path], expanded: false, children: prev[path]?.children ?? null },
        }));
        return;
      }

      if (current?.children) {
        setDynamicState(prev => ({
          ...prev,
          [path]: { ...prev[path], expanded: true },
        }));
        return;
      }

      setDynamicState(prev => ({
        ...prev,
        [path]: { expanded: true, children: null, loading: true },
      }));

      const children = await loadDirectoryChildren(
        path,
        !!config?.showHiddenSystemFoldersInTree,
        !!config?.skipInvisibleSubfolders,
        config,
      );
      setDynamicState(prev => ({
        ...prev,
        [path]: { expanded: true, children, loading: false },
      }));
    },
    [dynamicState, config?.showHiddenSystemFoldersInTree, config?.skipInvisibleSubfolders],
  );

  toggleRowRef.current = handleToggle;

  // Expand tree nodes when file drag hovers (Explorer / internal pointer / archive).
  useEffect(() => {
    const onExpandDrag = (e: Event) => {
      const path = (e as CustomEvent<{ path?: string }>).detail?.path;
      if (!path || rt.tree.lockState || !config?.expandTreeNodesOnDragOver) return;
      clearExpandDragTimer();
      expandDragTimerRef.current = setTimeout(() => {
        const row = flatRows.find(r => r.path && panePathsEqual(r.path, path));
        if (row?.hasChildren) toggleRowRef.current(row);
      }, 350);
    };
    window.addEventListener('bndz-tree-expand-drag', onExpandDrag);
    return () => window.removeEventListener('bndz-tree-expand-drag', onExpandDrag);
  }, [config?.expandTreeNodesOnDragOver, rt.tree.lockState, flatRows, clearExpandDragTimer]);

  // Settings → Expand in tree (favorites / path locate)
  useEffect(() => {
    const onExpandPath = (e: Event) => {
      const path = (e as CustomEvent<{ path?: string }>).detail?.path;
      if (!path || rt.tree.lockState || !config?.expandInTree) return;
      const row = flatRows.find(r => r.path && panePathsEqual(r.path, path));
      if (row?.hasChildren) void toggleRowRef.current(row);
    };
    window.addEventListener('bndz-expand-tree-path', onExpandPath);
    return () => window.removeEventListener('bndz-expand-tree-path', onExpandPath);
  }, [config?.expandInTree, rt.tree.lockState, flatRows]);

  const scheduleTreePrefetch = useCallback((path?: string) => {
    if (!onPrefetchPath || !path) return;
    const prev = treePrefetchTimerRef.current.get(path);
    if (prev) window.clearTimeout(prev);
    const timer = window.setTimeout(() => {
      treePrefetchTimerRef.current.delete(path);
      onPrefetchPath(path);
    }, 120);
    treePrefetchTimerRef.current.set(path, timer);
  }, [onPrefetchPath]);

  useEffect(() => () => {
    treePrefetchTimerRef.current.forEach(t => window.clearTimeout(t));
    treePrefetchTimerRef.current.clear();
  }, []);

  const showTreeTips = shouldShowTreeTooltip(config);

  const useVirtual = flatRows.length >= VIRTUAL_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    enabled: useVirtual,
  });

  // Scroll selected / expanded folder into view per tree settings.
  useEffect(() => {
    if (!currentPath || (!config.scrollSelectedFolderToTheTop && !config.scrollSubfoldersIntoView)) return;
    const idx = flatRows.findIndex(r => r.path && panePathsEqual(r.path, currentPath));
    if (idx < 0) return;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      if (useVirtual) {
        virtualizer.scrollToIndex(idx, {
          align: config.scrollSelectedFolderToTheTop ? 'start' : 'auto',
        });
        return;
      }
      const top = idx * ROW_HEIGHT;
      if (config.scrollSelectedFolderToTheTop) {
        el.scrollTop = Math.max(0, top - 4);
        return;
      }
      const viewTop = el.scrollTop;
      const viewBottom = viewTop + el.clientHeight;
      if (top < viewTop) el.scrollTop = top;
      else if (top + ROW_HEIGHT > viewBottom) el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
    });
  }, [currentPath, flatRows, config.scrollSelectedFolderToTheTop, config.scrollSubfoldersIntoView, useVirtual, virtualizer]);

  const renderRow = (row: FlatNavRow, isVirtualRow = false) => {
    const tipHandlers = showTreeTips && !row.isPlaceholder
      ? bindFloatingTooltipHandlers(null, config, {
          context: 'tree',
          surface: 'filename',
          resolveContent: () => buildTreeTooltipContent(row, config),
        })
      : undefined;
    return (
    <TreeRowMemo
      key={row.id}
      row={row}
      config={config}
      treeRt={rt.tree}
      currentPath={currentPath}
      onToggle={handleToggle}
      onNavigate={onNavigate}
      onStaticNavigate={onStaticNavigate}
      onContextMenu={onContextMenu}
      inlineRename={inlineRename}
      setInlineRename={setInlineRename}
      isDragging={dragKey === row.treeKey}
      dropBefore={dropTargetKey === row.treeKey && !dropAfter}
      dropAfter={dropTargetKey === row.treeKey && dropAfter}
      isVirtualRow={isVirtualRow}
      onReorderPointerDown={handleReorderPointerDown}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDrop={handleDrop}
      onFilePointerDown={handleFilePointerDown}
      suppressTreeClickRef={suppressTreeClickRef}
      fileDropTarget={effectiveFileDropTarget}
      tipHandlers={tipHandlers}
      disallowDragFromTree={disallowDragFromTree}
      indexedRoots={indexedRoots}
      showIndexBadges={showIndexBadges}
      clipboard={clipboard}
      treeLastClickRef={treeLastClickRef}
      treeRenameTimerRef={treeRenameTimerRef}
      onPrefetchPath={onPrefetchPath ? scheduleTreePrefetch : undefined}
      onFolderContentsPeek={onFolderContentsPeek}
    />
  );
  };

  useEffect(() => {
    const onFocusTree = () => {
      scrollRef.current?.focus({ preventScroll: true });
      scrollRef.current?.scrollTo({ top: 0 });
    };
    window.addEventListener('bndz-focus-nav-tree', onFocusTree);
    return () => window.removeEventListener('bndz-focus-nav-tree', onFocusTree);
  }, []);

  // Settings → Remember tree scroll position per tab
  useEffect(() => {
    const enabled = !!config.rememberTreeScrollPositionPerTab
      && String(config.rememberTreeScrollPositionPerTab).toLowerCase() !== 'false';
    if (!enabled || !treeScrollKey) return;
    const el = scrollRef.current;
    if (!el) return;
    const storageKey = `bndz.treeScroll.${treeScrollKey}`;
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved != null) {
        const top = parseInt(saved, 10);
        if (Number.isFinite(top)) el.scrollTop = top;
      }
    } catch { /* ignore */ }
    const onScroll = () => {
      try { sessionStorage.setItem(storageKey, String(el.scrollTop)); } catch { /* ignore */ }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [treeScrollKey, config.rememberTreeScrollPositionPerTab]);

  return (
    <div ref={containerRef} className="nav-tree-host w-full">
      <div
        ref={scrollRef}
        className={
          useVirtual
            ? 'max-h-[min(50vh,520px)] overflow-y-auto overflow-x-hidden styled-scrollbar nav-tree-scroll'
            : 'overflow-x-hidden nav-tree-scroll'
        }
        tabIndex={-1}
        onScroll={() => markIconQueueScrolling()}
        onContextMenu={e => {
          if ((e.target as HTMLElement).closest('.nav-tree-row')) return;
          if (!onBackgroundContextMenu) return;
          e.preventDefault();
          e.stopPropagation();
          onBackgroundContextMenu(e);
        }}
      >
        {flatRows.length === 0 ? (
          <div className="px-3 py-4 text-[11px] text-gray-500 text-center">No locations</div>
        ) : useVirtual ? (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {virtualizer.getVirtualItems().map(vi => {
              const row = flatRows[vi.index];
              return (
                <div
                  key={`${row.id}:${vi.index}`}
                  className="nav-tree-virtual-row"
                  style={{
                    position: 'absolute',
                    top: vi.start,
                    left: 0,
                    width: '100%',
                    height: vi.size,
                    overflow: 'hidden',
                    contain: 'layout style',
                  }}
                >
                  {renderRow(row, true)}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col py-0.5">{flatRows.map(row => renderRow(row, false))}</div>
        )}
      </div>
    </div>
  );
}
