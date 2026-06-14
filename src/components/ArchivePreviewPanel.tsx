import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Archive, Folder, File, Search, Download, Loader2, AlertCircle, HardDrive, Package, Upload, LogOut } from 'lucide-react';
import { toWindowsPath } from '../lib/pathUtils';
import { formatArchiveSize, ArchiveEntry } from '../lib/archiveTypes';

interface ArchivePreviewPanelProps {
  path: string;
  format: string;
  onExtract?: () => void;
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
  const dragEntryRef = useRef<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    import('../lib/ipcBridge').then(({ IPC }) => {
      IPC.getArchiveContents(toWindowsPath(path)).then(data => {
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
  }, [path]);

  useEffect(() => { reload(); }, [reload]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(e => e.path.toLowerCase().includes(q) || e.name.toLowerCase().includes(q));
  }, [entries, search]);

  const ratio = stats.totalSize > 0 ? Math.round((1 - stats.compressed / stats.totalSize) * 100) : 0;
  const isZip = format.toLowerCase() === 'zip';

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
    if (!isZip) {
      setStatus('Drag-in is supported for ZIP archives only.');
      return;
    }
    const files = extractPathsFromDrop(e).filter(p => !p.toLowerCase().endsWith('.zip'));
    if (!files.length) return;
    setBusy('Adding files…');
    setStatus(null);
    try {
      const { IPC } = await import('../lib/ipcBridge');
      const result = await IPC.archiveAddFiles(toWindowsPath(path), files);
      if (result.success) {
        setStatus(`Added ${files.length} file(s) to archive.`);
        reload();
      } else {
        setStatus(result.error || 'Failed to add files.');
      }
    } finally {
      setBusy(null);
    }
  };

  const handleEntryDragStart = (entry: ArchiveEntry, e: React.DragEvent) => {
    if (entry.isDirectory) return;
    dragEntryRef.current = entry.path;
    e.dataTransfer.setData('text/bndz-archive-entry', entry.path);
    e.dataTransfer.setData('text/plain', entry.path);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleEntryDoubleClick = async (entry: ArchiveEntry) => {
    if (entry.isDirectory) return;
    setBusy(`Extracting ${entry.name}…`);
    try {
      const { IPC } = await import('../lib/ipcBridge');
      const dest = toWindowsPath(path).replace(/\\[^\\]+$/, '');
      const result = await IPC.archiveExtractEntry(toWindowsPath(path), entry.path, dest);
      setStatus(result.success ? `Extracted to ${dest}` : (result.error || 'Extract failed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className={`w-full h-full flex flex-col bg-[#0a0a0a] text-gray-200 ${dragOver ? 'ring-2 ring-amber-500/40 ring-inset' : ''}`}
      onDragOver={e => { if (isZip) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDropIn}
    >
      <div className="px-3 py-2 border-b border-[#333] bg-[#141414] shrink-0">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <Archive size={16} className="text-amber-400 shrink-0" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300 truncate">
              {format.toUpperCase()} Archive
            </span>
          </div>
          {onExtract && (
            <button
              type="button"
              onClick={onExtract}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold bg-[#094771] hover:bg-[#0d5f8f] rounded-sm shrink-0"
            >
              <Download size={12} /> Extract All
            </button>
          )}
        </div>
        <div className="flex gap-3 text-[10px] font-mono text-gray-400">
          <span className="flex items-center gap-1"><Package size={10} /> {stats.count} items</span>
          <span className="flex items-center gap-1"><HardDrive size={10} /> {formatArchiveSize(stats.totalSize)}</span>
          {stats.compressed > 0 && <span>~{ratio}% saved</span>}
        </div>
        {isZip && (
          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-200/80 bg-amber-950/20 border border-amber-800/30 rounded px-2 py-1">
            <Upload size={10} /> Drop files here to add · double-click entry to extract · drag entry out
          </div>
        )}
        {(status || busy) && (
          <div className="mt-1 text-[10px] text-gray-400 flex items-center gap-1">
            {busy && <Loader2 size={10} className="animate-spin" />}
            {busy || status}
          </div>
        )}
        <div className="relative mt-2">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter contents..."
            className="w-full pl-7 pr-2 py-1 text-[11px] bg-[#1a1a1a] border border-[#333] rounded-sm outline-none focus:border-[#094771]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto styled-scrollbar">
        {loading && (
          <div className="flex items-center justify-center gap-2 p-8 text-gray-500 text-sm">
            <Loader2 size={16} className="animate-spin" /> Reading archive...
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 p-4 text-red-400 text-xs">
            <AlertCircle size={14} /> {error}
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="p-4 text-gray-500 text-xs italic">No entries found</div>
        )}
        {!loading && !error && filtered.map((entry, i) => (
          <div
            key={`${entry.path}-${i}`}
            draggable={!entry.isDirectory}
            onDragStart={e => handleEntryDragStart(entry, e)}
            onDoubleClick={() => handleEntryDoubleClick(entry)}
            className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#1a1a1a] border-b border-[#1a1a1a] text-[11px] font-mono cursor-pointer group"
            title={entry.isDirectory ? entry.path : `${entry.path} — double-click to extract`}
          >
            {entry.isDirectory
              ? <Folder size={12} className="text-[#dcb67a] shrink-0" />
              : <File size={12} className="text-gray-400 shrink-0 group-hover:text-amber-300" />}
            <span className="flex-1 truncate text-gray-300">{entry.path || entry.name}</span>
            {!entry.isDirectory && (
              <>
                <span className="text-gray-500 shrink-0">{formatArchiveSize(entry.size)}</span>
                <LogOut size={10} className="text-gray-600 opacity-0 group-hover:opacity-100 shrink-0" />
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
