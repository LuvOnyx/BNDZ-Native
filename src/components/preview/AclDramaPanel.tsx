import React, { useCallback, useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { toWindowsPath } from '../../lib/pathUtils';

type DramaEntry = {
  snapshotId: string;
  snapshotUtc: string;
  owner: string;
  summary: string;
  addedRules: string[];
  removedRules: string[];
  dramaLabel: string;
};

function relativeTime(utc: string): string {
  if (!utc) return '';
  const ms = Date.now() - new Date(utc).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export default function AclDramaPanel({ path }: { path: string | null }) {
  const [history, setHistory] = useState<DramaEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const winPath = path ? toWindowsPath(path) : '';

  const load = useCallback(async () => {
    if (!winPath || !IPC.isNative) return;
    setBusy(true);
    setError(null);
    try {
      const res = await IPC.aclDramaHistory(winPath, 40);
      if (!res.ok) throw new Error(res.error || 'History failed');
      const rows = (res.history ?? []).map((raw: Record<string, unknown>) => ({
        snapshotId: String(raw.snapshotId ?? raw.SnapshotId ?? ''),
        snapshotUtc: String(raw.snapshotUtc ?? raw.SnapshotUtc ?? ''),
        owner: String(raw.owner ?? raw.Owner ?? ''),
        summary: String(raw.summary ?? raw.Summary ?? ''),
        addedRules: (Array.isArray(raw.addedRules) ? raw.addedRules : []).map(String),
        removedRules: (Array.isArray(raw.removedRules) ? raw.removedRules : []).map(String),
        dramaLabel: String(raw.dramaLabel ?? raw.DramaLabel ?? ''),
      }));
      setHistory(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setHistory([]);
    } finally {
      setBusy(false);
    }
  }, [winPath]);

  useEffect(() => { void load(); }, [load]);

  const snapshotNow = async () => {
    if (!winPath) return;
    setBusy(true);
    try {
      const res = await IPC.aclDramaSnapshot(winPath);
      if (!res.ok) throw new Error(res.error || 'Snapshot failed');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!path) return null;

  return (
    <div className="bndz-acl-drama-panel border bndz-preview-detail-card rounded-[4px] p-3 mt-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="bndz-panel-section-title flex items-center gap-1.5">
          <Icons8Icon id="key_ui" size={14} className="bndz-preview-inline-icon" />
          Permissions Drama
        </div>
        <button
          type="button"
          className="text-[11px] px-2 py-0.5 rounded border border-white/10 text-sky-300 hover:bg-white/5"
          onClick={() => void snapshotNow()}
          disabled={busy}
        >
          Snapshot ACL
        </button>
      </div>

      {error && <div className="text-[11px] text-rose-300 mb-2">{error}</div>}
      {busy && history.length === 0 && <div className="text-[11px] text-gray-500">Loading timeline…</div>}

      {history.length === 0 && !busy ? (
        <div className="text-[11px] text-gray-500">No ACL history yet — snapshot to start the drama timeline.</div>
      ) : (
        <ol className="space-y-2 max-h-[220px] overflow-y-auto bndz-scrollbar">
          {history.map(entry => (
            <li key={entry.snapshotId} className="relative pl-4 border-l border-amber-500/30">
              <div className="absolute left-0 top-1.5 w-2 h-2 rounded-full bg-amber-400/80 -translate-x-[5px]" />
              <div className="text-[11px] text-gray-500">{relativeTime(entry.snapshotUtc)} · Owner: {entry.owner}</div>
              <div className="text-xs text-gray-200 mt-0.5">{entry.dramaLabel}</div>
              {entry.addedRules.length > 0 && (
                <div className="text-[10px] text-emerald-300/90 mt-1">
                  + {entry.addedRules.slice(0, 2).join(' · ')}
                  {entry.addedRules.length > 2 ? ` (+${entry.addedRules.length - 2})` : ''}
                </div>
              )}
              {entry.removedRules.length > 0 && (
                <div className="text-[10px] text-rose-300/90">
                  − {entry.removedRules.slice(0, 2).join(' · ')}
                  {entry.removedRules.length > 2 ? ` (+${entry.removedRules.length - 2})` : ''}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
