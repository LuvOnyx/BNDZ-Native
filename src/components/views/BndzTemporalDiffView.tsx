import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { pushToast } from '../ToastHost';
import { toWindowsPath, normalizePanePath } from '../../lib/pathUtils';
import { isFsDropTargetPath } from '../../lib/bndzVirtualViews';

type DiffEntry = {
  relPath: string;
  size: number;
  lastWriteUtc?: string;
  previousSize?: number;
  previousLastWriteUtc?: string;
};

type DiffResult = {
  rootPath: string;
  snapshotId: string;
  snapshotUtc?: string;
  snapshotSource?: string;
  minutesAgo: number;
  usedUsn?: boolean;
  added: DiffEntry[];
  removed: DiffEntry[];
  modified: DiffEntry[];
};

type SnapshotRow = {
  id: string;
  takenUtc: string;
  source: string;
  fileCount: number;
};

const SCRUBBER = [
  { label: '5m', minutes: 5 },
  { label: '15m', minutes: 15 },
  { label: '1h', minutes: 60 },
  { label: 'Today', minutes: 24 * 60 },
] as const;

type TabId = 'added' | 'removed' | 'modified';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(utc?: string): string {
  if (!utc) return '—';
  try {
    return new Date(utc).toLocaleString();
  } catch {
    return utc;
  }
}

function normalizeDiff(raw: Record<string, unknown>): DiffResult {
  const mapEntries = (arr: unknown): DiffEntry[] =>
    Array.isArray(arr)
      ? arr.map((e: Record<string, unknown>) => ({
        relPath: String(e.relPath ?? e.RelPath ?? ''),
        size: Number(e.size ?? e.Size ?? 0) || 0,
        lastWriteUtc: (e.lastWriteUtc ?? e.LastWriteUtc) as string | undefined,
        previousSize: e.previousSize != null ? Number(e.previousSize) : undefined,
        previousLastWriteUtc: (e.previousLastWriteUtc ?? e.PreviousLastWriteUtc) as string | undefined,
      }))
      : [];

  return {
    rootPath: String(raw.rootPath ?? raw.RootPath ?? ''),
    snapshotId: String(raw.snapshotId ?? raw.SnapshotId ?? ''),
    snapshotUtc: (raw.snapshotUtc ?? raw.SnapshotUtc) as string | undefined,
    snapshotSource: String(raw.snapshotSource ?? raw.SnapshotSource ?? 'scan'),
    minutesAgo: Number(raw.minutesAgo ?? raw.MinutesAgo ?? 15) || 15,
    usedUsn: !!(raw.usedUsn ?? raw.UsedUsn),
    added: mapEntries(raw.added ?? raw.Added),
    removed: mapEntries(raw.removed ?? raw.Removed),
    modified: mapEntries(raw.modified ?? raw.Modified),
  };
}

type Props = {
  watchFolder?: string;
  onNavigate: (path: string) => void;
};

export default function BndzTemporalDiffView({ watchFolder, onNavigate }: Props) {
  const [folder, setFolder] = useState(() => {
    const f = watchFolder?.replace(/\//g, '\\') ?? '';
    return f && isFsDropTargetPath(normalizePanePath(f)) ? toWindowsPath(f) : '';
  });
  const [minutes, setMinutes] = useState(15);
  const [activeTab, setActiveTab] = useState<TabId>('added');
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [checkpointId, setCheckpointId] = useState<string | null>(null);

  useEffect(() => {
    if (watchFolder && isFsDropTargetPath(normalizePanePath(watchFolder))) {
      setFolder(toWindowsPath(watchFolder));
    }
  }, [watchFolder]);

  const runCompare = useCallback(async () => {
    if (!folder.trim()) {
      pushToast('Pick a real folder to compare.');
      return;
    }
    setBusy(true);
    try {
      const res = await IPC.temporalDiffCompare(folder, minutes, checkpointId ?? undefined);
      if (!res.ok || !res.diff) {
        pushToast(res.error || 'Compare failed.');
        return;
      }
      setDiff(normalizeDiff(res.diff as Record<string, unknown>));
      const snapRes = await IPC.temporalDiffListSnapshots(folder, 12);
      if (snapRes.ok && snapRes.snapshots) {
        setSnapshots(snapRes.snapshots.map((s: Record<string, unknown>) => ({
          id: String(s.id ?? s.Id ?? ''),
          takenUtc: String(s.takenUtc ?? s.TakenUtc ?? ''),
          source: String(s.source ?? s.Source ?? 'scan'),
          fileCount: Number(s.fileCount ?? s.FileCount ?? 0) || 0,
        })));
      }
    } finally {
      setBusy(false);
    }
  }, [folder, minutes, checkpointId]);

  useEffect(() => {
    if (!folder.trim()) return;
    void runCompare();
  }, [folder, minutes, checkpointId, runCompare]);

  const takeSnapshot = async () => {
    if (!folder.trim()) return;
    setBusy(true);
    try {
      const res = await IPC.temporalDiffSnapshot(folder);
      if (!res.ok) {
        pushToast(res.error || 'Snapshot failed.');
        return;
      }
      pushToast({ kind: 'success', title: 'Checkpoint saved', message: 'Folder snapshot captured.' });
      setCheckpointId(null);
      await runCompare();
    } finally {
      setBusy(false);
    }
  };

  const activeList = useMemo(() => {
    if (!diff) return [];
    if (activeTab === 'added') return diff.added;
    if (activeTab === 'removed') return diff.removed;
    return diff.modified;
  }, [diff, activeTab]);

  const navigateToEntry = (relPath: string) => {
    if (!diff?.rootPath) return;
    const full = `${diff.rootPath.replace(/\\+$/, '')}\\${relPath.replace(/\//g, '\\')}`;
    onNavigate(full);
  };

  const tabCounts = {
    added: diff?.added.length ?? 0,
    removed: diff?.removed.length ?? 0,
    modified: diff?.modified.length ?? 0,
  };

  return (
    <div className="bndz-temporal-diff h-full flex flex-col overflow-hidden bg-[#0a0e14]/60">
      <header className="shrink-0 px-5 py-4 border-b border-white/[0.06] bg-gradient-to-r from-[#0c1420]/90 to-transparent">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <Icons8Icon id="clock_ui" size={18} className="text-sky-400" />
              Time Diff
            </h2>
            <p className="text-[11px] text-gray-500 mt-1 max-w-xl">
              This folder now vs N minutes ago — USN journal when available, file-time snapshots as fallback.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="bndz-plugin-btn px-3 py-1.5 rounded-lg text-xs border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-gray-300"
              onClick={() => void takeSnapshot()}
              disabled={busy || !folder}
            >
              Save checkpoint
            </button>
            <button
              type="button"
              className="bndz-plugin-btn px-3 py-1.5 rounded-lg text-xs border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 text-sky-200"
              onClick={() => void runCompare()}
              disabled={busy || !folder}
            >
              Refresh diff
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            className="bndz-plugin-input flex-1 min-w-[200px] rounded-lg px-3 py-2 text-xs"
            placeholder="Folder to watch (C:\Projects\…)"
            value={folder}
            onChange={e => setFolder(e.target.value)}
          />
          <div className="bndz-temporal-scrubber flex rounded-xl border border-white/[0.08] bg-black/20 p-0.5">
            {SCRUBBER.map(s => (
              <button
                key={s.label}
                type="button"
                className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                  minutes === s.minutes && !checkpointId
                    ? 'bg-sky-500/25 text-sky-100 shadow-inner'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
                onClick={() => { setMinutes(s.minutes); setCheckpointId(null); }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {diff && (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-gray-500">
            <span>
              Baseline: {formatTime(diff.snapshotUtc)}
              {diff.usedUsn ? ' · USN' : ` · ${diff.snapshotSource}`}
            </span>
            <span className="text-emerald-400/90">+{tabCounts.added}</span>
            <span className="text-rose-400/90">−{tabCounts.removed}</span>
            <span className="text-amber-400/90">~{tabCounts.modified}</span>
          </div>
        )}

        {snapshots.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {snapshots.slice(0, 6).map(s => (
              <button
                key={s.id}
                type="button"
                className={`text-[9px] px-2 py-1 rounded-md border transition-colors ${
                  checkpointId === s.id
                    ? 'border-violet-400/50 bg-violet-500/15 text-violet-200'
                    : 'border-white/8 bg-white/[0.03] text-gray-500 hover:text-gray-300'
                }`}
                onClick={() => setCheckpointId(s.id)}
              >
                {formatTime(s.takenUtc)} ({s.fileCount})
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="shrink-0 flex border-b border-white/[0.06] px-4">
        {(['added', 'removed', 'modified'] as const).map(tab => (
          <button
            key={tab}
            type="button"
            className={`bndz-plugin-tab px-4 py-2.5 text-xs capitalize ${
              activeTab === tab ? 'bndz-plugin-tab-active' : 'text-gray-500'
            }`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
            <span className="ml-1.5 opacity-60">({tabCounts[tab]})</span>
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-white/[0.06]">
        <section className="overflow-auto p-3">
          <h3 className="text-[10px] uppercase tracking-wider text-gray-600 mb-2 px-1">Now</h3>
          {activeTab !== 'removed' ? (
            <ul className="space-y-1">
              {activeList.map(e => (
                <li key={e.relPath}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 rounded-xl border border-transparent hover:border-white/[0.08] hover:bg-white/[0.03] transition-colors group"
                    onClick={() => navigateToEntry(e.relPath)}
                  >
                    <span className="text-xs text-slate-200 group-hover:text-white truncate block">{e.relPath}</span>
                    <span className="text-[10px] text-gray-600">{formatBytes(e.size)} · {formatTime(e.lastWriteUtc)}</span>
                  </button>
                </li>
              ))}
              {!activeList.length && (
                <p className="text-xs text-gray-600 px-3 py-8 text-center">No {activeTab} files in this window.</p>
              )}
            </ul>
          ) : (
            <p className="text-xs text-gray-600 px-3 py-8 text-center">Removed files only appear in the baseline column →</p>
          )}
        </section>

        <section className="overflow-auto p-3 bg-black/15">
          <h3 className="text-[10px] uppercase tracking-wider text-gray-600 mb-2 px-1">
            {checkpointId ? 'Checkpoint' : `${minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${minutes}m`} ago`}
          </h3>
          {activeTab === 'removed' || activeTab === 'modified' ? (
            <ul className="space-y-1">
              {activeList.map(e => (
                <li key={e.relPath}>
                  <div className="px-3 py-2 rounded-xl border border-white/[0.04] bg-white/[0.02]">
                    <span className="text-xs text-slate-400 truncate block">{e.relPath}</span>
                    <span className="text-[10px] text-gray-600">
                      {formatBytes(e.previousSize ?? e.size)}
                      {e.previousLastWriteUtc ? ` · ${formatTime(e.previousLastWriteUtc)}` : ''}
                    </span>
                  </div>
                </li>
              ))}
              {!activeList.length && (
                <p className="text-xs text-gray-600 px-3 py-8 text-center">No baseline entries.</p>
              )}
            </ul>
          ) : activeTab === 'added' ? (
            <p className="text-xs text-gray-600 px-3 py-8 text-center">New files weren&apos;t in the baseline.</p>
          ) : null}
        </section>
      </div>

      {busy && (
        <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
          <span className="text-xs text-gray-400 animate-pulse">Comparing…</span>
        </div>
      )}
    </div>
  );
}
