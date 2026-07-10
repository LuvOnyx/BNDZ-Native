import React, { useCallback, useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import PluginPanelShell from './PluginPanelShell';
import { PluginToolbarButton, PluginEmptyState } from './PluginPanelPrimitives';
import { IPC } from '../../lib/ipcBridge';
import { pushToast } from '../ToastHost';

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
};

function formatRelativeTime(iso: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(iso).toLocaleString();
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
  const [items, setItems] = useState<LogEntry[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);

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
    pushToast({ kind: r.ok ? 'success' : 'warning', title: r.ok ? 'Undo' : 'Undo failed', message: r.message });
    await refresh();
  };

  const runRedo = async () => {
    const r = await IPC.executeRedo();
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
          <PluginToolbarButton icon="undo" disabled={!canUndo} onClick={() => void runUndo()}>Undo</PluginToolbarButton>
          <PluginToolbarButton icon="redo" disabled={!canRedo} onClick={() => void runRedo()}>Redo</PluginToolbarButton>
          <button type="button" onClick={() => void refresh()} className="p-1.5 rounded-md hover:bg-white/5 text-gray-500" title="Refresh">
            <Icons8Icon id="refresh" size={13} />
          </button>
        </>
      }
    >
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
            description="Copy, move, rename, and delete operations appear here when action logging is enabled in Settings → File Operations."
          />
        )}
        {!loading && items.map((entry, index) => (
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
              {formatRelativeTime(entry.utc)}
            </span>
          </div>
        ))}
      </div>
    </PluginPanelShell>
  );
}
