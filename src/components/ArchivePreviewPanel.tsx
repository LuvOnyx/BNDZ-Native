import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Icons8Icon, DragHandleGlyph } from './Icons8Icon';
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

function entryIcon(entry: ArchiveEntry) {
  if (entry.isDirectory) return <Icons8Icon id="explorer" size={14} className="shrink-0" />;
  const ext = entry.name.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) {
    return <Icons8Icon id="picture_ui" size={14} className="shrink-0" />;
  }
  if (['mp3', 'wav', 'flac', 'm4a', 'ogg'].includes(ext)) {
    return <Icons8Icon id="music_ui" size={14} className="shrink-0" />;
  }
  if (['txt', 'md', 'html', 'htm', 'json', 'xml', 'css', 'js', 'ts'].includes(ext)) {
    return <Icons8Icon id="file_ui" size={14} className="shrink-0" />;
  }
  return <Icons8Icon id="file_ui" size={14} className="shrink-0" />;
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
  const [open, setOpen] = useState(depth < 2);
  const isActive = currentFolder === node.path;
  const hasKids = node.children.length > 0;

  return (
    <div>
      <button
        type="button"
        className={`w-full flex items-center gap-1 py-1 pr-2 text-left text-[11px] rounded-md transition-colors ${
          isActive ? 'bg-[#094771]/50 text-[#cce4f7]' : 'text-slate-300 hover:bg-white/[0.06]'
        }`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => {
          onSelect(node.path);
          if (hasKids) setOpen(v => !v);
        }}
      >
        {hasKids ? (
          <Icons8Icon id={open ? 'chevron_down' : 'chevron_right'} size={10} className="shrink-0 opacity-60" />
        ) : (
          <span className="w-[10px] shrink-0" />
        )}
        <Icons8Icon id="folder_open_ui" size={11} className="shrink-0 opacity-80" />
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

  const dragRef = useRef<{ entry: ArchiveEntry; x: number; y: number; active: boolean } | null>(null);

  const winPath = toWindowsPath(path);
  const fmt = format.toLowerCase();
  const canAddFiles = ['zip', 'rar', '7z'].includes(fmt);
  const isNative = typeof window !== 'undefined' && !!(window as any).chrome?.webview;

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

  const SortHeader = ({ label, col }: { label: string; col: ArchiveSortKey }) => (
    <button
      type="button"
      className="text-left text-[10px] uppercase tracking-wide text-slate-500 hover:text-slate-300 font-semibold"
      onClick={() => toggleSort(col)}
    >
      {label}{sortKey === col ? (sortAsc ? ' ▲' : ' ▼') : ''}
    </button>
  );

  return (
    <div
      className={`w-full h-full flex flex-col bg-gradient-to-b from-[#1a1f2e] to-[#0d1117] text-slate-200 ${dragOver ? 'ring-2 ring-amber-400/50 ring-inset' : ''}`}
      onDragOver={e => { if (canAddFiles) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDropIn}
      onMouseMove={handleEntryMouseMove}
      onMouseUp={handleEntryMouseUp}
    >
      <div className="shrink-0 border-b border-white/10 bg-[#232b3b]/90 backdrop-blur-sm">
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500/30 to-orange-600/20 flex items-center justify-center border border-amber-500/30">
              <Icons8Icon id="zip" size={16} />
            </div>
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-white truncate">{path.split(/[/\\]/).pop()}</div>
              <div className="text-[10px] text-slate-400 font-mono">
                {format.toUpperCase()} · {stats.count} items · {formatArchiveSize(stats.totalSize)}
                {stats.compressed > 0 && ` · ${ratio}% compression`}
              </div>
            </div>
          </div>
          {onExtract && (
            <button type="button" onClick={onExtract} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-[#0067c0] hover:bg-[#0078d4] text-white rounded-lg">
              <Icons8Icon id="download" size={13} /> Extract All
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 px-3 pb-2 flex-wrap text-[11px]">
          {crumbs.map((c, i) => (
            <React.Fragment key={c.path || 'root'}>
              {i > 0 && <Icons8Icon id="chevron_right" size={10} className="opacity-50" />}
              <button
                type="button"
                className={`flex items-center gap-1 px-2 py-0.5 rounded-lg hover:bg-white/10 ${i === crumbs.length - 1 ? 'text-amber-200 font-medium' : 'text-slate-400'}`}
                onClick={() => navigateFolder(c.path)}
              >
                {i === 0 ? <Icons8Icon id="go_home" size={11} /> : <Icons8Icon id="folder_open_ui" size={11} />}
                {c.label}
              </button>
            </React.Fragment>
          ))}
        </div>

        <div className="px-3 pb-2 flex gap-2">
          <div className="relative flex-1">
            <Icons8Icon id="search" size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-50" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search in archive…"
              className="w-full pl-8 pr-2 py-1.5 text-[11px] bg-black/30 border border-white/10 rounded-lg outline-none focus:border-[#0078d4]/50 text-slate-200 placeholder:text-slate-500"
            />
          </div>
        </div>

        {canAddFiles && (
          <div className="mx-3 mb-2 flex items-center gap-2 text-[10px] text-amber-200/90 bg-amber-950/30 border border-amber-700/30 rounded-lg px-2 py-1.5">
            <Icons8Icon id="upload" size={11} className="shrink-0" />
            Drop files or folders to add · Drag rows out after {DRAG_THRESHOLD_PX}px movement
          </div>
        )}
        {(status || busy) && (
          <div className="px-3 pb-2 text-[10px] text-slate-400 flex items-center gap-1.5">
            {busy && <Icons8Icon id="loading" size={11} spin />}
            {busy || status}
          </div>
        )}
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="w-[168px] shrink-0 border-r border-white/5 overflow-y-auto bndz-scrollbar p-2 bg-black/15">
          <button
            type="button"
            className={`w-full flex items-center gap-1.5 px-2 py-1.5 mb-1 text-[11px] rounded-lg ${!currentFolder ? 'bg-[#094771]/40 text-[#cce4f7]' : 'text-slate-400 hover:bg-white/[0.06]'}`}
            onClick={() => navigateFolder('')}
          >
            <Icons8Icon id="zip" size={11} /> Root
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

        <div className="flex-1 min-w-0 flex flex-col border-r border-white/5">
          <div className="grid grid-cols-[minmax(0,1fr)_72px_72px_108px] gap-2 px-3 py-1.5 border-b border-white/5 bg-black/20 text-[10px]">
            <SortHeader label="Name" col="name" />
            <SortHeader label="Size" col="size" />
            <SortHeader label="Packed" col="compressed" />
            <SortHeader label="Modified" col="modified" />
          </div>
          <div className="flex-1 overflow-y-auto bndz-scrollbar">
            {loading && (
              <div className="flex items-center justify-center gap-2 p-10 text-slate-500 text-sm">
                <Icons8Icon id="loading" size={18} spin /> Opening archive…
              </div>
            )}
            {error && (
              <div className="flex items-center gap-2 p-4 m-3 text-red-300 text-xs bg-red-950/30 rounded-xl border border-red-800/40">
                <Icons8Icon id="warning" size={14} /> {error}
              </div>
            )}
            {!loading && !error && folderItems.length === 0 && (
              <div className="p-8 text-center text-slate-500 text-xs">This folder is empty</div>
            )}
            {!loading && !error && folderItems.map((entry, i) => {
              const isSel = selectedPaths.has(entry.path);
              return (
                <div
                  key={`${entry.path}-${i}`}
                  className={`grid grid-cols-[minmax(0,1fr)_72px_72px_108px] gap-2 items-center px-3 py-1.5 cursor-pointer border-b border-white/[0.03] group transition-colors ${
                    isSel ? 'bg-[#094771]/40 border-l-2 border-l-[#0078d4]' : 'hover:bg-white/[0.04] border-l-2 border-l-transparent'
                  }`}
                  onClick={e => { selectEntry(entry, e); if (!entry.isDirectory) loadPreview(entry); }}
                  onDoubleClick={() => openEntry(entry)}
                  onMouseDown={e => handleEntryMouseDown(entry, e)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {entryIcon(entry)}
                    <span className="text-[12px] text-slate-200 truncate font-medium">{entry.name}</span>
                    {!entry.isDirectory && isNative && (
                      <button
                        type="button"
                        title="Drag out"
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-amber-300 transition-opacity ml-auto"
                        onClick={e => { e.stopPropagation(); void dragEntriesOut([entry]); }}
                      >
                        <DragHandleGlyph size={14} className="opacity-60" />
                      </button>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono text-right">{entry.isDirectory ? '—' : formatArchiveSize(entry.size)}</span>
                  <span className="text-[10px] text-slate-500 font-mono text-right">{entry.isDirectory ? '—' : formatArchiveSize(entry.compressedSize)}</span>
                  <span className="text-[10px] text-slate-500 truncate">{formatModified(entry.modified)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="w-[38%] min-w-[140px] max-w-[300px] flex flex-col bg-black/20">
          {primarySelected && !primarySelected.isDirectory ? (
            <>
              <div className="px-3 py-2 border-b border-white/5 text-[11px] font-semibold text-slate-300 truncate">
                {primarySelected.name}
                {selectedPaths.size > 1 && <span className="text-slate-500 font-normal"> · {selectedPaths.size} selected</span>}
              </div>
              <div className="flex-1 min-h-0 overflow-hidden flex items-center justify-center p-2">
                {previewUrl ? (
                  primarySelected.name.match(/\.(png|jpe?g|gif|webp|bmp|svg)$/i) ? (
                    <img src={previewUrl} alt={primarySelected.name} className="max-w-full max-h-full object-contain rounded-xl shadow-lg" />
                  ) : primarySelected.name.match(/\.(mp3|wav|flac|m4a|ogg)$/i) ? (
                    <audio src={previewUrl} controls className="w-full max-w-[240px]" />
                  ) : primarySelected.name.match(/\.pdf$/i) ? (
                    <iframe src={previewUrl} className="w-full h-full border-0 rounded-xl" title={primarySelected.name} />
                  ) : primarySelected.name.match(/\.html?$/i) ? (
                    <iframe src={previewUrl} sandbox="allow-same-origin" className="w-full h-full border-0 rounded-xl bg-white" title={primarySelected.name} />
                  ) : (
                    <iframe src={previewUrl} className="w-full h-full border-0 rounded-xl bg-[#0a0a0a]" title={primarySelected.name} />
                  )
                ) : (
                  <div className="text-center p-4 text-slate-500 text-[11px]">
                    <Icons8Icon id="file_ui" size={32} className="mx-auto mb-2 opacity-40" />
                    {formatArchiveSize(primarySelected.size)}
                    <div className="mt-3 flex flex-col gap-1.5">
                      <button type="button" onClick={() => void extractSelected()} className="px-3 py-1.5 rounded-lg bg-[#0067c0] hover:bg-[#0078d4] text-white text-[10px] font-semibold">
                        Extract Here
                      </button>
                      {isNative && (
                        <button
                          type="button"
                          onClick={() => void dragEntriesOut(selectedList.length ? selectedList : [primarySelected])}
                          className="px-3 py-1.5 rounded-lg bg-amber-800/60 hover:bg-amber-700/80 text-amber-100 text-[10px] font-semibold"
                        >
                          Drag Out…
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-[11px] p-4 text-center">
              <Icons8Icon id="zip" size={36} className="mb-3 opacity-30" />
              <p>Select files to preview, extract, or drag out. Use the folder tree or breadcrumbs to navigate like WinRAR.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
