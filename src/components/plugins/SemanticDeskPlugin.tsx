import React, { useCallback, useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { pushToast } from '../ToastHost';
import { toWindowsPath } from '../../lib/pathUtils';
import {
  clearSemanticDesk,
  isSemanticDeskActive,
  setSemanticDeskClusters,
} from '../../lib/semanticDeskRuntime';
import PluginPanelShell from './PluginPanelShell';
import {
  PluginToolbarButton,
  PluginCard,
  PluginEmptyState,
  PluginHeroStrip,
  PluginHeroActionButton,
  PluginStatCard,
  PLUGIN_INPUT_CLASS,
} from './PluginPanelPrimitives';

export const SemanticDeskPluginDef = {
  id: 'semantic-desk',
  name: 'Semantic Desk',
  icon: 'smart_view',
  targetPanel: 'bottom' as const,
  installOnFirstUse: true,
};

type ClusterPile = {
  id: string;
  label: string;
  count: number;
  paths: string[];
};

function normalizeCluster(raw: Record<string, unknown>): ClusterPile {
  const pathsRaw = raw.paths ?? raw.Paths;
  return {
    id: String(raw.id ?? raw.Id ?? ''),
    label: String(raw.label ?? raw.Label ?? 'Pile'),
    count: Number(raw.count ?? raw.Count ?? 0),
    paths: Array.isArray(pathsRaw) ? pathsRaw.map(String) : [],
  };
}

export default function SemanticDeskPlugin({ currentPath, focusedPath }: {
  currentPath?: string;
  focusedPath?: string;
}) {
  const [active, setActive] = useState(isSemanticDeskActive());
  const [clusterCount, setClusterCount] = useState(5);
  const [loading, setLoading] = useState(false);
  const [piles, setPiles] = useState<ClusterPile[]>([]);
  const [itemCount, setItemCount] = useState(0);

  const folderPath = toWindowsPath((focusedPath || currentPath || '').replace(/\/+$/, ''));

  const runCluster = useCallback(async () => {
    if (!folderPath) {
      pushToast('Navigate to a folder first', 'warning');
      return;
    }
    setLoading(true);
    try {
      const res = await IPC.semanticDeskCluster({ folder: folderPath, clusterCount: clusterCount });
      if (!res.ok) throw new Error(res.error || 'Cluster failed');
      const result = (res.result ?? {}) as Record<string, unknown>;
      const clustersRaw = result.clusters ?? result.Clusters;
      const clusters = Array.isArray(clustersRaw)
        ? clustersRaw.map((c: Record<string, unknown>) => normalizeCluster(c))
        : [];
      setPiles(clusters);
      setItemCount(Number(result.itemCount ?? result.ItemCount ?? 0));
      setSemanticDeskClusters(clusters.map(c => ({ id: c.id, label: c.label, paths: c.paths })));
      setActive(true);
      window.dispatchEvent(new CustomEvent('bndz-semantic-desk-changed', { detail: { active: true } }));
      pushToast(`${clusters.length} semantic piles · ${clusters.reduce((n, c) => n + c.count, 0)} items`, 'success');
    } catch (e: unknown) {
      pushToast(e instanceof Error ? e.message : 'Cluster failed', 'error');
    } finally {
      setLoading(false);
    }
  }, [folderPath, clusterCount]);

  const clearOverlay = () => {
    clearSemanticDesk();
    setActive(false);
    setPiles([]);
    setItemCount(0);
    window.dispatchEvent(new CustomEvent('bndz-semantic-desk-changed', { detail: { active: false } }));
    pushToast('Semantic overlay cleared', 'info');
  };

  useEffect(() => {
    setActive(isSemanticDeskActive());
  }, []);

  return (
    <PluginPanelShell
      title="Semantic Desk"
      icon="smart_view"
      toolbar={
        <>
          <PluginToolbarButton icon="zap_ui" onClick={runCluster} disabled={loading || !folderPath}>
            Cluster folder
          </PluginToolbarButton>
          <PluginToolbarButton icon="close" onClick={clearOverlay} disabled={!active}>
            Clear overlay
          </PluginToolbarButton>
        </>
      }
    >
      <PluginHeroStrip
        title="Semantic desk overlay"
        subtitle="Local feature vectors (extension, size, name tokens) → 3–8 piles with list group headers."
        actions={
          <PluginHeroActionButton icon="folder_open_ui" onClick={runCluster} disabled={loading}>
            Analyze {folderPath ? folderPath.split('\\').pop() : 'folder'}
          </PluginHeroActionButton>
        }
      />

      <div className="grid grid-cols-3 gap-2 px-3 pb-2">
        <PluginStatCard label="Overlay" value={active ? 'On' : 'Off'} />
        <PluginStatCard label="Items" value={String(itemCount)} />
        <PluginStatCard label="Piles" value={String(piles.length)} />
      </div>

      <div className="px-3 pb-2">
        <label className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">Target piles</label>
        <input
          type="range"
          min={3}
          max={8}
          value={clusterCount}
          onChange={e => setClusterCount(Number(e.target.value))}
          className="w-full accent-[#0078d4] mt-1"
        />
        <div className="text-[10px] text-gray-500 mt-0.5">{clusterCount} clusters (auto-clamped to folder size)</div>
      </div>

      <div className="flex-1 min-h-0 px-3 pb-3 overflow-y-auto bndz-scrollbar space-y-2">
        {piles.length === 0 && (
          <PluginEmptyState
            icon="smart_view"
            title="No clusters yet"
            hint="Run cluster on the current folder — details view shows pile headers."
          />
        )}
        {piles.map(pile => (
          <PluginCard key={pile.id} className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Icons8Icon id="folder_open_ui" size={14} className="text-[#99c9f0]" />
              <span className="text-sm font-semibold text-gray-200">{pile.label}</span>
              <span className="text-[10px] text-gray-500 ml-auto">{pile.count} items</span>
            </div>
            <div className="text-[10px] text-gray-500 truncate">
              {pile.paths.slice(0, 4).map(p => p.split('\\').pop()).join(' · ')}
              {pile.paths.length > 4 ? ` · +${pile.paths.length - 4} more` : ''}
            </div>
          </PluginCard>
        ))}
      </div>

      {active && (
        <div className="px-3 pb-3 text-[10px] text-[#7eb8e8] flex items-center gap-2">
          <Icons8Icon id="info_ui" size={12} />
          Details view is grouped by semantic piles. Switch view mode or clear overlay to exit.
        </div>
      )}
    </PluginPanelShell>
  );
}
