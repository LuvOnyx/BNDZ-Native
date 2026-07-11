import React, { useCallback, useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import PluginPanelShell from './PluginPanelShell';
import { PluginToolbarButton, PluginEmptyState, PluginHeroStrip, PluginHeroActionButton, PLUGIN_SELECT_CLASS } from './PluginPanelPrimitives';
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
    <span className={`shrink-0 text-[9px] uppercase tracking-wide px-1.5 py-0.5 border rounded-sm font-medium ${style.className}`}>
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
  const fileOps = buildFileOpsRuntime(config);
  const loggingEnabled = fileOps.logActions;

  const visibleItems = kindFilter === 'all'
    ? items
    : items.filter(entry => entry.kind === kindFilter);
  const kindOptions = ['all', ...Array.from(new Set(items.map(i => i.kind)))];

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await IPC.getActionLog();
      setItems(data.items || []);
      setCanUndo(!!data.canUndo);
      setCanRedo(!!data.canRedo);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

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
          meta={<span className="bndz-panel-muted text-xs">{visibleItems.length} of {items.length} action(s){kindFilter !== 'all' ? ` · ${kindFilter}` : ''}</span>}
          actions={
            <>
              <PluginHeroActionButton icon="undo" onClick={() => void runUndo()} disabled={!canUndo || !loggingEnabled}>Undo</PluginHeroActionButton>
              <PluginHeroActionButton icon="redo" onClick={() => void runRedo()} disabled={!canRedo || !loggingEnabled}>Redo</PluginHeroActionButton>
            </>
          }
        />
      {!loggingEnabled && (
        <div className="mx-4 mt-3 mb-1 rounded border border-amber-500/30 bg-amber-950/25 px-3 py-2 text-[11px] text-amber-100">
          Action logging is disabled. Enable <strong>Log actions and enable undo/redo</strong> in Settings → File Operations → Undo &amp; Action Log.
        </div>
      )}
      <div className="h-full overflow-y-auto bndz-scrollbar">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-gray-500 text-xs">
            <Icons8Icon id="loading" size={14} spin /> Loading action history…
          </div>
        )}
        {!loading && items.length === 0 && (
          <PluginEmptyState
            icon="clock_ui"
            title="No logged actions yet"
            description="Copy, move, rename, sync, and archive operations appear here when action logging is enabled in Settings → File Operations."
          />
        )}
        {!loading && visibleItems.map((entry, index) => (
          <div
            key={entry.id}
            className={`flex items-start gap-3 px-4 py-2.5 border-b border-white/[0.04] text-xs transition-colors ${
              index === 0 ? 'bg-[#094771]/10' : 'hover:bg-white/[0.02]'
            }`}
          >
            <div className="pt-0.5 shrink-0 w-4 text-center">
              {index === 0 ? <Icons8Icon id="chevron_right" size={10} className="text-[#99c9f0]" /> : <span className="inline-block w-2.5" />}
            </div>
            {kindBadge(entry.kind)}
            <div className="flex-1 min-w-0">
              <div className="truncate text-gray-100 font-medium">{entry.label}</div>
              {!entry.canUndo && entry.kind === 'Delete' && (
                <div className="text-[10px] text-rose-300/70 mt-0.5">Permanent delete — cannot undo</div>
              )}
            </div>
            <span className="shrink-0 bndz-panel-muted bndz-mono text-[10px] tabular-nums" title={entry.utc ? new Date(entry.utc).toLocaleString() : ''}>
              {formatActionTimestamp(entry.utc, dateFormat)}
            </span>
          </div>
        ))}
      </div>
      </div>
    </PluginPanelShell>
  );
}
