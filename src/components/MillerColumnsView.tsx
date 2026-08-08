import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LauncherIcon } from './LauncherIcon';
import { ThumbnailIcon } from './ThumbnailIcon';
import { VirtualizedFileList } from './VirtualizedFileList';
import { joinPanePath, normalizePanePath, toWindowsPath } from '../lib/pathUtils';
import { getDisplayName } from '../lib/settingsRuntime';
import {
  beginDragSession,
  trackDragPointer,
  clearDragSession,
  hasMetDragThreshold,
  isDragSessionReady,
  DRAG_DELAY_DEFAULT,
} from '../lib/dragController';
import {
  beginFileDragSession,
  endFileDragSession,
  hitTestMillerDropPathAtPoint,
} from '../lib/fileDragSession';
import { isCopyDragModifier } from '../lib/listDragModifiers';

type Entity = Record<string, unknown> & {
  id?: string;
  name?: string;
  type?: string;
  path?: string;
};

type Props = {
  rootPath: string;
  selectedPath: string;
  pathContentsCache: Record<string, Entity[]>;
  config: Record<string, unknown>;
  onNavigate: (path: string) => void;
  onOpen: (entity: Entity, columnPath: string) => void;
  onPrefetchPath?: (path: string) => void;
  /** Column↔column (and miller→folder) move/copy commit. */
  onMoveOrCopyPaths?: (paths: string[], destDir: string, copy: boolean) => void;
};

function splitPathSegments(panePath: string): string[] {
  const norm = normalizePanePath(panePath);
  if (!norm || norm === '/') return [];
  const parts = norm.split('/').filter(Boolean);
  const segs: string[] = [];
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : `/${part}`;
    segs.push(acc);
  }
  return segs;
}

function parentOf(path: string): string {
  const norm = normalizePanePath(path);
  if (!norm || norm === '/') return '/';
  const idx = norm.lastIndexOf('/');
  if (idx <= 0) return '/';
  return norm.slice(0, idx) || '/';
}

function entityChildPath(colPath: string, entity: Entity): string {
  return normalizePanePath(joinPanePath(colPath, entity as { name: string; path?: string }));
}

/** File Pilot / macOS Miller columns — keyboard + mouse + column drag. */
export default function MillerColumnsView({
  rootPath,
  selectedPath,
  pathContentsCache,
  config,
  onNavigate,
  onOpen,
  onPrefetchPath,
  onMoveOrCopyPaths,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const columnsRowRef = useRef<HTMLDivElement>(null);
  const colRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const itemRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [dropHoverPath, setDropHoverPath] = useState<string | null>(null);

  const columnPaths = useMemo(() => {
    const normRoot = normalizePanePath(rootPath);
    const normSelected = normalizePanePath(selectedPath);
    const base = normRoot === '/' ? [] : [normRoot];
    const tail = splitPathSegments(normSelected).filter(p => !base.includes(p));
    const all = [...base, ...tail];
    if (!all.length && normSelected !== '/') all.push('/');
    return all.length ? all : ['/'];
  }, [rootPath, selectedPath]);

  /** Highlighted entry path (file or folder); may be deeper than selectedPath when a file is focused. */
  const [cursorPath, setCursorPath] = useState(() => normalizePanePath(selectedPath));
  const [focusColIdx, setFocusColIdx] = useState(() => Math.max(0, columnPaths.length - 1));

  useEffect(() => {
    const sel = normalizePanePath(selectedPath);
    setCursorPath(prev => {
      if (prev === sel || prev.startsWith(`${sel}/`)) return prev;
      return sel;
    });
    setFocusColIdx(Math.max(0, columnPaths.length - 1));
  }, [selectedPath, columnPaths.length]);

  useEffect(() => {
    if (!onPrefetchPath) return;
    for (const colPath of columnPaths) {
      if (pathContentsCache[colPath] === undefined) onPrefetchPath(colPath);
    }
    const last = columnPaths[columnPaths.length - 1];
    const lastItems = pathContentsCache[last] || [];
    const selected = normalizePanePath(cursorPath);
    const active = lastItems.find((entity) => {
      const childPath = entityChildPath(last, entity);
      return selected === childPath || selected.startsWith(`${childPath}/`);
    });
    if (active && active.type === 'directory') {
      const childPath = entityChildPath(last, active);
      if (pathContentsCache[childPath] === undefined) onPrefetchPath(childPath);
    }
  }, [columnPaths, onPrefetchPath, pathContentsCache, cursorPath]);

  const scrollCursorIntoView = useCallback((path: string, colPath: string) => {
    requestAnimationFrame(() => {
      const item = itemRefs.current.get(path);
      item?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const col = colRefs.current.get(colPath);
      col?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    });
  }, []);

  const selectInColumn = useCallback((colPath: string, entity: Entity, opts?: { openDir?: boolean; openFile?: boolean }) => {
    const childPath = entityChildPath(colPath, entity);
    const isDir = entity.type === 'directory';
    setCursorPath(childPath);
    const colIdx = columnPaths.indexOf(colPath);
    if (colIdx >= 0) setFocusColIdx(colIdx);
    scrollCursorIntoView(childPath, colPath);

    if (isDir) {
      if (opts?.openDir !== false) onNavigate(childPath);
    } else {
      // Collapse trail past this column by navigating to the column folder.
      if (normalizePanePath(selectedPath) !== normalizePanePath(colPath)) {
        onNavigate(colPath);
      }
      if (opts?.openFile) onOpen(entity, colPath);
    }
  }, [columnPaths, onNavigate, onOpen, scrollCursorIntoView, selectedPath]);

  const itemsFor = useCallback((colPath: string) => pathContentsCache[colPath] || [], [pathContentsCache]);

  const highlightInColumn = useCallback((colPath: string, items: Entity[]): string | null => {
    const cursor = normalizePanePath(cursorPath);
    for (const ent of items) {
      const p = entityChildPath(colPath, ent);
      if (cursor === p || cursor.startsWith(`${p}/`)) return p;
    }
    return null;
  }, [cursorPath]);

  const moveVertical = useCallback((delta: number) => {
    const colPath = columnPaths[focusColIdx] || columnPaths[columnPaths.length - 1];
    if (!colPath) return;
    const items = itemsFor(colPath);
    if (!items.length) return;
    const hi = highlightInColumn(colPath, items);
    let idx = hi ? items.findIndex(e => entityChildPath(colPath, e) === hi) : -1;
    if (idx < 0) idx = delta > 0 ? -1 : 0;
    const next = Math.max(0, Math.min(items.length - 1, idx + delta));
    const ent = items[next];
    if (!ent) return;
    const childPath = entityChildPath(colPath, ent);
    setCursorPath(childPath);
    scrollCursorIntoView(childPath, colPath);
    if (ent.type === 'directory') onNavigate(childPath);
    else if (normalizePanePath(selectedPath) !== normalizePanePath(colPath)) onNavigate(colPath);
  }, [columnPaths, focusColIdx, highlightInColumn, itemsFor, onNavigate, scrollCursorIntoView, selectedPath]);

  const moveHorizontal = useCallback((dir: 1 | -1) => {
    if (dir < 0) {
      if (focusColIdx > 0) {
        const prevCol = columnPaths[focusColIdx - 1];
        const cameFrom = columnPaths[focusColIdx];
        setFocusColIdx(focusColIdx - 1);
        onNavigate(prevCol);
        setCursorPath(cameFrom);
        scrollCursorIntoView(cameFrom, prevCol);
        return;
      }
      const sel = normalizePanePath(selectedPath);
      const root = normalizePanePath(rootPath);
      const up = parentOf(sel);
      if (up === sel) return;
      if (root !== '/' && !up.startsWith(`${root}`) && up !== root) return;
      onNavigate(root !== '/' && (up === '/' || !up.startsWith(root)) ? root : up);
      return;
    }

    const colPath = columnPaths[focusColIdx] || columnPaths[columnPaths.length - 1];
    const items = itemsFor(colPath);
    const hi = highlightInColumn(colPath, items);
    const ent = hi ? items.find(e => entityChildPath(colPath, e) === hi) : null;
    if (ent && ent.type === 'directory') {
      const child = entityChildPath(colPath, ent);
      onNavigate(child);
      setFocusColIdx(focusColIdx + 1);
      const childItems = pathContentsCache[child];
      if (childItems?.length) {
        const first = entityChildPath(child, childItems[0]);
        setCursorPath(first);
        scrollCursorIntoView(first, child);
      } else {
        setCursorPath(child);
      }
      return;
    }
    if (focusColIdx < columnPaths.length - 1) {
      const nextCol = columnPaths[focusColIdx + 1];
      setFocusColIdx(focusColIdx + 1);
      const nextItems = itemsFor(nextCol);
      const nextHi = highlightInColumn(nextCol, nextItems)
        || (nextItems[0] ? entityChildPath(nextCol, nextItems[0]) : nextCol);
      setCursorPath(nextHi);
      scrollCursorIntoView(nextHi, nextCol);
    }
  }, [
    columnPaths,
    focusColIdx,
    highlightInColumn,
    itemsFor,
    onNavigate,
    pathContentsCache,
    rootPath,
    scrollCursorIntoView,
    selectedPath,
  ]);

  const activateCursor = useCallback(() => {
    const colPath = columnPaths[focusColIdx] || columnPaths[columnPaths.length - 1];
    if (!colPath) return;
    const items = itemsFor(colPath);
    const hi = highlightInColumn(colPath, items);
    const ent = hi ? items.find(e => entityChildPath(colPath, e) === hi) : null;
    if (!ent) return;
    if (ent.type === 'directory') {
      onNavigate(entityChildPath(colPath, ent));
    } else {
      onOpen(ent, colPath);
    }
  }, [columnPaths, focusColIdx, highlightInColumn, itemsFor, onNavigate, onOpen]);

  useEffect(() => {
    const onWinKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable) return;
      const key = e.key;
      if (key === 'ArrowDown') {
        e.preventDefault();
        moveVertical(1);
        return;
      }
      if (key === 'ArrowUp') {
        e.preventDefault();
        moveVertical(-1);
        return;
      }
      if (key === 'ArrowRight') {
        e.preventDefault();
        moveHorizontal(1);
        return;
      }
      if (key === 'ArrowLeft' || key === 'Backspace') {
        e.preventDefault();
        moveHorizontal(-1);
        return;
      }
      if (key === 'Enter') {
        e.preventDefault();
        activateCursor();
        return;
      }
      if (key === 'Home') {
        e.preventDefault();
        const colPath = columnPaths[focusColIdx];
        const items = itemsFor(colPath);
        if (items[0]) selectInColumn(colPath, items[0], { openDir: items[0].type === 'directory' });
        return;
      }
      if (key === 'End') {
        e.preventDefault();
        const colPath = columnPaths[focusColIdx];
        const items = itemsFor(colPath);
        const last = items[items.length - 1];
        if (last) selectInColumn(colPath, last, { openDir: last.type === 'directory' });
      }
    };
    window.addEventListener('keydown', onWinKey);
    return () => window.removeEventListener('keydown', onWinKey);
  }, [activateCursor, columnPaths, focusColIdx, itemsFor, moveHorizontal, moveVertical, selectInColumn]);

  const armItemDrag = useCallback((
    e: React.PointerEvent,
    colPath: string,
    entity: Entity,
    childPath: string,
  ) => {
    if (!onMoveOrCopyPaths) return;
    if (e.button !== 0) return;
    // Don't steal pure click — threshold separates click from drag.
    const startX = e.clientX;
    const startY = e.clientY;
    const pointerId = e.pointerId;
    const winPath = toWindowsPath(childPath);
    const sourceCol = normalizePanePath(colPath);
    let mode: 'pending' | 'drag' = 'pending';
    let copyDrag = isCopyDragModifier(e);

    beginDragSession(pointerId, startX, startY, DRAG_DELAY_DEFAULT);

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      trackDragPointer(ev.clientX, ev.clientY);
      copyDrag = isCopyDragModifier(ev);
      if (mode === 'pending') {
        if (!hasMetDragThreshold() || !isDragSessionReady()) return;
        mode = 'drag';
        beginFileDragSession({
          paths: [winPath],
          op: copyDrag ? 'copy' : 'move',
          sourcePaneId: 'miller',
          sourceTabPath: sourceCol,
        });
      }
      if (mode === 'drag') {
        const dest = hitTestMillerDropPathAtPoint(ev.clientX, ev.clientY);
        // Don't highlight self or a descendant as drop.
        const safe = dest
          && dest !== childPath
          && !childPath.startsWith(`${dest}/`)
          && dest !== sourceCol
          ? dest
          : null;
        setDropHoverPath(safe);
      }
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      clearDragSession();
      if (mode === 'drag') {
        const dest = hitTestMillerDropPathAtPoint(ev.clientX, ev.clientY);
        const copy = isCopyDragModifier(ev) || copyDrag;
        if (
          dest
          && dest !== childPath
          && !childPath.startsWith(`${dest}/`)
          && dest !== sourceCol
        ) {
          onMoveOrCopyPaths([winPath], dest, copy);
        }
        endFileDragSession();
      }
      setDropHoverPath(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [onMoveOrCopyPaths]);

  return (
    <div
      ref={shellRef}
      className="bndz-miller flex flex-col h-full min-h-0 outline-none"
      tabIndex={0}
      role="tree"
      aria-label="Columns view"
      onMouseDown={() => shellRef.current?.focus({ preventScroll: true })}
    >
      <div
        className="bndz-miller-crumb shrink-0 flex items-center gap-0.5 px-2 py-1.5 border-b border-white/[0.06] overflow-x-auto bndz-scrollbar text-[11px]"
        style={{ background: 'var(--bndz-surface-chrome, #12141a)' }}
      >
        <LauncherIcon id="view_columns" size={12} className="opacity-60 mr-1" />
        {columnPaths.map((seg, i) => {
          const label = seg === '/' ? 'This PC' : (seg.split('/').pop() || seg);
          return (
            <React.Fragment key={seg}>
              {i > 0 && <LauncherIcon id="chevron_right" size={10} className="shrink-0 opacity-50" />}
              <button
                type="button"
                className={`shrink-0 px-1.5 py-0.5 rounded hover:bg-white/[0.06] truncate max-w-[140px] ${
                  i === columnPaths.length - 1 ? 'text-[#99c9f0] font-medium' : 'text-gray-400'
                }`}
                onClick={() => onNavigate(seg)}
              >
                {label}
              </button>
            </React.Fragment>
          );
        })}
      </div>
      <div
        ref={columnsRowRef}
        className="bndz-miller-columns flex flex-1 min-h-0 overflow-x-auto bndz-scrollbar bndz-file-list-scroll"
      >
        {columnPaths.map((colPath, colIdx) => {
          const items = pathContentsCache[colPath];
          const loading = items === undefined;
          const colLabel = colPath === '/' ? 'This PC' : colPath.split('/').pop();
          const isFocusCol = colIdx === focusColIdx;
          const colIsDrop = dropHoverPath === colPath;
          return (
            <div
              key={colPath}
              ref={(el) => {
                if (el) colRefs.current.set(colPath, el);
                else colRefs.current.delete(colPath);
              }}
              data-miller-col-path={colPath}
              className={`bndz-miller-col shrink-0 w-[240px] border-r border-white/[0.06] flex flex-col min-h-0 ${
                isFocusCol ? 'bndz-miller-col--focus' : ''
              } ${colIsDrop ? 'bndz-miller-col--drop' : ''}`}
              onMouseDown={() => setFocusColIdx(colIdx)}
            >
              <div className="bndz-miller-col-head shrink-0 px-2 py-1 text-[10px] uppercase tracking-wider text-gray-500 border-b border-white/[0.04] truncate">
                {colLabel}
              </div>
              <div className="flex-1 overflow-y-auto bndz-scrollbar">
                {loading ? (
                  <div className="px-2 py-4 text-[11px] text-gray-500 text-center">Loading…</div>
                ) : (
                  <VirtualizedFileList
                    items={items}
                    threshold={1}
                    rowHeight={28}
                    mode="list"
                    gap={0}
                    emptyState={<div className="px-2 py-4 text-[11px] text-gray-600 text-center">Empty</div>}
                    renderItem={(entity) => {
                      const isDir = entity.type === 'directory';
                      const childPath = entityChildPath(colPath, entity);
                      const cursor = normalizePanePath(cursorPath);
                      const isSelected = cursor === childPath || cursor.startsWith(`${childPath}/`);
                      const displayName = getDisplayName(entity, config as any, colPath);
                      const isDropTarget = dropHoverPath === childPath;
                      return (
                        <div
                          key={String(entity.id)}
                          role="treeitem"
                          aria-selected={isSelected}
                          ref={(el) => {
                            if (el) itemRefs.current.set(childPath, el);
                            else itemRefs.current.delete(childPath);
                          }}
                          data-id={String(entity.id)}
                          data-miller-path={childPath}
                          data-is-dir={isDir ? 'true' : 'false'}
                          className={`fs-item-wrapper bndz-miller-item w-full flex items-center gap-2 px-2 py-1.5 text-left text-[12px] cursor-default ${
                            isSelected ? 'bndz-miller-item--selected' : ''
                          } ${isDropTarget ? 'bndz-miller-item--drop' : ''}`}
                          onClick={() => selectInColumn(colPath, entity)}
                          onDoubleClick={() => selectInColumn(colPath, entity, { openFile: true, openDir: true })}
                          onPointerDown={(ev) => {
                            if ((ev.target as HTMLElement).closest('button, a, input')) return;
                            armItemDrag(ev, colPath, entity, childPath);
                          }}
                        >
                          <ThumbnailIcon entity={entity} isDir={!!isDir} path={childPath} size={16} />
                          <span className="flex-1 truncate pointer-events-none">{displayName}</span>
                          {isDir && <LauncherIcon id="chevron_right" size={12} className="shrink-0 opacity-50 pointer-events-none" />}
                        </div>
                      );
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
