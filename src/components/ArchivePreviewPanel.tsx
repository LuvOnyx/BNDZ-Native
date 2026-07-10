import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Icons8Icon, DragHandleGlyph } from './Icons8Icon';
import { toWindowsPath, toVirtualStreamUrl } from '../lib/pathUtils';
import {
  formatArchiveSize,
  ArchiveEntry,
  listArchiveFolder,
  archiveBreadcrumb,
  normalizeArchivePath,
} from '../lib/archiveTypes';

interface ArchivePreviewPanelProps {
  path: string;
  format: string;
  onExtract?: () => void;
}

function entryIcon(entry: ArchiveEntry) {
  if (entry.isDirectory) return <Icons8Icon id="explorer" size={14} className="shrink-0" />;
  const ext = entry.name.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) {
    return <Icons8Icon id="picture_ui" size={14} className="shrink-0" />;
  }
  if (['txt', 'md', 'html', 'htm', 'json', 'xml', 'css', 'js', 'ts'].includes(ext)) {
    return <Icons8Icon id="file_ui" size={14} className="shrink-0" />;
  }
  return <Icons8Icon id="file_ui" size={14} className="shrink-0" />;
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
  const [selected, setSelected] = useState<ArchiveEntry | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const winPath = toWindowsPath(path);
  const fmt = format.toLowerCase();
  const isZip = fmt === 'zip';
  const isRar = fmt === 'rar';
  const canAddFiles = isZip || isRar;
  const isNative = typeof window !== 'undefined' && !!(window as any).chrome?.webview;

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

  const folderItems = useMemo(() => {
    const items = listArchiveFolder(entries, currentFolder);
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(e => e.name.toLowerCase().includes(q) || e.path.toLowerCase().includes(q));
  }, [entries, currentFolder, search]);

  const crumbs = useMemo(() => archiveBreadcrumb(currentFolder), [currentFolder]);
  const ratio = stats.totalSize > 0 ? Math.round((1 - stats.compressed / stats.totalSize) * 100) : 0;

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
      setStatus('Add files: ZIP or RAR (WinRAR required) only.');
      return;
    }
    const files = extractPathsFromDrop(e).filter(p => !p.toLowerCase().endsWith('.zip'));
    if (!files.length) return;
    setBusy('Adding to archive…');
    setStatus(null);
    try {
      const { IPC } = await import('../lib/ipcBridge');
      const prefix = currentFolder ? `${normalizeArchivePath(currentFolder)}/` : '';
      const entryNames = files.map(f => {
        const base = f.split(/[/\\]/).pop() || 'file';
        return prefix + base;
      });
      const result = await IPC.archiveAddFiles(winPath, files, entryNames);
      if (result.success) {
        setStatus(`Added ${files.length} file(s).`);
        reload();
      } else {
        setStatus(result.error || 'Failed to add files.');
      }
    } finally {
      setBusy(null);
    }
  };

  const openEntry = (entry: ArchiveEntry) => {
    setSelected(entry);
    setPreviewUrl(null);
    if (entry.isDirectory) {
      setCurrentFolder(normalizeArchivePath(entry.path));
      setSelected(null);
      return;
    }
    const ext = entry.name.split('.').pop()?.toLowerCase() || '';
    if (isNative && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'pdf', 'html', 'htm', 'txt'].includes(ext)) {
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
    }
  };

  const dragEntryOut = async (entry: ArchiveEntry) => {
    if (entry.isDirectory || !isNative) return;
    setBusy(`Preparing ${entry.name}…`);
    try {
      const { IPC } = await import('../lib/ipcBridge');
      const result = await IPC.archiveExtractEntryToTemp(winPath, entry.path);
      if (result.success && result.path) {
        IPC.startDrag([result.path]);
        setStatus(`Dragging ${entry.name} — drop on desktop or folder.`);
      } else {
        setStatus(result.error || 'Could not extract for drag.');
      }
    } finally {
      setBusy(null);
    }
  };

  const handleEntryMouseDown = (entry: ArchiveEntry, e: React.MouseEvent) => {
    if (entry.isDirectory || !isNative || e.button !== 0) return;
    // Hold + drag initiates native OS drag (FilePilot / Explorer style)
    void dragEntryOut(entry);
  };

  const extractSelected = async () => {
    if (!selected || selected.isDirectory) return;
    setBusy(`Extracting ${selected.name}…`);
    try {
      const { IPC } = await import('../lib/ipcBridge');
      const dest = winPath.replace(/\\[^\\]+$/, '');
      const result = await IPC.archiveExtractEntry(winPath, selected.path, dest);
      setStatus(result.success ? `Extracted to ${dest}` : (result.error || 'Extract failed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className={`w-full h-full flex flex-col bg-gradient-to-b from-[#1a1f2e] to-[#0d1117] text-slate-200 ${dragOver ? 'ring-2 ring-amber-400/50 ring-inset' : ''}`}
      onDragOver={e => { if (canAddFiles) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDropIn}
    >
      {/* Toolbar — WinRAR / WinZip style */}
      <div className="shrink-0 border-b border-white/10 bg-[#232b3b]/90 backdrop-blur-sm">
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500/30 to-orange-600/20 flex items-center justify-center border border-amber-500/30">
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
            <button
              type="button"
              onClick={onExtract}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-[#0067c0] hover:bg-[#0078d4] text-white"
            >
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
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-white/10 ${i === crumbs.length - 1 ? 'text-amber-200 font-medium' : 'text-slate-400'}`}
                onClick={() => { setCurrentFolder(c.path); setSelected(null); setPreviewUrl(null); }}
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
              className="w-full pl-8 pr-2 py-1.5 text-[11px] bg-black/30 border border-white/10 outline-none focus:border-[#0078d4]/50 text-slate-200 placeholder:text-slate-500"
            />
          </div>
        </div>

        {canAddFiles && (
          <div className="mx-3 mb-2 flex items-center gap-2 text-[10px] text-amber-200/90 bg-amber-950/30 border border-amber-700/30 rounded-md px-2 py-1.5">
            <Icons8Icon id="upload" size={11} className="shrink-0" />
            Drop to add · Double-click folders · Mousedown file to drag out
          </div>
        )}
        {(status || busy) && (
          <div className="px-3 pb-2 text-[10px] text-slate-400 flex items-center gap-1.5">
            {busy && <Icons8Icon id="loading" size={11} spin />}
            {busy || status}
          </div>
        )}
      </div>

      {/* Split: file list + preview */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 min-w-0 overflow-y-auto bndz-scrollbar border-r border-white/5">
          {loading && (
            <div className="flex items-center justify-center gap-2 p-10 text-slate-500 text-sm">
              <Icons8Icon id="loading" size={18} spin /> Opening archive…
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 p-4 m-3 text-red-300 text-xs bg-red-950/30 rounded-lg border border-red-800/40">
              <Icons8Icon id="warning" size={14} /> {error}
            </div>
          )}
          {!loading && !error && folderItems.length === 0 && (
            <div className="p-8 text-center text-slate-500 text-xs">This folder is empty</div>
          )}
          {!loading && !error && folderItems.map((entry, i) => {
            const isSel = selected?.path === entry.path;
            return (
              <div
                key={`${entry.path}-${i}`}
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-white/[0.03] group transition-colors ${isSel ? 'bg-[#094771]/40 border-l-2 border-l-[#0078d4]' : 'hover:bg-white/[0.04] border-l-2 border-l-transparent'}`}
                onClick={() => openEntry(entry)}
                onMouseDown={e => handleEntryMouseDown(entry, e)}
                onDoubleClick={() => {
                  if (entry.isDirectory) {
                    openEntry(entry);
                  } else {
                    setSelected(entry);
                    void (async () => {
                      setBusy(`Extracting ${entry.name}…`);
                      try {
                        const { IPC } = await import('../lib/ipcBridge');
                        const dest = winPath.replace(/\\[^\\]+$/, '');
                        const result = await IPC.archiveExtractEntry(winPath, entry.path, dest);
                        setStatus(result.success ? `Extracted to ${dest}` : (result.error || 'Extract failed'));
                      } finally {
                        setBusy(null);
                      }
                    })();
                  }
                }}
              >
                {entryIcon(entry)}
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] text-slate-200 truncate font-medium">{entry.name}</div>
                  {!entry.isDirectory && (
                    <div className="text-[10px] text-slate-500 font-mono">{formatArchiveSize(entry.size)}</div>
                  )}
                </div>
                {!entry.isDirectory && isNative && (
                  <button
                    type="button"
                    title="Drag out to desktop"
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/10 text-slate-400 hover:text-amber-300 transition-opacity"
                    onClick={e => { e.stopPropagation(); void dragEntryOut(entry); }}
                  >
                    <DragHandleGlyph size={14} className="opacity-60" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="w-[42%] min-w-[140px] max-w-[280px] flex flex-col bg-black/20">
          {selected && !selected.isDirectory ? (
            <>
              <div className="px-3 py-2 border-b border-white/5 text-[11px] font-semibold text-slate-300 truncate">
                {selected.name}
              </div>
              <div className="flex-1 min-h-0 overflow-hidden flex items-center justify-center p-2">
                {previewUrl ? (
                  selected.name.match(/\.(png|jpe?g|gif|webp|bmp|svg)$/i) ? (
                    <img src={previewUrl} alt={selected.name} className="max-w-full max-h-full object-contain rounded shadow-lg" />
                  ) : selected.name.match(/\.pdf$/i) ? (
                    <iframe src={previewUrl} className="w-full h-full border-0 rounded" title={selected.name} />
                  ) : selected.name.match(/\.html?$/i) ? (
                    <iframe src={previewUrl} sandbox="allow-same-origin" className="w-full h-full border-0 rounded bg-white" title={selected.name} />
                  ) : (
                    <iframe src={previewUrl} className="w-full h-full border-0 rounded bg-[#0a0a0a]" title={selected.name} />
                  )
                ) : (
                  <div className="text-center p-4 text-slate-500 text-[11px]">
                    <Icons8Icon id="file_ui" size={32} className="mx-auto mb-2 opacity-40" />
                    {formatArchiveSize(selected.size)}
                    <div className="mt-3 flex flex-col gap-1.5">
                      <button type="button" onClick={() => void extractSelected()} className="px-3 py-1.5 rounded bg-[#0067c0] hover:bg-[#0078d4] text-white text-[10px] font-semibold">
                        Extract Here
                      </button>
                      {isNative && (
                        <button type="button" onClick={() => void dragEntryOut(selected)} className="px-3 py-1.5 rounded bg-amber-800/60 hover:bg-amber-700/80 text-amber-100 text-[10px] font-semibold">
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
              <p>Select a file to preview or extract. Navigate folders like a real archive manager.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
