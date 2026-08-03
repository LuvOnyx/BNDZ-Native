import React, { useCallback, useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { toWindowsPath } from '../../lib/pathUtils';

export interface RecycleArchBranch {
  parentPath: string;
  itemCount: number;
  totalBytes: number;
  latestDeletedUtc?: string;
  items: Array<{
    parsingName: string;
    name: string;
    originalParent: string;
    originalFullPath: string;
    isFolder: boolean;
    size: number;
    deletedUtc: string;
  }>;
  children?: RecycleArchBranch[];
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function BranchRow({
  branch,
  depth,
  onRestore,
  busy,
}: {
  branch: RecycleArchBranch;
  depth: number;
  onRestore: (parentPath: string) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(depth < 2);
  const label = branch.parentPath || '(unknown)';
  const short = label.length > 72 ? `…${label.slice(-68)}` : label;
  return (
    <div className="bndz-recycle-arch-branch" style={{ marginLeft: depth * 12 }}>
      <div className="bndz-plugin-card !p-2.5 flex items-center gap-2 group">
        <button
          type="button"
          className="w-5 h-5 shrink-0 rounded text-white/40 hover:text-white/70"
          onClick={() => setOpen(v => !v)}
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          <Icons8Icon id={open ? 'chevron_down_ui' : 'chevron_right_ui'} size={12} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-gray-100 truncate" title={label}>{short}</div>
          <div className="text-[10px] text-white/40 mt-0.5">
            {branch.itemCount} item{branch.itemCount === 1 ? '' : 's'} · {formatBytes(branch.totalBytes)}
            {branch.latestDeletedUtc ? ` · deleted ${new Date(branch.latestDeletedUtc).toLocaleString()}` : ''}
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => onRestore(branch.parentPath)}
          className="bndz-hub-btn-primary px-2.5 py-1 text-[11px] font-semibold shrink-0 opacity-80 group-hover:opacity-100 disabled:opacity-30"
        >
          Restore branch
        </button>
      </div>
      {open && branch.items.length > 0 && (
        <ul className="mt-1 mb-2 space-y-0.5 pl-7 border-l border-white/[0.06] ml-2">
          {branch.items.slice(0, 12).map(item => (
            <li key={item.parsingName} className="text-[10px] text-white/45 truncate flex gap-2">
              <Icons8Icon id={item.isFolder ? 'folder_ui' : 'document_ui'} size={10} className="shrink-0 opacity-50" />
              <span className="truncate" title={item.originalFullPath}>{item.name}</span>
              <span className="text-white/25 shrink-0">{formatBytes(item.size)}</span>
            </li>
          ))}
          {branch.items.length > 12 && (
            <li className="text-[10px] text-white/30 pl-4">+{branch.items.length - 12} more…</li>
          )}
        </ul>
      )}
      {open && branch.children?.map(child => (
        <BranchRow key={child.parentPath} branch={child} depth={depth + 1} onRestore={onRestore} busy={busy} />
      ))}
    </div>
  );
}

export default function RecycleArchaeologyPanel() {
  const [branches, setBranches] = useState<RecycleArchBranch[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await IPC.recycleArchList();
      setBranches(r.branches || []);
      setStatus(r.branches?.length ? `${r.branches.length} deleted branch root(s)` : 'Recycle Bin is empty or metadata unavailable.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Scan failed.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const restoreBranch = useCallback(async (parentPath: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await IPC.recycleArchRestoreBranch(parentPath);
      setStatus(`Restored ${r.restored} item(s)${r.failed ? ` · ${r.failed} failed` : ''} to ${toWindowsPath(parentPath)}`);
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Restore failed.');
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return (
    <div className="flex flex-col gap-3">
      <div className="bndz-plugin-card !p-3 bg-gradient-to-br from-rose-950/30 to-transparent border-rose-500/15">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-400/20 flex items-center justify-center shrink-0">
            <Icons8Icon id="trash_ui" size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold text-gray-100">Recycle Archaeology</h3>
            <p className="text-[11px] text-white/45 mt-1 leading-relaxed">
              Reconstructs original parent folders from Recycle Bin metadata ($I / shell properties) and restores whole deleted branches in one action.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || busy}
          className="bndz-hub-btn-primary px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40"
        >
          {loading ? 'Scanning…' : 'Rescan Recycle Bin'}
        </button>
        {status && <span className="text-[11px] text-white/40">{status}</span>}
      </div>

      {error && <p className="text-[11px] text-rose-300/90">{error}</p>}

      <div className="space-y-2 max-h-[360px] overflow-y-auto bndz-scrollbar pr-1">
        {branches.length === 0 && !loading ? (
          <div className="text-center py-8 text-[11px] text-white/35">No deleted branches with recoverable metadata.</div>
        ) : (
          branches.map(b => (
            <BranchRow key={b.parentPath} branch={b} depth={0} onRestore={p => void restoreBranch(p)} busy={busy} />
          ))
        )}
      </div>
    </div>
  );
}
