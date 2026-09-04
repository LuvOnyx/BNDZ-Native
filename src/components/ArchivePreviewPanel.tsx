import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Icons8Icon, DragHandleGlyph } from './Icons8Icon';
import { launcherIconUrl } from '../lib/toolbarLauncherIcons';
import { toWindowsPath, toVirtualStreamUrl } from '../lib/pathUtils';
import {
  formatArchiveSize,
  ArchiveEntry,
  listArchiveFolder,
  archiveBreadcrumb,
  normalizeArchivePath,
  buildArchiveFolderTree,
  sortArchiveEntries,
  type ArchiveSortKey,
  type ArchiveTreeNode,
} from '../lib/archiveTypes';
import { isQueuedIpcResult } from '../lib/transferIpc';
import {
  dispatchPointerFileDragMove,
  dispatchPointerFileDragActive,
  POINTER_FILE_DRAG_MOVE,
} from '../lib/pointerFileDragBridge';
import {
  beginFileDragSession,
  endFileDragSession,
  getFileDragSession,
  hitTestArchiveRootAtPoint,
  hitTestListBodyAtPoint,
  isInternalFileDragChromeAtPoint,
  stashOleDragSession,
  shouldTriggerOutboundOleBoundaryHandoff,
} from '../lib/fileDragSession';
import { performOutboundOleBoundaryHandoff } from '../lib/nativeOleFileDrag';
import { setDragGhostPosition, armDragGhost } from '../lib/pointerDragGhost';
import { onHostOleDragEscalated } from '../lib/fileDragUiCleanup';
import { IPC } from '../lib/ipcBridge';
import DragGhostPortal from './DragGhostPortal';
import { prefetchArchiveEntryTemp, resolveArchiveEntryTempPaths } from '../lib/archiveExtractCache';

interface ArchivePreviewPanelProps {
  path: string;
  format: string;
  /** Browse for destination, then extract whole archive. */
  onExtract?: () => void;
}

const DRAG_THRESHOLD_PX = 4;

type ArchiveDragState = {
  entry: ArchiveEntry;
  startX: number;
  startY: number;
  x: number;
  y: number;
  paths?: string[];
  preparing?: boolean;
  active?: boolean;
  overInternal?: boolean;
  label: string;
  count: number;
};

function FormatGlyph({ format, size = 22 }: { format: string; size?: number }) {
  const fmt = format.toLowerCase();
  const iconId = fmt === 'rar' || fmt === '7z' || fmt === 'zip' ? 'compress' : 'compress';
  const src = launcherIconUrl(iconId) || launcherIconUrl('zip');
  return (
    <div className="bndz-archive-hero-icon" aria-hidden>
      {src ? (
        <img src={src} alt="" draggable={false} style={{ width: size, height: size }} />
      ) : (
        <Icons8Icon id="compress" size={size} />
      )}
    </div>
  );
}

function entryIcon(entry: ArchiveEntry) {
  if (entry.isDirectory) return <Icons8Icon id="folder_open_ui" size={15} className="shrink-0" />;
  const ext = entry.name.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) {
    return <Icons8Icon id="picture_ui" size={15} className="shrink-0" />;
  }
  if (['mp3', 'wav', 'flac', 'm4a', 'ogg'].includes(ext)) {
    return <Icons8Icon id="music_ui" size={15} className="shrink-0" />;
  }
  if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) {
    return <Icons8Icon id="film_ui" size={15} className="shrink-0" />;
  }
  return <Icons8Icon id="file_ui" size={15} className="shrink-0" />;
}

function formatModified(value?: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function ArchiveTreeItem({
  node,
  depth,
  currentFolder,
  onSelect,
}: {
  node: ArchiveTreeNode;
  depth: number;
  currentFolder: string;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const isActive = currentFolder === node.path;
  const hasKids = node.children.length > 0;

  return (
    <div>
      <button
        type="button"
        className={`bndz-archive-tree-row ${isActive ? 'bndz-archive-tree-row--active' : ''}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => {
          onSelect(node.path);
          if (hasKids) setOpen(v => !v);
        }}
      >
        {hasKids ? (
          <Icons8Icon id={open ? 'chevron_down' : 'chevron_right'} size={10} className="shrink-0 opacity-55" />
        ) : (
          <span className="w-[10px] shrink-0" />
        )}
        <Icons8Icon id="folder_open_ui" size={12} className="shrink-0 opacity-80" />
        <span className="truncate">{node.name}</span>
      </button>
      {open && hasKids && node.children.map(child => (
        <ArchiveTreeItem
          key={child.path}
          node={child}
          depth={depth + 1}
          currentFolder={currentFolder}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export default function ArchivePreviewPanel({ path, format, onExtract }: ArchivePreviewPanelProps) {
  const [entries, setEntries] = useState<ArchiveEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState({ count: 0, totalSize: 0, compressed: 0 });
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [currentFolder, setCurrentFolder] = useState('');
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [anchorPath, setAnchorPath] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<ArchiveSortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [showTree, setShowTree] = useState(false);

  const dragRef = useRef<ArchiveDragState | null>(null);
  const archiveDragGhostElRef = useRef<HTMLDivElement | null>(null);
  const suppressArchiveClickRef = useRef(false);
  const [archiveDragGhost, setArchiveDragGhost] = useState<{
    label: string;
    count: number;
    preparing?: boolean;
  } | null>(null);

  const winPath = toWindowsPath(path);
  const fmt = format.toLowerCase();
  const canAddFiles = ['zip', 'rar', '7z'].includes(fmt);
  const isNative = typeof window !== 'undefined' && !!(window as any).chrome?.webview;
  const fileName = path.split(/[/\\]/).pop() || 'Archive';

  useEffect(() => {
    const syncDragOver = (clientX: number, clientY: number) => {
      const el = hitTestArchiveRootAtPoint(clientX, clientY);
      setDragOver(!!el && el.getAttribute('data-archive-path') === winPath);
    };
    const onExternalHover = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const clientX = typeof detail.webViewX === 'number' ? detail.webViewX : null;
      const clientY = typeof detail.webViewY === 'number' ? detail.webViewY : null;
      if (clientX == null || clientY == null) return;
      syncDragOver(clientX, clientY);
    };
    const onPointerMove = (e: Event) => {
      const { clientX, clientY } = (e as CustomEvent<{ clientX: number; clientY: number }>).detail;
      syncDragOver(clientX, clientY);
    };
    window.addEventListener('bndz-external-drag-hover', onExternalHover);
    window.addEventListener(POINTER_FILE_DRAG_MOVE, onPointerMove);
    return () => {
      window.removeEventListener('bndz-external-drag-hover', onExternalHover);
      window.removeEventListener(POINTER_FILE_DRAG_MOVE, onPointerMove);
    };
  }, [winPath]);

  const selectedList = useMemo(
    () => entries.filter(e => selectedPaths.has(e.path)),
    [entries, selectedPaths],
  );
  const primarySelected = selectedList[selectedList.length - 1] ?? null;

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    import('../lib/ipcBridge').then(({ IPC }) => {
      IPC.getArchiveContents(winPath).then(data => {
        if (data?.error) {
          setError(data.error);
          setEntries([]);
        } else {
          setEntries(data?.entries || []);
          setStats({
            count: data?.entryCount || data?.entries?.length || 0,
            totalSize: data?.totalSize || 0,
            compressed: data?.totalCompressedSize || 0,
          });
        }
        setLoading(false);
      }).catch(err => {
        setError(err.message || 'Failed to read archive');
        setLoading(false);
      });
    });
  }, [winPath]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    const onReload = (e: Event) => {
      const detailPath = (e as CustomEvent).detail?.path;
      if (!detailPath || toWindowsPath(detailPath).toLowerCase() === winPath.toLowerCase()) reload();
    };
    window.addEventListener('bndz-archive-reload', onReload);
    return () => window.removeEventListener('bndz-archive-reload', onReload);
  }, [reload, winPath]);

  const folderTree = useMemo(() => buildArchiveFolderTree(entries), [entries]);

  const folderItems = useMemo(() => {
    let items = listArchiveFolder(entries, currentFolder);
    const q = search.trim().toLowerCase();
    if (q) items = items.filter(e => e.name.toLowerCase().includes(q) || e.path.toLowerCase().includes(q));
    return sortArchiveEntries(items, sortKey, sortAsc);
  }, [entries, currentFolder, search, sortKey, sortAsc]);

  const crumbs = useMemo(() => archiveBreadcrumb(currentFolder), [currentFolder]);
  const ratio = stats.totalSize > 0 ? Math.round((1 - stats.compressed / stats.totalSize) * 100) : 0;

  const navigateFolder = (folderPath: string) => {
    setCurrentFolder(normalizeArchivePath(folderPath));
    setSelectedPaths(new Set());
    setAnchorPath(null);
    setPreviewUrl(null);
  };

  const toggleSort = (key: ArchiveSortKey) => {
    if (sortKey === key) setSortAsc(v => !v);
    else { setSortKey(key); setSortAsc(true); }
  };

  const selectEntry = (entry: ArchiveEntry, e: React.MouseEvent) => {
    if (e.shiftKey && anchorPath) {
      const paths = folderItems.map(i => i.path);
      const a = paths.indexOf(anchorPath);
      const b = paths.indexOf(entry.path);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelectedPaths(new Set(paths.slice(lo, hi + 1)));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedPaths(prev => {
        const next = new Set(prev);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        return next;
      });
      setAnchorPath(entry.path);
      return;
    }
    setSelectedPaths(new Set([entry.path]));
    setAnchorPath(entry.path);
  };

  const loadPreview = (entry: ArchiveEntry) => {
    setPreviewUrl(null);
    const ext = entry.name.split('.').pop()?.toLowerCase() || '';
    if (!isNative || entry.isDirectory) return;
    if (!['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'pdf', 'html', 'htm', 'txt', 'mp3', 'wav', 'flac', 'm4a', 'ogg'].includes(ext)) return;
    void (async () => {
      setBusy(`Loading ${entry.name}…`);
      try {
        const { IPC } = await import('../lib/ipcBridge');
        const result = await IPC.archiveExtractEntryToTemp(winPath, entry.path);
        if (result.success && result.path) {
          setPreviewUrl(toVirtualStreamUrl(result.path));
        }
      } finally {
        setBusy(null);
      }
    })();
  };

  const openEntry = (entry: ArchiveEntry) => {
    if (entry.isDirectory) {
      navigateFolder(entry.path);
      return;
    }
    loadPreview(entry);
  };

  const prepareArchiveDragPaths = async (targets: ArchiveEntry[]): Promise<string[]> =>
    resolveArchiveEntryTempPaths(winPath, targets.map(t => t.path));

  const commitArchiveInternalDrop = (paths: string[], clientX: number, clientY: number) => {
    endFileDragSession();
    setArchiveDragGhost(null);
    window.dispatchEvent(new CustomEvent('bndz-archive-drop', {
      detail: { paths, clientX, clientY, op: 'copy' },
    }));
    setStatus(`Dropping ${paths.length} item(s) into folder…`);
  };

  const dragEntriesOut = async (targets: ArchiveEntry[]) => {
    if (!targets.length) return;
    setStatus('Use drag on a row to extract to desktop or another folder.');
  };

  const handleEntryPointerDown = (entry: ArchiveEntry, e: React.PointerEvent) => {
    if (!isNative || e.button !== 0) return;
    suppressArchiveClickRef.current = false;
    const dragTargets = selectedPaths.has(entry.path)
      ? folderItems.filter(i => selectedPaths.has(i.path))
      : [entry];
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !selectedPaths.has(entry.path)) {
      setSelectedPaths(new Set([entry.path]));
      setAnchorPath(entry.path);
    }
    for (const target of dragTargets) {
      void prefetchArchiveEntryTemp(winPath, target.path);
    }
    const startX = e.clientX;
    const startY = e.clientY;
    const capturePointerId = e.pointerId;
    dragRef.current = {
      entry,
      startX,
      startY,
      x: startX,
      y: startY,
      label: entry.name,
      count: dragTargets.length,
    };

    let oleDragStarted = false;
    let hostOleEscalated = false;
    let pathsPromise: Promise<string[]> | null = null;
    let boundaryHandoffDone = false;
    let prevClientX = startX;
    let prevClientY = startY;
    const captureEl = e.currentTarget as HTMLElement;

    const captureOpts = { capture: true } as const;

    const cleanupListeners = (onMove: (ev: PointerEvent) => void, onUp: (ev: PointerEvent) => void, onCancel?: (ev: PointerEvent) => void) => {
      document.removeEventListener('pointermove', onMove, captureOpts);
      document.removeEventListener('pointerup', onUp, captureOpts);
      document.removeEventListener('pointercancel', onCancel ?? onUp, captureOpts);
      window.removeEventListener('bndz-ole-drag-escalated', onHostOleEscalate);
    };

    const onHostOleEscalate = () => {
      if (oleDragStarted) return;
      const drag = dragRef.current;
      if (!drag?.paths?.length) return;
      hostOleEscalated = true;
      oleDragStarted = true;
      stashOleDragSession({
        paths: drag.paths,
        op: 'copy',
        sourcePaneId: 'archive-preview',
        sourceTabPath: winPath,
      });
      endFileDragSession();
      setArchiveDragGhost(null);
      onHostOleDragEscalated();
      dispatchPointerFileDragActive(false);
      cleanupListeners(onMove, onUp, onCancel);
      dragRef.current = null;
    };

    window.addEventListener('bndz-ole-drag-escalated', onHostOleEscalate);

    const showArchiveGhost = (drag: ArchiveDragState, preparing: boolean) => {
      armDragGhost(
        setArchiveDragGhost,
        {
          label: drag.label,
          count: drag.count,
          preparing,
        },
        archiveDragGhostElRef.current,
        drag.x,
        drag.y,
      );
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== capturePointerId) return;
      const drag = dragRef.current;
      if (!drag || oleDragStarted) return;
      drag.x = ev.clientX;
      drag.y = ev.clientY;

      if (!drag.active && !drag.preparing) {
        const dx = ev.clientX - drag.startX;
        const dy = ev.clientY - drag.startY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        drag.preparing = true;
        suppressArchiveClickRef.current = true;
        ev.stopPropagation();
        const targets = selectedPaths.has(drag.entry.path)
          ? folderItems.filter(i => selectedPaths.has(i.path))
          : [drag.entry];
        drag.count = targets.length;
        drag.label = targets.length === 1
          ? targets[0].name
          : `${targets[0].name} +${targets.length - 1}`;
        showArchiveGhost(drag, false);
        dispatchPointerFileDragActive(true);
        pathsPromise = prepareArchiveDragPaths(targets);
        void pathsPromise.then(paths => {
          const live = dragRef.current;
          if (!live || live.entry.path !== drag.entry.path || oleDragStarted) return;
          if (!paths.length) {
            setStatus('Could not extract for drag.');
            dragRef.current = null;
            setArchiveDragGhost(null);
            dispatchPointerFileDragActive(false);
            endFileDragSession();
            return;
          }
          live.paths = paths;
          live.preparing = false;
          live.active = true;
          beginFileDragSession({
            paths,
            op: 'copy',
            sourcePaneId: 'archive-preview',
            sourceTabPath: winPath,
          });
          IPC.notifyFileDragActive(true, paths);
          // Keep archive ghost in-app; OLE starts at window boundary.
          showArchiveGhost(live, false);
        }).catch(() => {
          setStatus('Could not extract for drag.');
          dragRef.current = null;
          setArchiveDragGhost(null);
          dispatchPointerFileDragActive(false);
          IPC.notifyFileDragActive(false);
          endFileDragSession();
        });
      }

      if (drag.preparing || drag.active) {
        setDragGhostPosition(archiveDragGhostElRef.current, ev.clientX, ev.clientY);
        dispatchPointerFileDragMove(ev.clientX, ev.clientY);
      }

      if (!drag.paths?.length) return;
      if (hostOleEscalated || oleDragStarted) return;

      if (
        !boundaryHandoffDone
        && IPC.isNative
        && shouldTriggerOutboundOleBoundaryHandoff(
          ev.clientX,
          ev.clientY,
          prevClientX,
          prevClientY,
          ev.screenX,
          ev.screenY,
        )
      ) {
        boundaryHandoffDone = true;
        performOutboundOleBoundaryHandoff({
          paths: drag.paths,
          pointerId: capturePointerId,
          captureEl,
          hideGhost: () => setArchiveDragGhost(null),
          why: 'archive-boundary',
        });
      }
      prevClientX = ev.clientX;
      prevClientY = ev.clientY;
    };

    const onUp = async (ev: PointerEvent) => {
      if (ev.pointerId !== capturePointerId) return;
      cleanupListeners(onMove, onUp, onCancel);
      dispatchPointerFileDragActive(false);
      if (!oleDragStarted) IPC.notifyFileDragActive(false);
      if (oleDragStarted) {
        dragRef.current = null;
        setArchiveDragGhost(null);
        endFileDragSession();
        return;
      }

      const drag = dragRef.current;
      dragRef.current = null;
      setArchiveDragGhost(null);

      let paths = drag?.paths;
      if (!paths?.length && pathsPromise) {
        paths = (await pathsPromise) || undefined;
      }
      if (!paths?.length) {
        endFileDragSession();
        return;
      }

      const travelPx = Math.hypot(ev.clientX - drag!.startX, ev.clientY - drag!.startY);
      if (travelPx < DRAG_THRESHOLD_PX) {
        endFileDragSession();
        return;
      }

      if (hitTestListBodyAtPoint(ev.clientX, ev.clientY)
        || isInternalFileDragChromeAtPoint(ev.clientX, ev.clientY)) {
        commitArchiveInternalDrop(paths, ev.clientX, ev.clientY);
        return;
      }

      endFileDragSession();
    };

    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== capturePointerId) return;
      if (oleDragStarted || hostOleEscalated) return;
      void onUp(ev);
    };

    document.addEventListener('pointermove', onMove, captureOpts);
    document.addEventListener('pointerup', onUp, captureOpts);
    document.addEventListener('pointercancel', onCancel, captureOpts);
  };

  const handleEntryMouseMove = () => {
    /* pointer session on window handles archive drag */
  };

  const handleEntryMouseUp = () => {
    /* pointer session on window handles archive drag */
  };

  const extractSelected = async () => {
    if (!primarySelected) return;
    setBusy(`Extracting ${primarySelected.name}…`);
    try {
      const { IPC } = await import('../lib/ipcBridge');
      const dest = await IPC.openFolderDialog('Extract selected archive items to…');
      if (!dest) {
        setStatus('Extract cancelled.');
        return;
      }
      const result = await IPC.archiveExtractEntry(winPath, primarySelected.path, dest);
      if (isQueuedIpcResult(result)) {
        setStatus('Extract queued — see Background processing.');
        return;
      }
      setStatus(result.success ? `Extracted to ${dest}` : (result.error || 'Extract failed'));
    } finally {
      setBusy(null);
    }
  };

  const SortHeader = ({ label, col, className = '' }: { label: string; col: ArchiveSortKey; className?: string }) => (
    <button
      type="button"
      className={`bndz-archive-sort-btn ${className}`}
      onClick={() => toggleSort(col)}
    >
      {label}
      {sortKey === col ? (
        <span className="bndz-archive-sort-caret" aria-hidden>{sortAsc ? '▲' : '▼'}</span>
      ) : null}
    </button>
  );

  const inspectorOpen = !!(primarySelected && !primarySelected.isDirectory);

  return (
    <div
      className={`bndz-archive-root ${dragOver ? 'bndz-archive-root--drop' : ''} ${inspectorOpen ? 'bndz-archive-root--inspector' : ''}`}
      data-archive-path={winPath}
      onMouseMove={handleEntryMouseMove}
      onMouseUp={handleEntryMouseUp}
    >
      {/* Header */}
      <header className="bndz-archive-header">
        <div className="bndz-archive-header-top">
          <FormatGlyph format={fmt} size={20} />
          <div className="bndz-archive-title-block min-w-0 flex-1">
            <div className="bndz-archive-title truncate" title={fileName}>{fileName}</div>
            <div className="bndz-archive-meta">
              <span className="bndz-archive-chip">{format.toUpperCase()}</span>
              <span>{stats.count.toLocaleString()} items</span>
              <span>{formatArchiveSize(stats.totalSize)}</span>
              {stats.compressed > 0 && <span>{ratio}% packed</span>}
            </div>
          </div>
          {(onExtract) && (
            <div className="flex items-center gap-1.5 shrink-0">
              <button type="button" onClick={onExtract} className="bndz-archive-btn-primary shrink-0" title="Choose a folder…">
                <Icons8Icon id="extract" size={13} />
                Extract…
              </button>
            </div>
          )}
        </div>

        <nav className="bndz-archive-crumbs" aria-label="Archive path">
          {crumbs.map((c, i) => (
            <React.Fragment key={c.path || 'root'}>
              {i > 0 && <Icons8Icon id="chevron_right" size={9} className="bndz-archive-crumb-sep" />}
              <button
                type="button"
                className={`bndz-archive-crumb ${i === crumbs.length - 1 ? 'bndz-archive-crumb--current' : ''}`}
                onClick={() => navigateFolder(c.path)}
              >
                {i === 0 ? <Icons8Icon id="go_home" size={11} /> : null}
                <span className="truncate">{c.label}</span>
              </button>
            </React.Fragment>
          ))}
        </nav>

        <div className="bndz-archive-toolbar">
          <div className="bndz-archive-search">
            <Icons8Icon id="search" size={12} className="bndz-archive-search-icon" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter entries…"
              className="bndz-archive-search-input"
            />
          </div>
          {folderTree.length > 0 && (
            <button
              type="button"
              className={`bndz-archive-btn-ghost ${showTree ? 'is-active' : ''}`}
              onClick={() => setShowTree(v => !v)}
              title="Toggle folder tree"
            >
              <Icons8Icon id="columns_ui" size={13} />
              Folders
            </button>
          )}
        </div>

        {canAddFiles && (
          <div className="bndz-archive-hint">
            <Icons8Icon id="upload" size={11} className="shrink-0 opacity-70" />
            Drop files to add · Drag rows out to extract
          </div>
        )}
        {(status || busy) && (
          <div className="bndz-archive-status">
            {busy && <Icons8Icon id="loading" size={11} spin />}
            <span className="truncate">{busy || status}</span>
          </div>
        )}
      </header>

      {/* Optional folder tree (collapsible, not a side column) */}
      {showTree && (
        <div className="bndz-archive-tree">
          <button
            type="button"
            className={`bndz-archive-tree-row ${!currentFolder ? 'bndz-archive-tree-row--active' : ''}`}
            onClick={() => navigateFolder('')}
          >
            <Icons8Icon id="compress" size={12} />
            Archive root
          </button>
          {folderTree.map(node => (
            <ArchiveTreeItem
              key={node.path}
              node={node}
              depth={0}
              currentFolder={currentFolder}
              onSelect={navigateFolder}
            />
          ))}
        </div>
      )}

      {/* File list */}
      <div className="bndz-archive-list">
        <div className="bndz-archive-list-head">
          <SortHeader label="Name" col="name" className="bndz-archive-col-name" />
          <SortHeader label="Size" col="size" className="bndz-archive-col-size" />
          <SortHeader label="Packed" col="compressed" className="bndz-archive-col-packed" />
        </div>
        <div className="bndz-archive-list-body bndz-scrollbar">
          {loading && (
            <div className="bndz-archive-empty">
              <Icons8Icon id="loading" size={18} spin />
              Opening archive…
            </div>
          )}
          {error && (
            <div className="bndz-archive-error">
              <Icons8Icon id="warning" size={14} />
              <span>{error}</span>
            </div>
          )}
          {!loading && !error && folderItems.length === 0 && (
            <div className="bndz-archive-empty">This folder is empty</div>
          )}
          {!loading && !error && folderItems.map((entry, i) => {
            const isSel = selectedPaths.has(entry.path);
            return (
              <div
                key={`${entry.path}-${i}`}
                className={`bndz-archive-row ${isSel ? 'bndz-archive-row--selected' : ''}`}
                onClick={e => {
                  if (suppressArchiveClickRef.current) {
                    suppressArchiveClickRef.current = false;
                    e.stopPropagation();
                    return;
                  }
                  selectEntry(entry, e);
                  if (!entry.isDirectory) loadPreview(entry);
                }}
                onDoubleClick={() => openEntry(entry)}
                onPointerDown={e => handleEntryPointerDown(entry, e)}
              >
                <div className="bndz-archive-col-name flex items-center gap-2 min-w-0">
                  {entryIcon(entry)}
                  <span className="truncate text-[12px] font-medium text-white/90">{entry.name}</span>
                  {!entry.isDirectory && isNative && (
                    <button
                      type="button"
                      title="Drag out"
                      className="bndz-archive-drag-handle"
                      onClick={e => { e.stopPropagation(); void dragEntriesOut([entry]); }}
                    >
                      <DragHandleGlyph size={12} />
                    </button>
                  )}
                </div>
                <span className="bndz-archive-col-size">
                  {entry.isDirectory ? '—' : formatArchiveSize(entry.size)}
                </span>
                <span className="bndz-archive-col-packed">
                  {entry.isDirectory ? '—' : formatArchiveSize(entry.compressedSize)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom inspector — replaces cramped side panel */}
      {inspectorOpen && primarySelected && (
        <aside className="bndz-archive-inspector">
          <div className="bndz-archive-inspector-head">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-semibold text-white/95 truncate">{primarySelected.name}</div>
              <div className="text-[10px] text-white/40 mt-0.5">
                {formatArchiveSize(primarySelected.size)}
                {primarySelected.compressedSize > 0 && ` · packed ${formatArchiveSize(primarySelected.compressedSize)}`}
                {primarySelected.modified && ` · ${formatModified(primarySelected.modified)}`}
                {selectedPaths.size > 1 && ` · ${selectedPaths.size} selected`}
              </div>
            </div>
            <button
              type="button"
              className="bndz-archive-btn-ghost"
              onClick={() => { setSelectedPaths(new Set()); setPreviewUrl(null); }}
              title="Close inspector"
            >
              <Icons8Icon id="close" size={12} />
            </button>
          </div>
          <div className="bndz-archive-inspector-body">
            {previewUrl ? (
              primarySelected.name.match(/\.(png|jpe?g|gif|webp|bmp|svg)$/i) ? (
                <img src={previewUrl} alt={primarySelected.name} className="bndz-archive-preview-media" />
              ) : primarySelected.name.match(/\.(mp3|wav|flac|m4a|ogg)$/i) ? (
                <audio src={previewUrl} controls className="w-full max-w-[280px]" />
              ) : primarySelected.name.match(/\.pdf$/i) ? (
                <iframe src={previewUrl} className="bndz-archive-preview-frame" title={primarySelected.name} />
              ) : primarySelected.name.match(/\.html?$/i) ? (
                <iframe src={previewUrl} sandbox="allow-same-origin" className="bndz-archive-preview-frame bndz-archive-preview-frame--light" title={primarySelected.name} />
              ) : (
                <iframe src={previewUrl} className="bndz-archive-preview-frame" title={primarySelected.name} />
              )
            ) : (
              <div className="bndz-archive-inspector-placeholder">
                <Icons8Icon id="file_ui" size={28} className="opacity-40 mb-2" />
                <p>No inline preview for this type</p>
              </div>
            )}
          </div>
          <div className="bndz-archive-inspector-actions">
            <button type="button" onClick={() => void extractSelected()} className="bndz-archive-btn-primary">
              <Icons8Icon id="extract" size={12} />
              Extract…
            </button>
            {isNative && (
              <button
                type="button"
                onClick={() => void dragEntriesOut(selectedList.length ? selectedList : [primarySelected])}
                className="bndz-archive-btn-secondary"
              >
                <Icons8Icon id="external_link" size={12} />
                Drag out…
              </button>
            )}
          </div>
        </aside>
      )}
      <DragGhostPortal ghost={archiveDragGhost} ghostRef={archiveDragGhostElRef} />
    </div>
  );
}
