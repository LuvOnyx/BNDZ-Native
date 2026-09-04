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
  installOnFirstUse: false,
};

type ClusterPile = {
  id: string;
  label: string;
  count: number;
  paths: string[];
};

type EmbeddingStatus = {
  modelLoaded: boolean;
  embeddingDimension: number;
  modelPath: string;
  vocabPath: string;
  modelExists: boolean;
  vocabExists: boolean;
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
  const [emb, setEmb] = useState<EmbeddingStatus | null>(null);
  const [embLoading, setEmbLoading] = useState(false);

  const folderPath = toWindowsPath((focusedPath || currentPath || '').replace(/\/+$/, ''));

  const refreshEmbedding = useCallback(async () => {
    setEmbLoading(true);
    try {
      const res = await IPC.embeddingStatus();
      if (res.ok && res.status) {
        setEmb({
          modelLoaded: !!res.status.modelLoaded,
          embeddingDimension: Number(res.status.embeddingDimension || 0),
          modelPath: String(res.status.modelPath || ''),
          vocabPath: String(res.status.vocabPath || ''),
          modelExists: !!res.status.modelExists,
          vocabExists: !!res.status.vocabExists,
        });
      } else {
        setEmb(null);
      }
    } catch {
      setEmb(null);
    } finally {
      setEmbLoading(false);
    }
  }, []);

  useEffect(() => {
    setActive(isSemanticDeskActive());
    void refreshEmbedding();
  }, [refreshEmbedding]);

  const onnxReady = !!emb && emb.modelExists && emb.vocabExists;
  const onnxPartial = !!emb && (emb.modelExists !== emb.vocabExists);

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
      void refreshEmbedding();
    } catch (e: unknown) {
      pushToast(e instanceof Error ? e.message : 'Cluster failed', 'error');
    } finally {
      setLoading(false);
    }
  }, [folderPath, clusterCount, refreshEmbedding]);

  const clearOverlay = () => {
    clearSemanticDesk();
    setActive(false);
    setPiles([]);
    setItemCount(0);
    window.dispatchEvent(new CustomEvent('bndz-semantic-desk-changed', { detail: { active: false } }));
    pushToast('Semantic overlay cleared', 'info');
  };

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
        subtitle={onnxReady
          ? 'ONNX embeddings loaded — cluster by meaning, then group the list.'
          : 'Local feature vectors (extension, size, name tokens) → 3–8 piles. Drop ONNX model for richer ranking.'}
        actions={
          <PluginHeroActionButton icon="folder_open_ui" onClick={runCluster} disabled={loading}>
            Analyze {folderPath ? folderPath.split('\\').pop() : 'folder'}
          </PluginHeroActionButton>
        }
      />

      {emb && !onnxReady && (
        <div className="mx-3 mb-2 rounded-xl border border-amber-400/25 bg-gradient-to-br from-amber-950/40 via-[#1a1408] to-[#0c0e14] p-3 space-y-2">
          <div className="flex items-start gap-2">
            <Icons8Icon id="info_ui" size={14} className="text-amber-300 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-semibold text-amber-100">
                {onnxPartial ? 'ONNX model incomplete' : 'ONNX embedding model not installed'}
              </div>
              <p className="text-[10px] text-amber-100/70 mt-1 leading-relaxed">
                Place <span className="font-mono text-amber-50/90">embedding.onnx</span> and{' '}
                <span className="font-mono text-amber-50/90">vocab.txt</span> under{' '}
                <span className="font-mono text-amber-50/90">%LocalAppData%\BNDZ\Models\</span>.
                Clustering still works with built-in local features until then.
              </p>
              <div className="mt-2 grid gap-1 text-[10px] font-mono text-amber-100/55">
                <div className={emb.modelExists ? 'text-emerald-400/80' : ''}>
                  {emb.modelExists ? '✓' : '○'} {emb.modelPath || 'embedding.onnx'}
                </div>
                <div className={emb.vocabExists ? 'text-emerald-400/80' : ''}>
                  {emb.vocabExists ? '✓' : '○'} {emb.vocabPath || 'vocab.txt'}
                </div>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <PluginToolbarButton icon="refresh" onClick={() => void refreshEmbedding()} disabled={embLoading}>
              Recheck model
            </PluginToolbarButton>
            {emb.modelPath && (
              <PluginToolbarButton
                icon="folder_open_ui"
                onClick={() => {
                  const folder = emb.modelPath.replace(/[/\\][^/\\]+$/, '');
                  if (folder) void IPC.shellExecute('openExplorer', folder);
                }}
              >
                Open Models folder
              </PluginToolbarButton>
            )}
          </div>
        </div>
      )}

      {onnxReady && (
        <div className="mx-3 mb-2 rounded-xl border border-emerald-400/20 bg-emerald-950/20 px-3 py-2 flex items-center gap-2 text-[10px] text-emerald-200/90">
          <Icons8Icon id="checksquare_ui" size={12} className="text-emerald-400 shrink-0" />
          ONNX ready{emb?.modelLoaded ? ' · loaded' : ''} · dim {emb?.embeddingDimension || '—'}
          <button
            type="button"
            className={`${PLUGIN_INPUT_CLASS} !w-auto !py-0.5 !px-2 !text-[10px] ml-auto`}
            onClick={() => void refreshEmbedding()}
          >
            Refresh
          </button>
        </div>
      )}

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
