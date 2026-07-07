import React, { useEffect, useMemo, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { toWindowsPath } from '../lib/pathUtils';
import { formatArchiveSize } from '../lib/archiveTypes';

interface TorrentPreviewPanelProps {
  path: string;
}

export default function TorrentPreviewPanel({ path }: TorrentPreviewPanelProps) {
  const [info, setInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    import('../lib/ipcBridge').then(({ IPC }) => {
      IPC.getTorrentInfo(toWindowsPath(path)).then(data => {
        if (!active) return;
        if (data?.error) {
          setError(data.error);
          setInfo(null);
        } else {
          setInfo(data);
        }
        setLoading(false);
      }).catch(err => {
        if (active) { setError(err.message); setLoading(false); }
      });
    });
    return () => { active = false; };
  }, [path]);

  const files = useMemo(() => {
    const list = info?.files || [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((f: any) => (f.path || '').toLowerCase().includes(q));
  }, [info, search]);

  return (
    <div className="w-full h-full flex flex-col bg-[#0a0a0a] text-gray-200">
      <div className="px-3 py-2 border-b border-[#333] bg-[#141414] shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <Icons8Icon id="magnet_ui" size={16} />
          <span className="text-[11px] font-bold uppercase tracking-wider text-violet-300">Torrent</span>
        </div>
        {info?.name && <div className="text-[12px] font-semibold text-white truncate mb-1">{info.name}</div>}
        <div className="flex flex-wrap gap-3 text-[10px] font-mono text-gray-400">
          <span className="flex items-center gap-1"><Icons8Icon id="layers_ui" size={10} /> {info?.fileCount || files.length} files</span>
          <span className="flex items-center gap-1"><Icons8Icon id="disk_mgmt" size={10} /> {formatArchiveSize(info?.totalSize || 0)}</span>
          {info?.pieceCount > 0 && <span>{info.pieceCount} pieces × {formatArchiveSize(info.pieceLength || 0)}</span>}
        </div>
        {info?.announce && (
          <div className="flex items-center gap-1 mt-1 text-[9px] text-gray-500 truncate" title={info.announce}>
            <Icons8Icon id="radio_ui" size={10} /> {info.announce}
          </div>
        )}
        <div className="relative mt-2">
          <Icons8Icon id="search" size={12} className="absolute left-2 top-1/2 -translate-y-1/2 opacity-50" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter files..."
            className="w-full pl-7 pr-2 py-1 text-[11px] bg-[#1a1a1a] border border-[#333] rounded-sm outline-none focus:border-violet-700"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto styled-scrollbar">
        {loading && (
          <div className="flex items-center justify-center gap-2 p-8 text-gray-500 text-sm">
            <Icons8Icon id="loading" size={16} spin /> Parsing torrent...
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 p-4 text-red-400 text-xs">
            <Icons8Icon id="warning" size={14} /> {error}
          </div>
        )}
        {!loading && !error && files.map((f: any, i: number) => (
          <div key={i} className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#1a1a1a] text-[11px] font-mono border-b border-[#1a1a1a]">
            <Icons8Icon id="file_ui" size={12} className="shrink-0" />
            <span className="flex-1 truncate text-gray-300">{f.path}</span>
            <span className="text-gray-500 shrink-0">{formatArchiveSize(f.size || 0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
