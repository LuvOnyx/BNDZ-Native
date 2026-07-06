import React, { useCallback, useEffect, useState } from 'react';
import { Database, FolderOpen, Loader2, RefreshCw } from 'lucide-react';
import { IPC } from '../../lib/ipcBridge';
import { toWindowsPath } from '../../lib/pathUtils';

type IndexStatus = {
  fileCount: number;
  folderCount: number;
  locations: Array<{ path: string; lastIndexed: number }>;
};

type IndexProgress = {
  currentPath: string;
  filesIndexed: number;
  done: boolean;
  root?: string;
};

type Props = {
  onToast?: (msg: string) => void;
};

function formatWhen(ts: number): string {
  if (!ts) return 'Never';
  const d = new Date(ts * 1000);
  return d.toLocaleString();
}

export default function BndzIndexManagerPanel({ onToast }: Props) {
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [progress, setProgress] = useState<IndexProgress | null>(null);
  const [folderPath, setFolderPath] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const notify = (msg: string) => {
    setNotice(msg);
    onToast?.(msg);
  };

  const refresh = useCallback(async () => {
    if (!IPC.isNative) return;
    setLoading(true);
    try {
      const s = await IPC.getIndexStatus();
      setStatus(s);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!IPC.isNative) return;
    return IPC.onIndexProgress(p => {
      setProgress(p);
      if (p.done) {
        setIndexing(false);
        void refresh();
      } else {
        setIndexing(true);
      }
    });
  }, [refresh]);

  const reindexDefaults = async () => {
    setIndexing(true);
    setProgress(null);
    try {
      const res = await IPC.reindexBndzDefaults();
      notify(res.ok ? 'Re-indexing default libraries…' : (res.error || 'Re-index failed'));
      if (!res.ok) setIndexing(false);
    } catch {
      setIndexing(false);
    }
  };

  const indexFolder = async () => {
    const pane = folderPath.trim();
    if (!pane) return;
    setIndexing(true);
    setProgress(null);
    try {
      const res = await IPC.indexBndzLocation(pane.startsWith('/') ? pane : `/${pane.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:')}`);
      notify(res.ok ? 'Folder indexed.' : (res.error || 'Index failed'));
      if (res.ok) {
        setFolderPath('');
        void refresh();
      } else {
        setIndexing(false);
      }
    } catch {
      setIndexing(false);
    }
  };

  if (!IPC.isNative) {
    return <p className="text-[11px] text-gray-500 ml-2">Search index management requires the native BNDZ app.</p>;
  }

  return (
    <div className="ml-2 mb-6 space-y-3">
      <div className="flex items-center gap-2 text-[12px] text-gray-300">
        <Database size={14} className="text-sky-400" />
        <span>
          {(status?.fileCount ?? 0).toLocaleString()} files · {(status?.folderCount ?? 0).toLocaleString()} folders indexed
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="ml-auto p-1 text-gray-500 hover:text-white"
          title="Refresh status"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
      </div>

      {(indexing || progress) && (
        <div className="text-[10px] text-sky-300/90 bg-[#1a1a1a] border border-[#333] rounded px-2 py-1.5 space-y-0.5">
          {indexing && !progress?.done && <Loader2 size={12} className="inline animate-spin mr-1" />}
          <span>
            {progress?.done
              ? `Indexed ${progress.filesIndexed.toLocaleString()} entries`
              : progress
                ? `${progress.filesIndexed.toLocaleString()} indexed — ${toWindowsPath(progress.currentPath).split(/[/\\]/).pop() || '…'}`
                : 'Starting index…'}
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void reindexDefaults()}
          disabled={indexing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] bg-[#094771] hover:bg-[#0a5a8c] text-white disabled:opacity-50"
        >
          {indexing ? <Loader2 size={12} className="animate-spin" /> : <Database size={12} />}
          Re-index default libraries
        </button>
      </div>

      {notice && <p className="text-[10px] text-sky-300/90">{notice}</p>}

      <div className="flex gap-2 max-w-lg">
        <input
          type="text"
          value={folderPath}
          onChange={e => setFolderPath(e.target.value)}
          placeholder="/C:/Users/you/Documents"
          className="flex-1 bg-[#0d0d10] border border-[#333] rounded px-2 py-1.5 text-[11px] text-gray-200 outline-none focus:border-sky-500/40"
        />
        <button
          type="button"
          onClick={() => void indexFolder()}
          disabled={indexing || !folderPath.trim()}
          className="flex items-center gap-1 px-3 py-1.5 text-[11px] bg-[#333] hover:bg-[#3d3d3d] border border-[#454545] text-gray-200 disabled:opacity-40"
        >
          <FolderOpen size={12} /> Index folder
        </button>
      </div>

      {(status?.locations?.length ?? 0) > 0 && (
        <div className="border border-[#333] rounded max-h-[160px] overflow-y-auto bndz-scrollbar">
          <table className="w-full text-[10px] text-left">
            <thead className="bg-[#1a1a1a] text-gray-500 sticky top-0">
              <tr>
                <th className="px-2 py-1 font-medium">Location</th>
                <th className="px-2 py-1 font-medium w-36">Last indexed</th>
              </tr>
            </thead>
            <tbody>
              {status!.locations.map(loc => (
                <tr key={loc.path} className="border-t border-[#2a2a2a] hover:bg-[#252525]">
                  <td className="px-2 py-1 font-mono text-gray-300 truncate max-w-[280px]" title={loc.path}>
                    {toWindowsPath(loc.path)}
                  </td>
                  <td className="px-2 py-1 text-gray-500 whitespace-nowrap">{formatWhen(loc.lastIndexed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
