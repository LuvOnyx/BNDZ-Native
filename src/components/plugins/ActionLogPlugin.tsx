import React, { useCallback, useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import PluginPanelShell from './PluginPanelShell';
import { PluginToolbarButton } from './PluginPanelPrimitives';
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

export default function ActionLogPlugin() {
  const [items, setItems] = useState<LogEntry[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [loading, setLoading] = useState(true);

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
      subtitle="XYplorer-style reversible operation history"
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
          <div className="flex items-center justify-center gap-2 py-8 text-gray-500 text-xs">
            <Icons8Icon id="loading" size={14} spin /> Loading…
          </div>
        )}
        {!loading && items.length === 0 && (
          <div className="py-8 text-center text-gray-500 text-xs">No logged actions yet.</div>
        )}
        {!loading && items.map(entry => (
          <div
            key={entry.id}
            className="flex items-center gap-3 px-4 py-2 border-b border-white/[0.04] hover:bg-white/[0.02] text-xs"
          >
            <span className="shrink-0 w-16 text-violet-400/80 font-medium capitalize">{entry.kind}</span>
            <span className="flex-1 truncate text-gray-200">{entry.label}</span>
            <span className="shrink-0 bndz-panel-muted bndz-mono">
              {entry.utc ? new Date(entry.utc).toLocaleString() : ''}
            </span>
          </div>
        ))}
      </div>
    </PluginPanelShell>
  );
}
