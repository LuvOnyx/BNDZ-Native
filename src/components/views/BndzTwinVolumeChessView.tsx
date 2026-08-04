import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { toWindowsPath } from '../../lib/pathUtils';

type TwinStatus = 'OnlyLeft' | 'OnlyRight' | 'NewerLeft' | 'NewerRight' | 'Same' | 'Conflict';

type TwinItem = {
  relativePath: string;
  status: TwinStatus;
  leftPath?: string;
  rightPath?: string;
  leftSize?: number;
  rightSize?: number;
  leftModifiedUtc?: string;
  rightModifiedUtc?: string;
};

const STATUS_META: Record<TwinStatus, { label: string; tone: string; icon: string }> = {
  OnlyLeft: { label: 'Only Left', tone: '#60a5fa', icon: 'arrow_left_ui' },
  OnlyRight: { label: 'Only Right', tone: '#a78bfa', icon: 'arrow_right_ui' },
  NewerLeft: { label: 'Newer Left', tone: '#34d399', icon: 'arrow_left_ui' },
  NewerRight: { label: 'Newer Right', tone: '#fbbf24', icon: 'arrow_right_ui' },
  Same: { label: 'In Sync', tone: '#6b7280', icon: 'checkmark_ui' },
  Conflict: { label: 'Conflict', tone: '#f87171', icon: 'warning' },
};

function formatBytes(n: number): string {
  if (!n) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

function formatWhen(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export default function BndzTwinVolumeChessView() {
  const [leftRoot, setLeftRoot] = useState('');
  const [rightRoot, setRightRoot] = useState('');
  const [items, setItems] = useState<TwinItem[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<TwinStatus | 'all'>('all');
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    const onSeed = (e: Event) => {
      const detail = (e as CustomEvent<{ leftRoot?: string; rightRoot?: string }>).detail;
      if (detail?.leftRoot) setLeftRoot(detail.leftRoot);
      if (detail?.rightRoot) setRightRoot(detail.rightRoot);
    };
    window.addEventListener('bndz-twin-volume-seed', onSeed);
    return () => window.removeEventListener('bndz-twin-volume-seed', onSeed);
  }, []);

  const pickFolder = useCallback(async (side: 'left' | 'right') => {
    const picked = await IPC.openFolderDialog(side === 'left' ? 'Twin Volume — Left root' : 'Twin Volume — Right root');
    if (!picked) return;
    if (side === 'left') setLeftRoot(picked);
    else setRightRoot(picked);
  }, []);

  const runCompare = useCallback(async () => {
    if (!leftRoot || !rightRoot) {
      setStatusMsg('Pick both volume roots first.');
      return;
    }
    setBusy(true);
    setStatusMsg(null);
    try {
      const res = await IPC.twinVolumeCompare(leftRoot, rightRoot, true);
      if (!res.ok) {
        setStatusMsg(res.error || 'Compare failed.');
        return;
      }
      setItems((res.items || []).map(i => ({
        relativePath: String(i.relativePath ?? (i as any).RelativePath ?? ''),
        status: (i.status ?? (i as any).Status ?? 'Conflict') as TwinStatus,
        leftPath: i.leftPath ?? (i as any).LeftPath,
        rightPath: i.rightPath ?? (i as any).RightPath,
        leftSize: i.leftSize ?? (i as any).LeftSize,
        rightSize: i.rightSize ?? (i as any).RightSize,
        leftModifiedUtc: i.leftModifiedUtc ?? (i as any).LeftModifiedUtc,
        rightModifiedUtc: i.rightModifiedUtc ?? (i as any).RightModifiedUtc,
      })));
      setSummary(res.summary || {});
    } finally {
      setBusy(false);
    }
  }, [leftRoot, rightRoot]);

  const resolveItem = useCallback(async (item: TwinItem, direction: 'leftToRight' | 'rightToLeft') => {
    setResolving(item.relativePath);
    try {
      const res = await IPC.twinVolumeResolve(leftRoot, rightRoot, item.relativePath, direction);
      if (!res.ok) {
        setStatusMsg(res.error || 'Resolve failed.');
        return;
      }
      await runCompare();
      setStatusMsg(`Copied → ${res.copiedTo || 'destination'}`);
    } finally {
      setResolving(null);
    }
  }, [leftRoot, rightRoot, runCompare]);

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter(i => i.status === filter);
  }, [items, filter]);

  const conflictCount = summary.Conflict ?? 0;

  return (
    <div className="bndz-twin-chess h-full flex flex-col bg-[#1a1a1c] text-gray-200" data-bndz-workspace-surface>
      <header className="shrink-0 px-5 py-4 border-b border-white/[0.06] bg-gradient-to-r from-[#1e1e22] to-[#1a1a1c]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#7eb8e8]/10 border border-[#7eb8e8]/25 flex items-center justify-center">
            <Icons8Icon id="sync_folders" size={22} className="text-[#7eb8e8]" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-white">Cross-volume board</h1>
            <p className="text-[11px] text-gray-500 mt-0.5">Folder Sync · compare two roots and resolve conflicts</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr_auto] gap-2 items-end">
          <label className="block min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-[#60a5fa] font-bold">Left volume</span>
            <div className="flex gap-1 mt-1">
              <input
                className="flex-1 min-w-0 px-2 py-1.5 text-xs rounded-lg bg-black/30 border border-white/10 font-mono"
                value={leftRoot}
                onChange={e => setLeftRoot(e.target.value)}
                placeholder="D:\Projects\Master"
              />
              <button type="button" className="px-2 py-1.5 text-xs rounded-lg bg-white/5 border border-white/10 hover:bg-white/10" onClick={() => void pickFolder('left')}>…</button>
            </div>
          </label>
          <span className="hidden lg:block text-gray-600 text-xl pb-1">⇄</span>
          <label className="block min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-[#a78bfa] font-bold">Right volume</span>
            <div className="flex gap-1 mt-1">
              <input
                className="flex-1 min-w-0 px-2 py-1.5 text-xs rounded-lg bg-black/30 border border-white/10 font-mono"
                value={rightRoot}
                onChange={e => setRightRoot(e.target.value)}
                placeholder="E:\Mirror\Master"
              />
              <button type="button" className="px-2 py-1.5 text-xs rounded-lg bg-white/5 border border-white/10 hover:bg-white/10" onClick={() => void pickFolder('right')}>…</button>
            </div>
          </label>
          <button
            type="button"
            className="px-4 py-2 text-sm font-medium rounded-xl bg-[#7eb8e8]/20 border border-[#7eb8e8]/40 text-[#7eb8e8] hover:bg-[#7eb8e8]/30 disabled:opacity-40"
            disabled={busy}
            onClick={() => void runCompare()}
          >
            {busy ? 'Comparing…' : 'Compare'}
          </button>
        </div>

        {Object.keys(summary).length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {(Object.keys(STATUS_META) as TwinStatus[]).map(st => {
              const count = summary[st] ?? 0;
              if (!count) return null;
              const meta = STATUS_META[st];
              return (
                <button
                  key={st}
                  type="button"
                  className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${filter === st ? 'ring-1 ring-white/30' : ''}`}
                  style={{ borderColor: `${meta.tone}55`, color: meta.tone, background: `${meta.tone}15` }}
                  onClick={() => setFilter(f => f === st ? 'all' : st)}
                >
                  {meta.label} · {count}
                </button>
              );
            })}
          </div>
        )}
        {statusMsg && <p className="mt-2 text-[11px] text-gray-400">{statusMsg}</p>}
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto bndz-scrollbar p-4">
        {filtered.length === 0 && !busy && (
          <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
            <Icons8Icon id="sync_folders" size={40} className="opacity-30" />
            <p className="text-sm">Pick two roots and compare to see the conflict board.</p>
          </div>
        )}

        <div className="bndz-twin-chess-board grid grid-cols-1 xl:grid-cols-2 gap-3">
          {filtered.map(item => {
            const meta = STATUS_META[item.status] ?? STATUS_META.Conflict;
            const isConflict = item.status === 'Conflict' || item.status === 'NewerLeft' || item.status === 'NewerRight' || item.status === 'OnlyLeft' || item.status === 'OnlyRight';
            return (
              <div
                key={item.relativePath}
                className="bndz-twin-chess-card relative rounded-xl border overflow-hidden"
                style={{
                  borderColor: item.status === 'Conflict' ? '#f8717140' : `${meta.tone}30`,
                  background: 'linear-gradient(145deg, rgba(255,255,255,0.04) 0%, rgba(0,0,0,0.2) 100%)',
                }}
              >
                <div className="absolute top-2 right-2 w-3 h-3 rounded-sm opacity-20" style={{ background: meta.tone }} aria-hidden />
                <div className="px-3 py-2 border-b border-white/[0.05] flex items-center gap-2">
                  <Icons8Icon id={meta.icon} size={14} style={{ color: meta.tone }} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: meta.tone }}>{meta.label}</span>
                  <span className="ml-auto text-[10px] text-gray-500 font-mono truncate max-w-[50%]" title={item.relativePath}>{item.relativePath}</span>
                </div>
                <div className="grid grid-cols-2 divide-x divide-white/[0.05]">
                  <div className="p-3 min-w-0">
                    <div className="text-[9px] uppercase tracking-wider text-[#60a5fa] mb-1">Left</div>
                    <div className="text-[11px] font-mono truncate text-gray-300">{item.leftPath ? toWindowsPath(item.leftPath).split(/[/\\]/).pop() : '—'}</div>
                    <div className="text-[9px] text-gray-500 mt-1">{formatBytes(item.leftSize ?? 0)} · {formatWhen(item.leftModifiedUtc)}</div>
                  </div>
                  <div className="p-3 min-w-0">
                    <div className="text-[9px] uppercase tracking-wider text-[#a78bfa] mb-1">Right</div>
                    <div className="text-[11px] font-mono truncate text-gray-300">{item.rightPath ? toWindowsPath(item.rightPath).split(/[/\\]/).pop() : '—'}</div>
                    <div className="text-[9px] text-gray-500 mt-1">{formatBytes(item.rightSize ?? 0)} · {formatWhen(item.rightModifiedUtc)}</div>
                  </div>
                </div>
                {isConflict && item.status !== 'Same' && (
                  <div className="px-3 py-2 border-t border-white/[0.05] flex gap-2">
                    {(item.status === 'OnlyRight' || item.status === 'NewerRight' || item.status === 'Conflict') && item.rightPath && (
                      <button
                        type="button"
                        className="flex-1 text-[10px] py-1.5 rounded-lg bg-[#a78bfa]/15 border border-[#a78bfa]/30 text-[#c4b5fd] hover:bg-[#a78bfa]/25 disabled:opacity-40"
                        disabled={resolving === item.relativePath}
                        onClick={() => void resolveItem(item, 'rightToLeft')}
                      >
                        ← Take Right
                      </button>
                    )}
                    {(item.status === 'OnlyLeft' || item.status === 'NewerLeft' || item.status === 'Conflict') && item.leftPath && (
                      <button
                        type="button"
                        className="flex-1 text-[10px] py-1.5 rounded-lg bg-[#60a5fa]/15 border border-[#60a5fa]/30 text-[#93c5fd] hover:bg-[#60a5fa]/25 disabled:opacity-40"
                        disabled={resolving === item.relativePath}
                        onClick={() => void resolveItem(item, 'leftToRight')}
                      >
                        Take Left →
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {conflictCount > 0 && (
        <footer className="shrink-0 px-4 py-2 border-t border-white/[0.06] text-[10px] text-amber-400/80">
          {conflictCount} conflict{conflictCount === 1 ? '' : 's'} need resolution
        </footer>
      )}
    </div>
  );
}
