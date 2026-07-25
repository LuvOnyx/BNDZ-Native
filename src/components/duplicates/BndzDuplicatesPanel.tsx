import React, { useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { toWindowsPath } from '../../lib/pathUtils';
import RedundancyGroupsView from '../../spacedrive/port/RedundancyGroupsView';

type DupGroup = { hash?: string; size?: number; paths?: string[] };

type Props = {
  folderPath: string;
  onReveal?: (path: string) => void;
};

export default function BndzDuplicatesPanel({ folderPath, onReveal }: Props) {
  const [groups, setGroups] = useState<DupGroup[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ percent: number; currentPath: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minKb, setMinKb] = useState(64);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!IPC.isNative) return;
    return IPC.onDuplicateScanProgress(p => {
      setProgress({ percent: p.percent, currentPath: p.currentPath });
    });
  }, []);

  const runScan = async () => {
    if (!folderPath || folderPath.startsWith('/bndz')) {
      setError('Open a real folder first, then scan for duplicates.');
      return;
    }
    setScanning(true);
    setError(null);
    setGroups([]);
    setProgress(null);
    try {
      const win = toWindowsPath(folderPath);
      const result = await IPC.scanDuplicates(win, true, minKb * 1024);
      if (result.error) setError(result.error);
      setGroups(result.groups || []);
    } catch (err: any) {
      setError(err?.message || 'Scan failed');
    } finally {
      setScanning(false);
      setProgress(null);
    }
  };

  const deleteExtras = async () => {
    const extras = groups.flatMap(g => (g.paths || []).slice(1));
    if (!extras.length) {
      setError('No duplicate extras to delete.');
      return;
    }
    if (!window.confirm(`Move ${extras.length} duplicate file(s) to the Recycle Bin? The first copy in each group is kept.`)) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const opId = `dup-delete-${Date.now()}`;
      const result = await IPC.executeFsOperation(opId, 'delete', extras, '', false, 'Delete duplicate extras');
      if (!result?.ok) {
        setError(result?.error || 'Delete failed');
        return;
      }
      setGroups(prev => prev
        .map(g => ({ ...g, paths: (g.paths || []).slice(0, 1) }))
        .filter(g => (g.paths?.length || 0) > 0));
    } catch (err: any) {
      setError(err?.message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const cancel = () => {
    IPC.cancelDuplicateScan();
    setScanning(false);
    setProgress(null);
  };

  const formatSize = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
    return `${(n / 1024 ** 3).toFixed(2)} GB`;
  };

  const wasted = groups.reduce((s, g) => {
    const n = g.paths?.length || 0;
    const sz = g.size || 0;
    return s + (n > 1 ? sz * (n - 1) : 0);
  }, 0);

  return (
    <div className="flex flex-col gap-3 min-h-[240px]">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void runScan()}
          disabled={scanning}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-[#094771] hover:bg-[#0a5a8c] text-white disabled:opacity-50"
        >
          {scanning ? <Icons8Icon id="loading" size={14} spin /> : <Icons8Icon id="search" size={14} />}
          Scan folder
        </button>
        {groups.some(g => (g.paths?.length || 0) > 1) && (
          <button
            type="button"
            onClick={() => void deleteExtras()}
            disabled={scanning || deleting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-[#5a1d1d] hover:bg-[#7a2828] text-white disabled:opacity-50"
          >
            {deleting ? <Icons8Icon id="loading" size={14} spin /> : <Icons8Icon id="trash" size={14} />}
            Delete extras
          </button>
        )}
        {scanning && (
          <button type="button" onClick={cancel} className="text-[11px] text-gray-400 hover:text-white px-2 py-1">
            Cancel
          </button>
        )}
        <label className="flex items-center gap-1 text-[11px] text-gray-400 ml-auto">
          Min size (KB)
          <input
            type="number"
            value={minKb}
            onChange={e => setMinKb(Math.max(1, parseInt(e.target.value, 10) || 64))}
            className="w-16 bg-[#252525] border border-[#454545] px-1 py-0.5 text-gray-200 text-right"
            disabled={scanning}
          />
        </label>
      </div>

      {scanning && progress && (
        <div className="text-[10px] text-gray-400 truncate">
          {progress.percent}% — {progress.currentPath}
        </div>
      )}

      {error && <p className="text-[11px] text-red-400">{error}</p>}

      <div className="flex-1 overflow-y-auto bndz-scrollbar border border-[#454545] bg-[#252525] max-h-[360px]">
        <RedundancyGroupsView
          groups={groups}
          onReveal={onReveal}
          wastedBytes={wasted}
        />
        {!scanning && groups.length === 0 && !error && (
          <p className="text-[11px] text-gray-500 p-3">No scan yet. Uses SHA-256 — native, no external tools.</p>
        )}
      </div>
    </div>
  );
}
