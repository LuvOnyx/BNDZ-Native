import React, { useCallback, useEffect, useState } from 'react';
import { IPC } from '../../lib/ipcBridge';
import { Icons8Icon } from '../Icons8Icon';
import MeshHostsManager from '../mesh/MeshHostsManager';
import { SettingsSection, SettingsTabHeader } from './SettingsPrimitives';
import { Checkbox } from '../ui/checkbox';
import {
  PluginToolbarButton, PluginCard, PluginFieldLabel, PluginEmptyState, PLUGIN_INPUT_CLASS,
} from '../plugins/PluginPanelPrimitives';
import { type MeshSyncRule, normalizeMeshHost, MESH_STATE_LABEL, MESH_PROVIDER_LABEL } from '../../lib/meshTypes';
import { buildMeshPath } from '../../lib/meshPaths';
import { BNDZ_AUTOMATION, BNDZ_CANVAS } from '../../lib/bndzVirtualViews';
import WorkspaceLaunchCard from '../workspace/WorkspaceLaunchCard';

type ToolTab = 'remote-mesh' | 'live-mirror' | 'folder-sync' | 'spatial-automation';

const TOOL_TABS: { id: ToolTab; label: string; icon: string; desc: string }[] = [
  { id: 'remote-mesh', label: 'Remote Mesh', icon: 'cloud_ui', desc: 'SSH/SFTP hosts & S3 buckets' },
  { id: 'live-mirror', label: 'Live Mirror', icon: 'sync_folders', desc: 'Push local folders on save' },
  { id: 'folder-sync', label: 'Folder Sync', icon: 'sync', desc: 'Bidirectional folder jobs' },
  { id: 'spatial-automation', label: 'Spatial & Automation', icon: 'view_grid', desc: 'Canvas and pipeline workspaces' },
];

type WorkspaceConfig = {
  meshShowInNavTree?: boolean;
  meshAutoConnectOnBrowse?: boolean;
  spatialCanvasAutoSave?: boolean;
  spatialCanvasAutoSaveDelayMs?: number;
  spatialCanvasWheelZoom?: boolean;
  spatialCanvasMinZoom?: number;
  spatialCanvasMaxZoom?: number;
  automationAutoSave?: boolean;
  automationAutoSaveDelayMs?: number;
  automationPanOnScroll?: boolean;
  automationZoomOnScroll?: boolean;
};

export default function WorkspaceToolsTabContent({
  openBottomPlugin,
  localConfig,
  updateLocalConfig,
}: {
  openBottomPlugin?: (id: string) => void;
  localConfig: WorkspaceConfig;
  updateLocalConfig: (updates: Partial<WorkspaceConfig>) => void;
}) {
  const [toolTab, setToolTab] = useState<ToolTab>('remote-mesh');
  const [rules, setRules] = useState<MeshSyncRule[]>([]);
  const [hosts, setHosts] = useState<ReturnType<typeof normalizeMeshHost>[]>([]);
  const [busy, setBusy] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refreshMesh = useCallback(async () => {
    const [r, h] = await Promise.all([IPC.meshGetSyncRules(), IPC.meshListHosts()]);
    setRules(r as MeshSyncRule[]);
    setHosts((h as Record<string, unknown>[]).map(normalizeMeshHost));
  }, []);

  useEffect(() => {
    if (toolTab === 'live-mirror' || toolTab === 'remote-mesh') void refreshMesh();
  }, [toolTab, refreshMesh]);

  const meshStats = {
    total: hosts.length,
    online: hosts.filter(h => h.state === 2).length,
    pinned: hosts.filter(h => h.showInNavTree).length,
    rules: rules.filter(r => r.enabled).length,
  };

  const hostDotClass = (state: number) => {
    if (state === 2) return 'is-online';
    if (state === 1) return 'is-connecting';
    if (state === 4) return 'is-error';
    return 'is-offline';
  };

  const connectHost = async (hostId: string) => {
    setConnectingId(hostId);
    try {
      await IPC.meshConnect(hostId);
      await refreshMesh();
      setStatus('Connected');
    } catch {
      setStatus('Connection failed');
    } finally {
      setConnectingId(null);
    }
  };

  const browseHost = (host: ReturnType<typeof normalizeMeshHost>) => {
    const root = host.remoteRootPath || '/';
    window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path: buildMeshPath(host.id, root) } }));
  };

  const saveRules = async () => {
    setBusy(true);
    try {
      await IPC.meshSaveSyncRules(rules);
      setStatus('Mirror rules saved');
    } finally { setBusy(false); }
  };

  const addRule = () => {
    const hostId = hosts[0]?.id || '';
    setRules(prev => [...prev, {
      id: `rule-${Date.now()}`,
      name: 'Deploy mirror',
      localPath: '',
      remoteHostId: hostId,
      remotePath: '/',
      pushOnSave: true,
      debounceMs: 800,
      enabled: true,
    }]);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <SettingsTabHeader
        title="Workspace Tools"
        description="Power-user integrations — configure hosts, mirrors, and sync jobs without cluttering the main UI."
        icon="smart_tools"
      />

      <div className="flex gap-1 mb-4 shrink-0 flex-wrap">
        {TOOL_TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setToolTab(t.id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
              toolTab === t.id
                ? 'bg-sky-500/15 text-sky-200 border-sky-400/30'
                : 'text-gray-500 border-white/5 hover:text-gray-300 hover:border-white/10'
            }`}
          >
            <Icons8Icon id={t.icon} size={14} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {status && (
        <div className="text-xs text-sky-300/90 mb-3 px-2 py-1.5 rounded bg-sky-500/10 border border-sky-400/20">
          {status}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto bndz-scrollbar pr-1">
        {toolTab === 'remote-mesh' && (
          <div className="space-y-5">
            <div className="bndz-mesh-dashboard">
              <div className="bndz-mesh-stat">
                <div className="bndz-mesh-stat-value">{meshStats.total}</div>
                <div className="bndz-mesh-stat-label">Hosts</div>
              </div>
              <div className="bndz-mesh-stat">
                <div className="bndz-mesh-stat-value" style={{ color: meshStats.online ? '#4ade80' : undefined }}>{meshStats.online}</div>
                <div className="bndz-mesh-stat-label">Online</div>
              </div>
              <div className="bndz-mesh-stat">
                <div className="bndz-mesh-stat-value">{meshStats.pinned}</div>
                <div className="bndz-mesh-stat-label">Pinned in tree</div>
              </div>
              <div className="bndz-mesh-stat">
                <div className="bndz-mesh-stat-value">{meshStats.rules}</div>
                <div className="bndz-mesh-stat-label">Active mirrors</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mb-2">
              <PluginToolbarButton onClick={() => void refreshMesh()}>Refresh status</PluginToolbarButton>
              <PluginToolbarButton onClick={() => openBottomPlugin?.('remote-mesh')}>Open plugin panel</PluginToolbarButton>
              {hosts.length > 0 && (
                <PluginToolbarButton
                  disabled={!!connectingId}
                  onClick={() => {
                    const offline = hosts.find(h => h.state !== 2);
                    if (offline) void connectHost(offline.id);
                  }}
                >
                  Quick connect
                </PluginToolbarButton>
              )}
            </div>

            {hosts.length > 0 && (
              <SettingsSection title="Host status">
                {hosts.map(host => (
                  <div key={host.id} className="bndz-mesh-host-card">
                    <span className={`bndz-mesh-host-dot ${hostDotClass(host.state)}`} />
                    <div className="bndz-mesh-host-body">
                      <div className="bndz-mesh-host-name">{host.alias}</div>
                      <div className="bndz-mesh-host-meta">
                        {MESH_PROVIDER_LABEL[host.provider]} · {host.hostname || host.s3Bucket || '—'}
                        {host.showInNavTree ? ' · pinned' : ''}
                        {' · '}{MESH_STATE_LABEL[host.state] || 'Unknown'}
                      </div>
                    </div>
                    <div className="bndz-mesh-host-actions">
                      <PluginToolbarButton
                        disabled={connectingId === host.id || host.state === 2}
                        onClick={() => void connectHost(host.id)}
                      >
                        {connectingId === host.id ? '…' : host.state === 2 ? 'Online' : 'Connect'}
                      </PluginToolbarButton>
                      <PluginToolbarButton onClick={() => browseHost(host)}>Browse</PluginToolbarButton>
                    </div>
                  </div>
                ))}
              </SettingsSection>
            )}

            <SettingsSection title="Folder tree integration">
              <Checkbox
                label={<span>Show <strong>Remote Mesh</strong> section in the folder tree when hosts are pinned</span>}
                checked={localConfig.meshShowInNavTree !== false}
                onChange={e => updateLocalConfig({ meshShowInNavTree: e.target.checked })}
              />
              <p className="text-[11px] text-gray-500 mt-2 leading-relaxed max-w-[640px]">
                Each host can be pinned individually when editing. Tree entries open the remote path directly — no bottom plugin required.
              </p>
              <Checkbox
                label={<span>Auto-connect when browsing from the tree</span>}
                checked={localConfig.meshAutoConnectOnBrowse !== false}
                onChange={e => updateLocalConfig({ meshAutoConnectOnBrowse: e.target.checked })}
              />
            </SettingsSection>

            <SettingsSection title="Remote hosts">
              <MeshHostsManager
                compact
                showHero={false}
                onStatus={setStatus}
                onNavigate={(path) => {
                  window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path } }));
                }}
              />
            </SettingsSection>
          </div>
        )}

        {toolTab === 'live-mirror' && (
          <div className="space-y-4">
            <SettingsSection title="Deploy-on-save mirrors">
              <p className="text-[11px] text-gray-500 mb-3 max-w-[640px]">
                Push local project folders to remote hosts when files are saved — ideal for instant deploys. Full controls also live in the Remote Mesh bottom plugin.
              </p>
              <div className="flex gap-2 mb-3">
                <PluginToolbarButton onClick={addRule}>Add rule</PluginToolbarButton>
                <PluginToolbarButton onClick={() => void saveRules()} disabled={busy}>Save rules</PluginToolbarButton>
                <PluginToolbarButton onClick={() => openBottomPlugin?.('remote-mesh')}>Open plugin panel</PluginToolbarButton>
              </div>
              {rules.length === 0 ? (
                <PluginEmptyState icon="sync_folders" title="No mirror rules" description="Create a rule to push local folders to a remote host on save." />
              ) : rules.map((r, i) => (
                <PluginCard key={r.id} className="!p-3 grid gap-2 mb-2">
                  <PluginFieldLabel>Name</PluginFieldLabel>
                  <input className={PLUGIN_INPUT_CLASS} value={r.name} onChange={e => setRules(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                  <PluginFieldLabel>Local folder</PluginFieldLabel>
                  <input className={PLUGIN_INPUT_CLASS} value={r.localPath} placeholder="C:\Projects\my-app" onChange={e => setRules(prev => prev.map((x, j) => j === i ? { ...x, localPath: e.target.value } : x))} />
                  <PluginFieldLabel>Remote host</PluginFieldLabel>
                  <select className={PLUGIN_INPUT_CLASS} value={r.remoteHostId} onChange={e => setRules(prev => prev.map((x, j) => j === i ? { ...x, remoteHostId: e.target.value } : x))}>
                    {hosts.map(h => <option key={h.id} value={h.id}>{h.alias}</option>)}
                  </select>
                  <PluginFieldLabel>Remote path</PluginFieldLabel>
                  <input className={PLUGIN_INPUT_CLASS} value={r.remotePath} onChange={e => setRules(prev => prev.map((x, j) => j === i ? { ...x, remotePath: e.target.value } : x))} />
                  <label className="flex items-center gap-2 text-xs text-gray-400">
                    <input type="checkbox" checked={r.pushOnSave} onChange={e => setRules(prev => prev.map((x, j) => j === i ? { ...x, pushOnSave: e.target.checked } : x))} />
                    Push on save
                  </label>
                </PluginCard>
              ))}
            </SettingsSection>
          </div>
        )}

        {toolTab === 'folder-sync' && (
          <SettingsSection title="Folder Sync plugin">
            <p className="text-[11px] text-gray-500 mb-3 max-w-[640px]">
              Bidirectional folder sync with watch mode — separate from Live Mirror deploy pushes. Configure jobs in the Folder Sync bottom plugin.
            </p>
            <div className="mt-3">
              <PluginToolbarButton onClick={() => openBottomPlugin?.('folder-sync')}>
                <Icons8Icon id="sync" size={12} /> Open Folder Sync plugin
              </PluginToolbarButton>
            </div>
          </SettingsSection>
        )}

        {toolTab === 'spatial-automation' && (
          <div className="space-y-5">
            <div className="bndz-ws-tools-hero">
              <div className="bndz-ws-tools-hero-title">Built-in workspaces</div>
              <div className="bndz-ws-tools-hero-desc">
                Zero-launch power tools wired into BNDZ — no external setup, no sidecars. Open a workspace below or jump in from Home.
              </div>
            </div>

            <div className="bndz-ws-launch-grid">
              <WorkspaceLaunchCard
                title="Spatial Canvas"
                desc="Freeform 2D board for file references across folders. Drop, annotate, arrange — nothing moves on disk."
                icon="view_grid"
                accent="#c48b4a"
                badge="Orrery"
                badgeVariant="default"
                features={['Marquee select', 'Constellation board', 'Sticky notes']}
                onClick={() => window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path: BNDZ_CANVAS } }))}
              />
              <WorkspaceLaunchCard
                title="Automation"
                desc="Visual pipelines: watch folders, filter files, copy/move, and rsync deploy to remote hosts."
                icon="zap_ui"
                accent="#38bdf8"
                badge="Circuit"
                badgeVariant="new"
                features={['Marquee select', 'Wire blocks', 'Run log']}
                onClick={() => window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path: BNDZ_AUTOMATION } }))}
              />
            </div>

            <SettingsSection title="Spatial Canvas">
              <p className="text-[11px] text-gray-500 mb-3 max-w-[640px]">
                Infinite board for file references — drag from any pane, pan with Alt+drag, zoom with scroll wheel.
              </p>
              <Checkbox
                label="Auto-save canvas layout"
                checked={localConfig.spatialCanvasAutoSave !== false}
                onChange={e => updateLocalConfig({ spatialCanvasAutoSave: e.target.checked })}
              />
              <div className="flex items-center gap-2 mt-3">
                <input
                  type="number"
                  min={100}
                  max={5000}
                  step={100}
                  className={PLUGIN_INPUT_CLASS + ' w-24'}
                  value={localConfig.spatialCanvasAutoSaveDelayMs ?? 400}
                  onChange={e => updateLocalConfig({ spatialCanvasAutoSaveDelayMs: Math.max(100, parseInt(e.target.value, 10) || 400) })}
                />
                <span className="text-xs text-gray-400">Auto-save debounce (ms)</span>
              </div>
              <div className="mt-3">
                <Checkbox
                  label="Scroll wheel pan & zoom (Ctrl+scroll to zoom)"
                  checked={localConfig.spatialCanvasWheelZoom !== false}
                  onChange={e => updateLocalConfig({ spatialCanvasWheelZoom: e.target.checked })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3 max-w-md">
                <div>
                  <PluginFieldLabel>Min zoom</PluginFieldLabel>
                  <input
                    type="number"
                    min={0.1}
                    max={1}
                    step={0.05}
                    className={PLUGIN_INPUT_CLASS}
                    value={localConfig.spatialCanvasMinZoom ?? 0.35}
                    onChange={e => updateLocalConfig({ spatialCanvasMinZoom: parseFloat(e.target.value) || 0.35 })}
                  />
                </div>
                <div>
                  <PluginFieldLabel>Max zoom</PluginFieldLabel>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    step={0.1}
                    className={PLUGIN_INPUT_CLASS}
                    value={localConfig.spatialCanvasMaxZoom ?? 2.5}
                    onChange={e => updateLocalConfig({ spatialCanvasMaxZoom: parseFloat(e.target.value) || 2.5 })}
                  />
                </div>
              </div>
            </SettingsSection>

            <SettingsSection title="Automation pipeline">
              <p className="text-[11px] text-gray-500 mb-3 max-w-[640px]">
                Visual file pipeline builder — watch folders, filter, copy/move, and deploy nodes.
              </p>
              <Checkbox
                label="Auto-save pipeline on edit"
                checked={localConfig.automationAutoSave !== false}
                onChange={e => updateLocalConfig({ automationAutoSave: e.target.checked })}
              />
              <div className="flex items-center gap-2 mt-3">
                <input
                  type="number"
                  min={200}
                  max={10000}
                  step={100}
                  className={PLUGIN_INPUT_CLASS + ' w-24'}
                  value={localConfig.automationAutoSaveDelayMs ?? 800}
                  onChange={e => updateLocalConfig({ automationAutoSaveDelayMs: Math.max(200, parseInt(e.target.value, 10) || 800) })}
                />
                <span className="text-xs text-gray-400">Auto-save debounce (ms)</span>
              </div>
              <div className="mt-3">
                <Checkbox
                  label="Pan canvas on scroll"
                  checked={localConfig.automationPanOnScroll !== false}
                  onChange={e => updateLocalConfig({ automationPanOnScroll: e.target.checked })}
                />
              </div>
              <Checkbox
                label="Zoom canvas on scroll"
                checked={localConfig.automationZoomOnScroll !== false}
                onChange={e => updateLocalConfig({ automationZoomOnScroll: e.target.checked })}
              />
            </SettingsSection>
          </div>
        )}
      </div>
    </div>
  );
}
