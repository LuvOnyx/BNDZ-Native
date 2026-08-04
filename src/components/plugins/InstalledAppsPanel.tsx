import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { requestNativeConfirm, showNativeAlert } from '../../lib/nativeDialog';
import {
  PluginToolbarButton,
  PluginSectionTitle,
  PluginCard,
  PluginStatCard,
  PluginEmptyState,
  PluginFieldLabel,
  PLUGIN_SELECT_CLASS,
} from './PluginPanelPrimitives';
import { formatAppSize, formatInstallDate, type InstalledApp } from '../../lib/storageCleanup';

type SortKey = 'name' | 'size' | 'publisher';

export default function InstalledAppsPanel() {
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [showSystem, setShowSystem] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uninstalling, setUninstalling] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const loadApps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await IPC.listInstalledApps(showSystem);
      if (result.error) throw new Error(result.error);
      setApps(result.apps || []);
      setLastRefresh(new Date());
      setSelected(new Set());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load applications');
    } finally {
      setLoading(false);
    }
  }, [showSystem]);

  useEffect(() => { void loadApps(); }, [loadApps]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = apps;
    if (q) {
      list = list.filter(a =>
        a.name.toLowerCase().includes(q)
        || (a.publisher || '').toLowerCase().includes(q)
        || (a.version || '').toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => {
      if (sort === 'size') return (b.estimatedSizeBytes || 0) - (a.estimatedSizeBytes || 0);
      if (sort === 'publisher') return (a.publisher || '').localeCompare(b.publisher || '');
      return a.name.localeCompare(b.name);
    });
  }, [apps, query, sort]);

  const uninstallableCount = useMemo(() => apps.filter(a => a.canUninstall).length, [apps]);
  const totalSize = useMemo(() => apps.reduce((s, a) => s + (a.estimatedSizeBytes || 0), 0), [apps]);

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runUninstall = async (app: InstalledApp, quiet = false, skipConfirm = false) => {
    if (!app.canUninstall) return;
    if (!skipConfirm) {
      const ok = await requestNativeConfirm({
        title: 'Uninstall application',
        message: `Uninstall "${app.name}"?\n\nThis launches the program's native uninstaller (same as Windows Settings → Apps).`,
        type: 'warning',
        confirmLabel: 'Uninstall',
        cancelLabel: 'Cancel',
        destructive: true,
      });
      if (!ok) return;
    }
    setUninstalling(app.id);
    try {
      const result = await IPC.uninstallApp(app.id, quiet);
      if (!result.success) throw new Error(result.error || 'Uninstall failed to start');
      setSelected(prev => { const n = new Set(prev); n.delete(app.id); return n; });
    } catch (err: unknown) {
      showNativeAlert(err instanceof Error ? err.message : 'Uninstall failed', 'Uninstall', 'error');
    } finally {
      setUninstalling(null);
    }
  };

  const uninstallSelected = async () => {
    const targets = apps.filter(a => selected.has(a.id) && a.canUninstall);
    if (!targets.length) return;
    const ok = await requestNativeConfirm({
      title: 'Uninstall applications',
      message: `Uninstall ${targets.length} application(s)? Each will open its native uninstaller sequentially.`,
      type: 'warning',
      confirmLabel: 'Uninstall',
      cancelLabel: 'Cancel',
      destructive: true,
    });
    if (!ok) return;
    for (const app of targets) {
      await runUninstall(app, true, true);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bndz-plugin-stat-grid">
        <PluginStatCard label="Installed" value={String(apps.length)} sub="Registry + Start Menu" iconId="extension_hub" />
        <PluginStatCard label="Uninstallable" value={String(uninstallableCount)} sub="Has uninstall command" iconId="trash_ui" />
        <PluginStatCard label="Est. footprint" value={formatAppSize(totalSize)} sub="Where size reported" iconId="hard_drive_ui" />
      </div>

      <PluginCard className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <PluginFieldLabel>Search apps</PluginFieldLabel>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Name, publisher, version…"
            className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/[0.08] text-[12px] text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-[#0078d4]/50"
          />
        </div>
        <div>
          <PluginFieldLabel>Sort</PluginFieldLabel>
          <select value={sort} onChange={e => setSort(e.target.value as SortKey)} className={PLUGIN_SELECT_CLASS}>
            <option value="name">Name</option>
            <option value="publisher">Publisher</option>
            <option value="size">Size</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer pb-2">
          <input type="checkbox" checked={showSystem} onChange={e => setShowSystem(e.target.checked)} className="accent-sky-500 rounded" />
          System components
        </label>
        <PluginToolbarButton icon={loading ? 'loading' : 'refresh'} onClick={() => void loadApps()} disabled={loading}>
          Refresh
        </PluginToolbarButton>
        {selected.size > 0 && (
          <PluginToolbarButton icon="trash_ui" onClick={() => void uninstallSelected()}>
            Uninstall {selected.size}
          </PluginToolbarButton>
        )}
      </PluginCard>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 px-4 py-3 text-[12px] text-rose-300">{error}</div>
      )}

      <PluginCard className="!p-0 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between">
          <PluginSectionTitle icon="extension_hub">Programs &amp; features</PluginSectionTitle>
          {lastRefresh && <span className="text-[10px] bndz-panel-muted">Updated {lastRefresh.toLocaleTimeString()}</span>}
        </div>
        {loading && !apps.length ? (
          <div className="py-16 flex justify-center"><Icons8Icon id="loading" size={28} spin /></div>
        ) : filtered.length === 0 ? (
          <PluginEmptyState icon="extension_hub" description="No applications match your filters." />
        ) : (
          <div className="max-h-[420px] overflow-y-auto bndz-scrollbar divide-y divide-white/[0.04]">
            {filtered.map(app => (
              <motion.div
                key={app.id}
                layout
                className={`flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors ${selected.has(app.id) ? 'bg-sky-950/20' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(app.id)}
                  disabled={!app.canUninstall}
                  onChange={() => toggleSelect(app.id)}
                  className="accent-sky-500 rounded shrink-0 disabled:opacity-30"
                />
                <div className="w-9 h-9 rounded-lg bg-[#0078d4]/12 border border-white/[0.06] flex items-center justify-center shrink-0">
                  <Icons8Icon id={app.isStoreApp ? 'extension_hub' : 'extension_hub'} size={16} className="text-[#7eb8e8]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold text-gray-100 truncate">{app.name}</div>
                  <div className="text-[10px] text-gray-500 truncate">
                    {app.publisher || 'Unknown publisher'}
                    {app.version ? ` · v${app.version}` : ''}
                    {app.installDate ? ` · ${formatInstallDate(app.installDate)}` : ''}
                  </div>
                  {app.installLocation && (
                    <div className="text-[9px] text-gray-600 font-mono truncate mt-0.5" title={app.installLocation}>{app.installLocation}</div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[11px] font-mono text-gray-400">{formatAppSize(app.estimatedSizeBytes)}</div>
                  <div className="text-[9px] text-gray-600 mt-0.5">{app.source === 'registry' ? 'Add/Remove' : 'Shortcut'}</div>
                </div>
                {app.canUninstall ? (
                  <PluginToolbarButton
                    icon={uninstalling === app.id ? 'loading' : 'trash_ui'}
                    disabled={uninstalling === app.id}
                    onClick={() => void runUninstall(app)}
                  >
                    Uninstall
                  </PluginToolbarButton>
                ) : (
                  <span className="text-[9px] text-gray-600 px-2">No uninstaller</span>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </PluginCard>

      <p className="text-[10px] bndz-panel-muted px-1">
        Lists programs from the Windows uninstall registry (same source as Settings → Apps) plus Start Menu shortcuts.
        Uninstall launches each program&apos;s native uninstaller — Store/UWP apps may need Settings for full removal.
      </p>
    </div>
  );
}
