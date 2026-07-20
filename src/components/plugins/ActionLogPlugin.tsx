import React, { useCallback, useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import PluginPanelShell from './PluginPanelShell';
import {
  PluginEmptyState,
  PluginHeroStrip,
  PluginHeroActionButton,
  PluginCard,
  PLUGIN_SELECT_CLASS,
} from './PluginPanelPrimitives';
import { IPC } from '../../lib/ipcBridge';
import { isQueuedIpcResult } from '../../lib/transferIpc';
import { pushToast } from '../ToastHost';
import { useAppConfig } from '../../data/configContext';
import { buildFileOpsRuntime } from '../../lib/settingsWiring';

export const ActionLogPluginDef = {
  id: 'action-log',
  name: 'Action Log',
  icon: 'clock_ui',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

type LogEntry = {
  id: string;
  kind: string;
  label: string;
  utc: string;
  canUndo: boolean;
};

const KIND_STYLES: Record<string, { label: string; className: string }> = {
  Move: { label: 'Move', className: 'text-sky-300/90 border-sky-500/30 bg-sky-500/10' },
  Rename: { label: 'Rename', className: 'text-emerald-300/90 border-emerald-500/30 bg-emerald-500/10' },
  BatchRename: { label: 'Batch', className: 'text-emerald-300/90 border-emerald-500/30 bg-emerald-500/10' },
  Copy: { label: 'Copy', className: 'text-violet-300/90 border-violet-500/30 bg-violet-500/10' },
  Delete: { label: 'Delete', className: 'text-rose-300/90 border-rose-500/30 bg-rose-500/10' },
  CreateDirectory: { label: 'Folder', className: 'text-amber-300/90 border-amber-500/30 bg-amber-500/10' },
  CreateFile: { label: 'File', className: 'text-amber-300/90 border-amber-500/30 bg-amber-500/10' },
  CreateLink: { label: 'Link', className: 'text-cyan-300/90 border-cyan-500/30 bg-cyan-500/10' },
  SyncFolder: { label: 'Sync', className: 'text-blue-300/90 border-blue-500/30 bg-blue-500/10' },
  CreateArchive: { label: 'Archive', className: 'text-orange-300/90 border-orange-500/30 bg-orange-500/10' },
  ExtractArchive: { label: 'Extract', className: 'text-orange-300/90 border-orange-500/30 bg-orange-500/10' },
};

function formatActionTimestamp(iso: string, mode: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  if (mode.includes('Absolute')) {
    return date.toLocaleString();
  }

  if (mode.includes('Relative to today')) {
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    return sameDay
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

function kindBadge(kind: string) {
  const style = KIND_STYLES[kind] ?? { label: kind, className: 'text-gray-400 border-white/10 bg-white/[0.03]' };
  return (
    <span className={`shrink-0 text-[9px] uppercase tracking-wide px-1.5 py-0.5 border rounded-md font-semibold ${style.className}`}>
      {style.label}
    </span>
  );
}

export default function ActionLogPlugin() {
  const { config } = useAppConfig();
  const [items, setItems] = useState<LogEntry[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [, setTick] = useState(0);
  const dateFormat = config.dateFormatInActionLabels || 'Age of action (how long ago)';
  const historyMax = Math.min(4096, Math.max(1, config.allowedNumberOfEntriesInTheActionLog ?? 100));
  const fileOps = buildFileOpsRuntime(config);
  const loggingEnabled = fileOps.logActions;

  const visibleItems = kindFilter === 'all'
    ? items
    : items.filter(entry => entry.kind === kindFilter);
  const kindOptions = ['all', ...Array.from(new Set(items.map(i => i.kind)))];

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await IPC.getActionLog(historyMax);
      setItems(data.items || []);
      setCanUndo(!!data.canUndo);
      setCanRedo(!!data.canRedo);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [historyMax]);

  useEffect(() => {
    void refresh();
    return IPC.onActionLogChanged(() => { void refresh(); });
  }, [refresh]);

  useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const runUndo = async () => {
    const r = await IPC.executeUndo();
    if (isQueuedIpcResult(r)) {
      pushToast({ kind: 'info', title: 'Undo queued', message: 'Running in the transfer panel…' });
      return;
    }
    pushToast({ kind: r.ok ? 'success' : 'warning', title: r.ok ? 'Undo' : 'Undo failed', message: r.message });
    await refresh();
  };

  const runRedo = async () => {
    const r = await IPC.executeRedo();
    if (isQueuedIpcResult(r)) {
      pushToast({ kind: 'info', title: 'Redo queued', message: 'Running in the transfer panel…' });
      return;
    }
    pushToast({ kind: r.ok ? 'success' : 'warning', title: r.ok ? 'Redo' : 'Redo failed', message: r.message });
    await refresh();
  };

  return (
    <PluginPanelShell
      title="Action Log"
      icon="clock_ui"
      iconColor="#a78bfa"
      subtitle={`${items.length} logged · ${canUndo ? 'undo available' : 'nothing to undo'}`}
      variant="embedded"
      toolbar={
        <>
          <select
            value={kindFilter}
            onChange={e => setKindFilter(e.target.value)}
            className={PLUGIN_SELECT_CLASS}
            title="Filter by action type"
          >
            {kindOptions.map(k => (
              <option key={k} value={k}>{k === 'all' ? 'All types' : k}</option>
            ))}
          </select>
          <button type="button" onClick={() => void refresh()} className="p-1.5 rounded-md hover:bg-white/5 text-gray-500" title="Refresh">
            <Icons8Icon id="refresh" size={13} />
          </button>
        </>
      }
    >
      <div className="flex flex-col h-full min-h-0 overflow-hidden">
        <PluginHeroStrip
          icon={<Icons8Icon id="clock_ui" size={52} className="opacity-90" />}
          name="Action history"
          typeLabel="Undo & redo log"
          meta={
            <span className="bndz-panel-muted text-xs">
              {visibleItems.length} of {items.length} action(s)
              {kindFilter !== 'all' ? ` · ${kindFilter}` : ''}
              {!loggingEnabled ? ' · logging off' : ''}
            </span>
          }
          actions={
            <>
              <PluginHeroActionButton
                icon="undo"
                variant={canUndo ? 'primary' : 'default'}
                onClick={() => void runUndo()}
                disabled={!canUndo}
              >
                Undo
              </PluginHeroActionButton>
              <PluginHeroActionButton
                icon="redo"
                onClick={() => void runRedo()}
                disabled={!canRedo}
              >
                Redo
              </PluginHeroActionButton>
            </>
          }
        />

        {!loggingEnabled && (
          <div className="mx-4 mt-3 mb-0 shrink-0">
            <PluginCard className="!py-2.5 border-sky-500/25 bg-sky-950/20 flex items-start gap-2.5">
              <Icons8Icon id="info" size={16} className="text-sky-400 shrink-0 mt-0.5" />
              <div className="text-[11px] text-sky-100/90 leading-relaxed">
                History view is hidden. <strong>Ctrl+Z</strong> still undoes the last file operation.
                Enable <strong>Show action history</strong> in Settings → Undo &amp; Action Log to list past actions here.
              </div>
            </PluginCard>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto bndz-scrollbar px-4 py-3">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-gray-500 text-xs">
              <Icons8Icon id="loading" size={14} spin /> Loading action history…
            </div>
          )}

          {!loading && !loggingEnabled && (
            <PluginEmptyState
              icon="clock_ui"
              title="History panel is off"
              description="Ctrl+Z / Ctrl+Y still work. Turn on “Show action history” to browse and undo from this timeline."
            />
          )}

          {!loading && loggingEnabled && items.length === 0 && (
            <PluginEmptyState
              icon="clock_ui"
              title="No logged actions yet"
              description="Copy, move, rename, sync, and archive operations will appear in this timeline as you work."
            />
          )}

          {!loading && loggingEnabled && visibleItems.length > 0 && (
            <div className="relative pl-3">
              {/* Timeline rail */}
              <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gradient-to-b from-sky-400/40 via-white/10 to-transparent" />

              <div className="space-y-1.5">
                {visibleItems.map((entry, index) => {
                  const isLatest = index === 0 && kindFilter === 'all';
                  return (
                    <div
                      key={entry.id}
                      className={`relative flex items-start gap-3 rounded-lg border px-3 py-2.5 text-xs transition-colors ${
                        isLatest
                          ? 'border-sky-400/25 bg-sky-500/[0.07] shadow-[inset_0_1px_0_rgba(56,189,248,0.08)]'
                          : 'border-white/[0.05] bg-black/20 hover:bg-white/[0.025] hover:border-white/[0.08]'
                      }`}
                    >
                      <div
                        className={`absolute -left-[9px] top-3.5 w-2.5 h-2.5 rounded-full border-2 shrink-0 ${
                          isLatest
                            ? 'border-sky-400 bg-sky-400/80 shadow-[0_0_8px_rgba(56,189,248,0.45)]'
                            : 'border-slate-500 bg-[#0c1018]'
                        }`}
                      />

                      <div className="pt-0.5 shrink-0">{kindBadge(entry.kind)}</div>

                      <div className="flex-1 min-w-0">
                        <div className="truncate text-slate-100 font-medium leading-snug">{entry.label}</div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {entry.canUndo && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300/80 border border-emerald-500/25 bg-emerald-500/10 rounded px-1.5 py-0.5">
                              <Icons8Icon id="undo" size={9} />
                              Undoable
                            </span>
                          )}
                          {!entry.canUndo && entry.kind === 'Delete' && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-rose-300/80 border border-rose-500/25 bg-rose-500/10 rounded px-1.5 py-0.5">
                              Permanent — cannot undo
                            </span>
                          )}
                          {isLatest && canUndo && entry.canUndo && (
                            <button
                              type="button"
                              onClick={() => void runUndo()}
                              className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-sky-300 border border-sky-400/35 bg-sky-500/15 hover:bg-sky-500/25 rounded px-1.5 py-0.5 transition-colors"
                            >
                              <Icons8Icon id="undo" size={9} />
                              Undo this
                            </button>
                          )}
                        </div>
                      </div>

                      <span
                        className="shrink-0 bndz-panel-muted bndz-mono text-[10px] tabular-nums pt-0.5"
                        title={entry.utc ? new Date(entry.utc).toLocaleString() : ''}
                      >
                        {formatActionTimestamp(entry.utc, dateFormat)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!loading && items.length > 0 && visibleItems.length === 0 && (
            <PluginEmptyState
              icon="filters"
              title="No matching actions"
              description={`Nothing of type “${kindFilter}” in the current log.`}
            />
          )}
        </div>
      </div>
    </PluginPanelShell>
  );
}
