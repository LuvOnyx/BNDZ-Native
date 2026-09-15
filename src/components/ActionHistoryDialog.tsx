import React, { useCallback, useEffect, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { BndzPlaque } from './BndzPlaque';
import { BndzWindowFrame } from './native/BndzWindowFrame';
import { IPC } from '../lib/ipcBridge';
import { isQueuedIpcResult } from '../lib/transferIpc';
import { pushToast } from './ToastHost';
import { useAppConfig } from '../data/configContext';

export type HistoryEntry = {
  id: string;
  kind: string;
  label: string;
  utc: string;
  canUndo: boolean;
  destination?: string | null;
  sourcePaths?: string[];
  targetPaths?: string[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
};

function formatWhen(iso: string, mode: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  if (mode.includes('Absolute')) return date.toLocaleString();
  if (mode.includes('Relative to today')) {
    const now = new Date();
    return date.toDateString() === now.toDateString()
      ? `Today ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : date.toLocaleDateString();
  }
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return date.toLocaleString();
}

const KIND_COLOR: Record<string, string> = {
  Move: '#38bdf8',
  Rename: '#34d399',
  BatchRename: '#34d399',
  Copy: '#a78bfa',
  Delete: '#fb7185',
  CreateDirectory: '#fbbf24',
  CreateFile: '#fbbf24',
  CreateLink: '#22d3ee',
  SyncFolder: '#60a5fa',
  CreateArchive: '#fb923c',
  ExtractArchive: '#fb923c',
};

/** Edit → History modal: browse past actions and undo/redo through a selection. */
export default function ActionHistoryDialog({ open, onClose, onChanged }: Props) {
  const { config } = useAppConfig();
  const maxEntries = Math.min(4096, Math.max(1, config.allowedNumberOfEntriesInTheActionLog ?? 100));
  const dateFormat = config.dateFormatInActionLabels || 'Age of action (how long ago)';

  const [tab, setTab] = useState<'undo' | 'redo'>('undo');
  const [undoItems, setUndoItems] = useState<HistoryEntry[]>([]);
  const [redoItems, setRedoItems] = useState<HistoryEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await IPC.getActionLog(maxEntries);
      const undo = data.items || [];
      const redo = data.redoItems || [];
      setUndoItems(undo);
      setRedoItems(redo);
      setSelectedId(prev => {
        const pool = tab === 'undo' ? undo : redo;
        if (prev && pool.some(e => e.id === prev)) return prev;
        return pool[0]?.id ?? null;
      });
    } catch {
      setUndoItems([]);
      setRedoItems([]);
      setSelectedId(null);
    } finally {
      setLoading(false);
    }
  }, [maxEntries, tab]);

  useEffect(() => {
    if (!open) return;
    void refresh();
    return IPC.onActionLogChanged(() => { void refresh(); });
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const pool = tab === 'undo' ? undoItems : redoItems;
    setSelectedId(pool[0]?.id ?? null);
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const pool = tab === 'undo' ? undoItems : redoItems;
  const selected = pool.find(e => e.id === selectedId) ?? null;
  const selectedIndex = selected ? pool.findIndex(e => e.id === selected.id) : -1;
  const rangeBlocked = tab === 'undo' && selectedIndex >= 0
    && pool.slice(0, selectedIndex + 1).some(e => !e.canUndo);

  const runAction = async (mode: 'undo' | 'redo') => {
    if (!selected) {
      pushToast({ kind: 'info', title: 'History', message: mode === 'undo' ? 'Select an action to undo.' : 'Select an action to redo.' });
      return;
    }
    setBusy(true);
    try {
      const r = mode === 'undo'
        ? await IPC.executeUndo({ entryId: selected.id })
        : await IPC.executeRedo({ entryId: selected.id });
      if (isQueuedIpcResult(r)) {
        pushToast({ kind: 'info', title: mode === 'undo' ? 'Undo queued' : 'Redo queued', message: 'Running in the transfer panel…' });
      } else {
        pushToast({
          kind: r.ok ? 'success' : 'warning',
          title: r.ok ? (mode === 'undo' ? 'Undone' : 'Redone') : 'Failed',
          message: r.message,
        });
      }
      await refresh();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <BndzWindowFrame
      title="History"
      subtitle={`Action Log · ${undoItems.length} undo · ${redoItems.length} redo`}
      iconId="clock_ui"
      onClose={onClose}
      widthClass="w-[min(640px,calc(100vw-2rem))]"
      heightClass="h-[min(560px,calc(100vh-2rem))]"
      zIndexClass="z-[260]"
    >
      <div className="bndz-history-shell flex flex-1 min-h-0 flex-col overflow-hidden">
        <div className="bndz-history-hero shrink-0 px-5 pt-4 pb-3">
          <div className="bndz-history-hero-glow" aria-hidden />
          <div className="relative flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.18em] text-sky-300/70 font-semibold">BNDZ Action Log</div>
              <div className="text-[13px] text-white/55 mt-1 leading-snug truncate">
                Select a step — undo rewinds through everything above it.
              </div>
            </div>
            <div className="bndz-history-segment" role="tablist" aria-label="History stack">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'undo'}
                className={`bndz-history-seg ${tab === 'undo' ? 'is-active' : ''}`}
                onClick={() => setTab('undo')}
              >
                Undo
                <span className="bndz-history-seg-count">{undoItems.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'redo'}
                className={`bndz-history-seg ${tab === 'redo' ? 'is-active' : ''}`}
                onClick={() => setTab('redo')}
              >
                Redo
                <span className="bndz-history-seg-count">{redoItems.length}</span>
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto bndz-scrollbar px-4 pb-3">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-white/40 text-sm">
              <Icons8Icon id="loading" size={16} spin /> Loading history…
            </div>
          )}
          {!loading && pool.length === 0 && (
            <div className="bndz-history-empty">
              <BndzPlaque tone="history" size="lg" className="mb-1" />
              <div className="text-sm text-white/70 font-medium">
                {tab === 'undo' ? 'No actions to undo yet' : 'Nothing to redo'}
              </div>
              <div className="text-[12px] text-white/40 mt-1.5 max-w-[320px] leading-relaxed">
                Moves, copies, renames, and deletes you run in BNDZ land here when Action Log is enabled.
              </div>
            </div>
          )}
          {!loading && pool.length > 0 && (
            <div className="bndz-history-rail">
              {pool.map((entry, idx) => {
                const accent = KIND_COLOR[entry.kind] || '#94a3b8';
                const active = entry.id === selectedId;
                const inRange = tab === 'undo' && selectedIndex >= 0 && idx <= selectedIndex;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setSelectedId(entry.id)}
                    className={`bndz-history-row ${active ? 'is-active' : ''} ${inRange && !active ? 'is-range' : ''}`}
                    style={{ ['--history-accent' as string]: accent }}
                  >
                    <span className="bndz-history-dot" aria-hidden />
                    <div className="flex-1 min-w-0 text-left">
                      <div className="text-sm text-white/92 font-medium truncate leading-snug">{entry.label}</div>
                      {entry.destination && (
                        <div className="text-[11px] text-white/40 truncate mt-0.5" title={entry.destination}>
                          → {entry.destination}
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="bndz-history-kind">{entry.kind}</span>
                        <span className="text-[11px] text-white/35">{formatWhen(entry.utc, dateFormat)}</span>
                        {idx === 0 && <span className="bndz-history-chip bndz-history-chip--sky">latest</span>}
                        {tab === 'undo' && active && selectedIndex > 0 && (
                          <span className="bndz-history-chip bndz-history-chip--amber">
                            undo {selectedIndex + 1} steps
                          </span>
                        )}
                      </div>
                    </div>
                    {tab === 'undo' && !entry.canUndo && (
                      <span className="bndz-history-chip bndz-history-chip--rose shrink-0">permanent</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="bndz-history-footer shrink-0 flex items-center justify-between gap-2 px-4 py-3">
          <button type="button" className="bndz-history-btn bndz-history-btn--ghost" onClick={onClose}>
            Close
          </button>
          <div className="flex items-center gap-2">
            {tab === 'undo' ? (
              <button
                type="button"
                className="bndz-history-btn bndz-history-btn--primary"
                disabled={!selected || busy || rangeBlocked}
                title={rangeBlocked ? 'Selection includes a permanent delete that cannot be undone' : undefined}
                onClick={() => void runAction('undo')}
              >
                {selectedIndex > 0 ? `Undo ${selectedIndex + 1} actions` : 'Undo selected'}
              </button>
            ) : (
              <button
                type="button"
                className="bndz-history-btn bndz-history-btn--primary"
                disabled={!selected || busy}
                onClick={() => void runAction('redo')}
              >
                {selectedIndex > 0 ? `Redo ${selectedIndex + 1} actions` : 'Redo selected'}
              </button>
            )}
          </div>
        </div>
      </div>
    </BndzWindowFrame>
  );
}
