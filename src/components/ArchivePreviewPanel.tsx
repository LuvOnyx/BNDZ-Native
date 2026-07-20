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

interface ArchivePreviewPanelProps {
  path: string;
  format: string;
  onExtract?: () => void;
}

const DRAG_THRESHOLD_PX = 6;

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

  const dragRef = useRef<{ entry: ArchiveEntry; x: number; y: number; active: boolean } | null>(null);

  const winPath = toWindowsPath(path);
  const fmt = format.toLowerCase();
  const canAddFiles = ['zip', 'rar', '7z'].includes(fmt);
  const isNative = typeof window !== 'undefined' && !!(window as any).chrome?.webview;
  const fileName = path.split(/[/\\]/).pop() || 'Archive';

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

  const extractPathsFromDrop = (e: React.DragEvent): string[] => {
    const paths: string[] = [];
    const files = Array.from(e.dataTransfer.files) as Array<File & { path?: string }>;
    for (const file of files) {
      if (file.path) paths.push(file.path);
    }
    const uriList = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (uriList) {
      uriList.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const decoded = decodeURIComponent(trimmed.replace(/^file:\/\/\//i, '').replace(/\//g, '\\'));
        if (decoded) paths.push(decoded);
      });
    }
    return [...new Set(paths)];
  };

  const handleDropIn = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (!canAddFiles) {
      setStatus('Add files: ZIP, 7z, or RAR (WinRAR required).');
      return;
    }
    const sources = extractPathsFromDrop(e);
    if (!sources.length) return;
    setBusy('Adding to archive…');
    setStatus(null);
    try {
      const { IPC } = await import('../lib/ipcBridge');
      const prefix = currentFolder ? `${normalizeArchivePath(currentFolder)}/` : '';
      const entryNames = sources.map(f => {
        const base = f.split(/[/\\]/).pop() || 'file';
        return prefix + base;
      });
      const result = await IPC.archiveAddFiles(winPath, sources, entryNames);
      if (isQueuedIpcResult(result)) {
        setStatus('Add to archive queued — see transfer panel.');
        return;
      }
      if (result.success) {
        setStatus(`Added ${sources.length} item(s).`);
        reload();
      } else {
        setStatus(result.error || 'Failed to add files.');
      }
    } finally {
      setBusy(null);
    }
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

  const dragEntriesOut = async (targets: ArchiveEntry[]) => {
    if (!isNative || !targets.length) return;
    setBusy(`Preparing ${targets.length} item(s)…`);
    try {
      const { IPC } = await import('../lib/ipcBridge');
      const paths: string[] = [];
      for (const entry of targets) {
        const result = await IPC.archiveExtractEntryToTemp(winPath, entry.path);
        if (result.success && result.path) paths.push(result.path);
      }
      if (paths.length) {
        IPC.startDrag(paths);
        setStatus(`Dragging ${paths.length} item(s) — drop on desktop or folder.`);
      } else {
        setStatus('Could not extract for drag.');
      }
    } finally {
      setBusy(null);
    }
  };

  const handleEntryMouseDown = (entry: ArchiveEntry, e: React.MouseEvent) => {
    if (!isNative || e.button !== 0) return;
    dragRef.current = { entry, x: e.clientX, y: e.clientY, active: false };
  };

  const handleEntryMouseMove = (e: React.MouseEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.active) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    drag.active = true;
    dragRef.current = null;
    const dragTargets = selectedPaths.has(drag.entry.path)
      ? folderItems.filter(i => selectedPaths.has(i.path))
      : [drag.entry];
    void dragEntriesOut(dragTargets);
  };

  const handleEntryMouseUp = () => {
    dragRef.current = null;
  };

  const extractSelected = async () => {
    if (!primarySelected || primarySelected.isDirectory) return;
    setBusy(`Extracting ${primarySelected.name}…`);
    try {
      const { IPC } = await import('../lib/ipcBridge');
      const dest = winPath.replace(/\\[^\\]+$/, '');
      const result = await IPC.archiveExtractEntry(winPath, primarySelected.path, dest);
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
      onDragOver={e => { if (canAddFiles) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDropIn}
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
          {onExtract && (
            <button type="button" onClick={onExtract} className="bndz-archive-btn-primary shrink-0">
              <Icons8Icon id="extract" size={13} />
              Extract
            </button>
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
                onClick={e => { selectEntry(entry, e); if (!entry.isDirectory) loadPreview(entry); }}
                onDoubleClick={() => openEntry(entry)}
                onMouseDown={e => handleEntryMouseDown(entry, e)}
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
              Extract here
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
    </div>
  );
}
