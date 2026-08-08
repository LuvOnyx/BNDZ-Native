import React, { useCallback, useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { pushToast } from '../ToastHost';
import { toWindowsPath } from '../../lib/pathUtils';
import { formatPathLeafName, formatUiPath } from '../../lib/displayPath';
import PluginPanelShell from './PluginPanelShell';
import {
  PluginToolbarButton,
  PluginTabStrip,
  PluginTab,
  PluginCard,
  PluginEmptyState,
  PluginHeroStrip,
  PluginHeroActionButton,
  PluginStatCard,
  PluginSectionTitle,
} from './PluginPanelPrimitives';
import {
  applyRealityCheckScan,
  getRealityCheckState,
  setRealityCheckActive,
  subscribeRealityCheck,
  type RealityCheckRef,
} from '../../lib/realityCheckState';

export const RealityCheckPluginDef = {
  id: 'reality-check',
  name: 'Reality Check',
  icon: 'data_warning',
  description: 'Compare on-disk assets against project and DAW session file references — missing files glow in the list.',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

type TabId = 'summary' | 'missing' | 'ok';

function normalizeRef(raw: Record<string, unknown>): RealityCheckRef {
  return {
    refPath: String(raw.refPath ?? raw.RefPath ?? ''),
    resolvedPath: String(raw.resolvedPath ?? raw.ResolvedPath ?? ''),
    exists: !!(raw.exists ?? raw.Exists),
    source: String(raw.source ?? raw.Source ?? ''),
    projectFile: String(raw.projectFile ?? raw.ProjectFile ?? ''),
  };
}

function leafName(path: string): string {
  return formatPathLeafName(path) || path.split(/[/\\]/).pop() || path;
}

export default function RealityCheckPlugin({
  currentPath,
}: {
  selectedPaths?: string[];
  currentPath?: string;
}) {
  const [activeTab, setActiveTab] = useState<TabId>('summary');
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(false);
  const [refs, setRefs] = useState<RealityCheckRef[]>([]);
  const [stats, setStats] = useState({ projectFiles: 0, total: 0, missing: 0, ok: 0 });
  const [scanRoot, setScanRoot] = useState('');

  const syncFromState = useCallback(() => {
    const s = getRealityCheckState();
    setActive(s.active);
    if (s.lastScan) {
      setRefs(s.lastScan.references);
      setStats({
        projectFiles: s.lastScan.projectFileCount,
        total: s.lastScan.totalRefs,
        missing: s.lastScan.missingCount,
        ok: s.lastScan.okCount,
      });
      setScanRoot(s.lastScan.rootPath);
    }
  }, []);

  useEffect(() => {
    syncFromState();
    return subscribeRealityCheck(syncFromState);
  }, [syncFromState]);

  useEffect(() => {
    void IPC.realityCheckGetState().then(state => {
      if (state.lastScan) applyRealityCheckScan(state.lastScan as Record<string, unknown>);
      setRealityCheckActive(!!state.active);
    }).catch(() => {});
  }, []);

  const runScan = async (root?: string) => {
    const target = toWindowsPath(root || currentPath || scanRoot || '');
    if (!target) {
      pushToast({ kind: 'warning', title: 'No folder', message: 'Open a project folder in the pane first.' });
      return;
    }
    setBusy(true);
    try {
      const r = await IPC.realityCheckScan(target);
      if (!r.ok) throw new Error(r.error || 'Scan failed');
      applyRealityCheckScan(r as Record<string, unknown>);
      await IPC.realityCheckSetActive(true);
      setRealityCheckActive(true);
      pushToast({
        kind: r.missingCount ? 'warning' : 'success',
        title: 'Reality Check complete',
        message: `${r.missingCount ?? 0} missing · ${r.okCount ?? 0} ok across ${r.projectFileCount ?? 0} project files`,
      });
    } catch (e) {
      pushToast({ kind: 'error', title: 'Reality Check failed', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async () => {
    const next = !active;
    setBusy(true);
    try {
      await IPC.realityCheckSetActive(next);
      setRealityCheckActive(next);
      pushToast({ kind: 'info', title: next ? 'Reality Check mode on' : 'Reality Check mode off' });
    } catch (e) {
      pushToast({ kind: 'error', title: 'Toggle failed', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const missingRefs = refs.filter(r => !r.exists);
  const okRefs = refs.filter(r => r.exists);

  const tabs: PluginTab[] = [
    { id: 'summary', label: 'Summary', icon: 'piechart_ui' },
    { id: 'missing', label: 'Missing', icon: 'data_warning', badge: missingRefs.length || undefined },
    { id: 'ok', label: 'OK', icon: 'check', badge: okRefs.length || undefined },
  ];

  const renderRefRow = (ref: RealityCheckRef, tone: 'missing' | 'ok') => (
    <PluginCard key={`${ref.projectFile}:${ref.resolvedPath}`} className="!py-2 !px-3">
      <div className="flex items-start gap-2 min-w-0">
        <Icons8Icon
          id={tone === 'missing' ? 'data_warning' : 'check'}
          size={14}
          className={tone === 'missing' ? 'text-red-400 shrink-0 mt-0.5' : 'text-emerald-400 shrink-0 mt-0.5'}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium truncate" title={formatUiPath(ref.resolvedPath)}>{formatPathLeafName(ref.resolvedPath) || leafName(ref.resolvedPath)}</div>
          <div className="text-[10px] text-gray-500 truncate" title={formatUiPath(ref.resolvedPath)}>{formatUiPath(ref.resolvedPath)}</div>
          <div className="text-[10px] text-gray-600 mt-0.5">
            via {ref.source} · {leafName(ref.projectFile)}
          </div>
          {tone === 'missing' && (
            <button
              type="button"
              className="text-[10px] text-sky-400 hover:text-sky-300 mt-1"
              onClick={() => IPC.shellExecute('openExplorer', toWindowsPath(ref.projectFile))}
            >
              Open project file
            </button>
          )}
        </div>
      </div>
    </PluginCard>
  );

  return (
    <PluginPanelShell
      title="Reality Check"
      subtitle="Project refs vs on-disk assets"
      iconId="data_warning"
      toolbar={(
        <div className="flex items-center gap-1.5">
          <PluginToolbarButton onClick={() => void runScan()} disabled={busy} title="Scan current folder">
            <Icons8Icon id="search" size={14} />
            Scan
          </PluginToolbarButton>
          <PluginToolbarButton onClick={() => void toggleActive()} disabled={busy} title={active ? 'Disable list glow' : 'Enable list glow'}>
            <Icons8Icon id={active ? 'toggle_preview' : 'eye_ui'} size={14} className={active ? 'text-amber-400' : ''} />
            {active ? 'Active' : 'Inactive'}
          </PluginToolbarButton>
        </div>
      )}
    >
      <PluginTabStrip tabs={tabs} active={activeTab} onChange={id => setActiveTab(id as TabId)} />

      <PluginHeroStrip accent={missingRefs.length ? '#f87171' : '#34d399'}>
        <div className="flex flex-wrap items-center gap-3">
          <PluginHeroActionButton onClick={() => void runScan()} disabled={busy} accent="#f59e0b">
            <Icons8Icon id="search" size={16} />
            Scan folder
          </PluginHeroActionButton>
          <PluginHeroActionButton onClick={() => void toggleActive()} disabled={busy} accent={active ? '#f59e0b' : '#6b7280'}>
            <Icons8Icon id="toggle_preview" size={16} />
            {active ? 'Glow active' : 'Enable glow'}
          </PluginHeroActionButton>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <PluginStatCard label="Project files" value={String(stats.projectFiles)} icon="folder_ui" />
          <PluginStatCard label="Missing" value={String(stats.missing)} icon="data_warning" accent="#f87171" />
          <PluginStatCard label="OK" value={String(stats.ok)} icon="check" accent="#34d399" />
        </div>
        {scanRoot && (
          <p className="text-[10px] text-gray-500 mt-2 truncate" title={formatUiPath(scanRoot)}>Last scan: {formatUiPath(scanRoot)}</p>
        )}
      </PluginHeroStrip>

      {activeTab === 'summary' && (
        <div className="mt-3">
          <PluginSectionTitle>How it works</PluginSectionTitle>
          <PluginCard>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              Scans <code className="text-gray-300">.json</code> playlists, <code className="text-gray-300">.txt</code> path lists,
              <code className="text-gray-300"> .bndz-refs.json</code>, and Ableton <code className="text-gray-300">.als</code> session XML
              for asset references. When Reality Check mode is active, missing assets glow amber-red in the file list.
            </p>
          </PluginCard>
          {!refs.length && (
            <PluginEmptyState
              icon="search"
              title="No scan yet"
              message="Open your project root in the pane and click Scan folder."
            />
          )}
        </div>
      )}

      {activeTab === 'missing' && (
        <div className="flex flex-col gap-1.5 mt-3">
          {missingRefs.length === 0 ? (
            <PluginEmptyState icon="check" title="No missing assets" message="Run a scan to compare project references against disk." />
          ) : missingRefs.map(r => renderRefRow(r, 'missing'))}
        </div>
      )}

      {activeTab === 'ok' && (
        <div className="flex flex-col gap-1.5 mt-3">
          {okRefs.length === 0 ? (
            <PluginEmptyState icon="folder_ui" title="No resolved refs" message="Scan a folder with project or session files." />
          ) : okRefs.slice(0, 200).map(r => renderRefRow(r, 'ok'))}
        </div>
      )}
    </PluginPanelShell>
  );
}
