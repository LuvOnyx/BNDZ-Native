import React, { useCallback, useEffect, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
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
      subtitle={`${maxEntries} max · ${undoItems.length} undo · ${redoItems.length} redo`}
      iconId="clock_ui"
      onClose={onClose}
      widthClass="w-[min(560px,calc(100vw-2rem))]"
      heightClass="h-[min(520px,calc(100vh-2rem))]"
      zIndexClass="z-[260]"
    >
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        <div className="bndz-plugin-tabstrip flex border-b border-white/[0.06] shrink-0">
          <button
            type="button"
            className={`bndz-plugin-tab ${tab === 'undo' ? 'bndz-plugin-tab-active' : ''}`}
            onClick={() => setTab('undo')}
          >
            Undo stack ({undoItems.length})
          </button>
          <button
            type="button"
            className={`bndz-plugin-tab ${tab === 'redo' ? 'bndz-plugin-tab-active' : ''}`}
            onClick={() => setTab('redo')}
          >
            Redo stack ({redoItems.length})
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto bndz-scrollbar p-3 space-y-1.5">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-gray-500 text-xs">
              <Icons8Icon id="loading" size={14} spin /> Loading history…
            </div>
          )}
          {!loading && pool.length === 0 && (
            <div className="bndz-plugin-card text-center py-12 text-gray-500 text-xs">
              {tab === 'undo' ? 'No actions to undo yet.' : 'Nothing to redo.'}
            </div>
          )}
          {!loading && pool.map((entry, idx) => {
            const accent = KIND_COLOR[entry.kind] || '#94a3b8';
            const active = entry.id === selectedId;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSelectedId(entry.id)}
                className={`w-full text-left bndz-plugin-card !p-3 flex items-start gap-3 transition-colors ${
                  active ? 'ring-1 ring-[#0078d4]/50 bg-[#094771]/25' : 'hover:bg-white/[0.03]'
                }`}
              >
                <span
                  className="mt-1 w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: accent }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] text-gray-100 font-medium truncate">{entry.label}</div>
                  {entry.destination && (
                    <div className="text-[10px] text-gray-500 truncate mt-0.5" title={entry.destination}>
                      → {entry.destination}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-500">
                    <span
                      className="uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border"
                      style={{ color: accent, borderColor: `${accent}44`, background: `${accent}14` }}
                    >
                      {entry.kind}
                    </span>
                    <span>{formatWhen(entry.utc, dateFormat)}</span>
                    {idx === 0 && <span className="text-sky-400/80">latest</span>}
                    {tab === 'undo' && selectedIndex >= 0 && idx <= selectedIndex && active && idx > 0 && (
                      <span className="text-amber-400/80">undo {selectedIndex + 1} steps</span>
                    )}
                  </div>
                </div>
                {tab === 'undo' && !entry.canUndo && (
                  <span className="text-[9px] text-rose-300/80 shrink-0">permanent</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-3 border-t border-white/[0.06]">
          <button type="button" className="bndz-hub-btn-ghost px-3 py-2 text-xs font-semibold" onClick={onClose}>
            Close
          </button>
          <div className="flex items-center gap-2">
            {tab === 'undo' ? (
              <button
                type="button"
                className="bndz-hub-btn-primary px-4 py-2 text-xs font-semibold disabled:opacity-40"
                disabled={!selected || busy || rangeBlocked}
                title={rangeBlocked ? 'Selection includes a permanent delete that cannot be undone' : undefined}
                onClick={() => void runAction('undo')}
              >
                {selectedIndex > 0 ? `Undo ${selectedIndex + 1} actions` : 'Undo selected'}
              </button>
            ) : (
              <button
                type="button"
                className="bndz-hub-btn-primary px-4 py-2 text-xs font-semibold disabled:opacity-40"
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
