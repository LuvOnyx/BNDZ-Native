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
import { toWindowsPath } from '../../lib/pathUtils';
import { formatUiPath } from '../../lib/displayPath';

type ToolTab = 'remote-mesh' | 'live-mirror' | 'folder-sync' | 'spatial-automation' | 'mesh-drop' | 'ghost-link' | 'ram-staging';

const TOOL_TABS: { id: ToolTab; label: string; icon: string; desc: string }[] = [
  { id: 'remote-mesh', label: 'Remote Mesh', icon: 'cloud_ui', desc: 'SSH/SFTP hosts & S3 buckets' },
  { id: 'mesh-drop', label: 'Mesh Drop', icon: 'emblem-shared', desc: 'P2P WebRTC transfer' },
  { id: 'ghost-link', label: 'Ghost-Link', icon: 'emblem-symbolic-link', desc: 'Cold storage symlinks' },
  { id: 'ram-staging', label: 'RAM Staging', icon: 'hard_drive_ui', desc: 'RAM-disk staging zones' },
  { id: 'live-mirror', label: 'Live Mirror', icon: 'sync_folders', desc: 'Push folders on save' },
  { id: 'folder-sync', label: 'Folder Sync', icon: 'sync', desc: 'Bidirectional jobs' },
  { id: 'spatial-automation', label: 'Spatial & Pipelines', icon: 'view_grid', desc: 'Canvas and automations' },
];

type WorkspaceConfig = {
  meshShowInNavTree?: boolean;
  meshAutoConnectOnBrowse?: boolean;
  meshDropStunServers?: string;
  meshDropTurnUrl?: string;
  meshDropTurnUsername?: string;
  meshDropTurnCredential?: string;
  meshDropLanDiscovery?: boolean;
  meshDropWebLinkBase?: string;
  meshDropSignalingRelayUrl?: string;
  ghostLinkColdStorageRoot?: string;
  ramStagingPreferImDisk?: boolean;
  spatialCanvasAutoSave?: boolean;
  spatialCanvasAutoSaveDelayMs?: number;
  spatialCanvasWheelZoom?: boolean;
  spatialCanvasMinZoom?: number;
  spatialCanvasMaxZoom?: number;
  spatialCanvasV2?: boolean;
  commandDeck?: boolean;
  gpuInspection?: boolean;
  inspectionShaderMode?: 'passthrough' | 'histogram' | 'loupe';
  fluidDragStacks?: boolean;
  showQuickActionsBar?: boolean;
  automationAutoSave?: boolean;
  automationAutoSaveDelayMs?: number;
  automationPanOnScroll?: boolean;
  automationZoomOnScroll?: boolean;
};

type GhostStats = { ruleCount: number; ghostCount: number; bytesReclaimed: number };
type RamZone = {
  id: string;
  name: string;
  kind: string;
  sizeBudgetMb: number;
  usedBytes: number;
  stagedFileCount: number;
  isDirty: boolean;
};
type SyncJob = {
  id: string;
  name: string;
  sourcePath: string;
  destPath: string;
  watchEnabled: boolean;
  lastStatus?: string;
  lastSyncUtc?: string;
  mirrorMode?: boolean;
  lastError?: string;
};

function formatBytes(n: number): string {
  if (!n || n < 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

function formatWhen(iso?: string): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export default function WorkspaceToolsTabContent({
  openBottomPlugin,
  openMeshDrop,
  localConfig,
  updateLocalConfig,
}: {
  openBottomPlugin?: (id: string) => void;
  openMeshDrop?: () => void;
  localConfig: WorkspaceConfig;
  updateLocalConfig: (updates: Partial<WorkspaceConfig>) => void;
}) {
  const [toolTab, setToolTab] = useState<ToolTab>('remote-mesh');
  const [rules, setRules] = useState<MeshSyncRule[]>([]);
  const [hosts, setHosts] = useState<ReturnType<typeof normalizeMeshHost>[]>([]);
  const [busy, setBusy] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [ghostStats, setGhostStats] = useState<GhostStats>({ ruleCount: 0, ghostCount: 0, bytesReclaimed: 0 });
  const [ghostRecent, setGhostRecent] = useState<Array<{ path: string; bytesSaved: number }>>([]);
  const [ramZones, setRamZones] = useState<RamZone[]>([]);
  const [ramStatus, setRamStatus] = useState<{ imDiskAvailable?: boolean }>({});
  const [syncJobs, setSyncJobs] = useState<SyncJob[]>([]);
  const [toolLoading, setToolLoading] = useState(false);
  const [recentBoards, setRecentBoards] = useState<Array<{ id: string; name: string; pinCount: number; active: boolean }>>([]);
  const [recentPipelines, setRecentPipelines] = useState<Array<{ id: string; name: string; armed?: boolean }>>([]);

  useEffect(() => {
    if (toolTab !== 'spatial-automation') return;
    void import('../../lib/spatialCanvasStore').then(m => m.listSpatialBoards().then(setRecentBoards).catch(() => setRecentBoards([])));
    void import('../../lib/automationStore').then(m =>
      m.loadAutomationLibrary().then(lib =>
        setRecentPipelines(lib.pipelines.map(p => ({ id: p.id, name: p.name || 'Pipeline', armed: !!(p as any).armed }))),
      ).catch(() => setRecentPipelines([])),
    );
  }, [toolTab]);

  const refreshMesh = useCallback(async () => {
    const [r, h] = await Promise.all([IPC.meshGetSyncRules(), IPC.meshListHosts()]);
    setRules(r as MeshSyncRule[]);
    setHosts((h as Record<string, unknown>[]).map(normalizeMeshHost));
  }, []);

  const refreshGhost = useCallback(async () => {
    const s = await IPC.ghostLinkGetStats();
    const raw = (s.stats || {}) as Record<string, unknown>;
    setGhostStats({
      ruleCount: Number(raw.ruleCount ?? raw.RuleCount ?? 0),
      ghostCount: Number(raw.ghostCount ?? raw.GhostCount ?? 0),
      bytesReclaimed: Number(raw.bytesReclaimed ?? raw.BytesReclaimed ?? 0),
    });
    const ghosts = (s.ghosts || []) as Array<Record<string, unknown>>;
    setGhostRecent(ghosts.slice(0, 5).map(g => ({
      path: String(g.path ?? g.Path ?? g.originalPath ?? ''),
      bytesSaved: Number(g.bytesSaved ?? g.BytesSaved ?? 0),
    })).filter(g => g.path));
  }, []);

  const refreshRam = useCallback(async () => {
    const res = await IPC.ramStagingListZones();
    const zones = (res.zones || []) as Array<Record<string, unknown>>;
    setRamZones(zones.map(z => ({
      id: String(z.id ?? z.Id ?? ''),
      name: String(z.name ?? z.Name ?? 'Zone'),
      kind: String(z.kind ?? z.Kind ?? 'folder'),
      sizeBudgetMb: Number(z.sizeBudgetMb ?? z.SizeBudgetMb ?? 0),
      usedBytes: Number(z.usedBytes ?? z.UsedBytes ?? 0),
      stagedFileCount: Number(z.stagedFileCount ?? z.StagedFileCount ?? 0),
      isDirty: !!(z.isDirty ?? z.IsDirty),
    })).filter(z => z.id));
    const st = (res.status || {}) as Record<string, unknown>;
    setRamStatus({ imDiskAvailable: !!(st.imDiskAvailable ?? st.ImDiskAvailable) });
  }, []);

  const refreshSync = useCallback(async () => {
    const list = await IPC.getFolderSyncJobs();
    setSyncJobs((list || []).map((j: Record<string, unknown>) => ({
      id: String(j.id ?? j.Id ?? ''),
      name: String(j.name ?? j.Name ?? 'Sync'),
      sourcePath: String(j.sourcePath ?? j.SourcePath ?? ''),
      destPath: String(j.destPath ?? j.DestPath ?? ''),
      watchEnabled: !!(j.watchEnabled ?? j.WatchEnabled),
      lastStatus: String(j.lastStatus ?? j.LastStatus ?? 'idle'),
      lastSyncUtc: j.lastSyncUtc ? String(j.lastSyncUtc) : (j.LastSyncUtc ? String(j.LastSyncUtc) : undefined),
      mirrorMode: !!(j.mirrorMode ?? j.MirrorMode),
      lastError: j.lastError ? String(j.lastError) : undefined,
    })).filter(j => j.id));
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setToolLoading(true);
      try {
        if (toolTab === 'live-mirror' || toolTab === 'remote-mesh') await refreshMesh();
        if (toolTab === 'ghost-link') await refreshGhost();
        if (toolTab === 'ram-staging') await refreshRam();
        if (toolTab === 'folder-sync') await refreshSync();
      } finally {
        if (active) setToolLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [toolTab, refreshMesh, refreshGhost, refreshRam, refreshSync]);

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

  const removeRule = (id: string) => {
    setRules(prev => prev.filter(r => r.id !== id));
  };

  const pickColdRoot = async () => {
    const dest = await IPC.openFolderDialog('Choose cold storage root');
    if (dest) updateLocalConfig({ ghostLinkColdStorageRoot: toWindowsPath(dest) });
  };

  const pickMirrorLocal = async (index: number) => {
    const dest = await IPC.openFolderDialog('Choose local folder to mirror');
    if (!dest) return;
    setRules(prev => prev.map((x, j) => j === index ? { ...x, localPath: toWindowsPath(dest) } : x));
  };

  const activeTool = TOOL_TABS.find(t => t.id === toolTab) || TOOL_TABS[0];

  return (
    <div className="flex flex-col h-full min-h-0">
      <SettingsTabHeader
        title="Workspace Tools"
        description="Hosts, mirrors, staging, and built-in workspaces — configure once, use from the tree, list, or bottom panel."
        icon="smart_tools"
      />

      <div className="bndz-ws-tools-layout flex-1 min-h-0">
        <nav className="bndz-ws-tools-rail shrink-0" aria-label="Workspace tools">
          {TOOL_TABS.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setToolTab(t.id)}
              className={`bndz-ws-tools-rail-btn${toolTab === t.id ? ' is-active' : ''}`}
              title={t.desc}
            >
              <Icons8Icon id={t.icon} size={15} />
              <span className="bndz-ws-tools-rail-label">
                <span className="bndz-ws-tools-rail-title">{t.label}</span>
                <span className="bndz-ws-tools-rail-desc">{t.desc}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="bndz-ws-tools-pane flex flex-col min-h-0 min-w-0 flex-1">
          <div className="bndz-ws-tools-pane-head shrink-0">
            <div>
              <div className="bndz-ws-tools-pane-title">{activeTool.label}</div>
              <div className="bndz-ws-tools-pane-desc">{activeTool.desc}</div>
            </div>
            {toolLoading && <Icons8Icon id="loading" size={14} spin className="opacity-50" />}
          </div>

          {status && (
            <div className="bndz-ws-tools-status shrink-0">
              <span>{status}</span>
              <button type="button" className="bndz-ws-tools-status-dismiss" onClick={() => setStatus(null)} aria-label="Dismiss">
                <Icons8Icon id="close" size={12} />
              </button>
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
                    checked={!!localConfig.meshShowInNavTree}
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

            {toolTab === 'mesh-drop' && (
              <div className="space-y-4">
                <div className="bndz-mesh-dashboard">
                  <div className="bndz-mesh-stat">
                    <div className="bndz-mesh-stat-value">{localConfig.meshDropLanDiscovery !== false ? 'On' : 'Off'}</div>
                    <div className="bndz-mesh-stat-label">LAN discovery</div>
                  </div>
                  <div className="bndz-mesh-stat">
                    <div className="bndz-mesh-stat-value">{(localConfig.meshDropSignalingRelayUrl || '').trim() ? 'Set' : '—'}</div>
                    <div className="bndz-mesh-stat-label">Relay</div>
                  </div>
                  <div className="bndz-mesh-stat">
                    <div className="bndz-mesh-stat-value">{(localConfig.meshDropTurnUrl || '').trim() ? 'Set' : '—'}</div>
                    <div className="bndz-mesh-stat-label">TURN</div>
                  </div>
                  <div className="bndz-mesh-stat">
                    <div className="bndz-mesh-stat-value">{(localConfig.meshDropStunServers || '').split(';').filter(Boolean).length || 1}</div>
                    <div className="bndz-mesh-stat-label">STUN hosts</div>
                  </div>
                </div>
                <SettingsSection title="WebRTC signaling">
                  <PluginFieldLabel>STUN servers (semicolon-separated)</PluginFieldLabel>
                  <input
                    className={PLUGIN_INPUT_CLASS}
                    value={localConfig.meshDropStunServers || ''}
                    placeholder="stun:stun.l.google.com:19302"
                    onChange={e => updateLocalConfig({ meshDropStunServers: e.target.value })}
                  />
                  <PluginFieldLabel className="mt-3">TURN URL (optional)</PluginFieldLabel>
                  <input
                    className={PLUGIN_INPUT_CLASS}
                    value={localConfig.meshDropTurnUrl || ''}
                    placeholder="turn:your-server:3478"
                    onChange={e => updateLocalConfig({ meshDropTurnUrl: e.target.value })}
                  />
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <PluginFieldLabel>TURN username</PluginFieldLabel>
                      <input className={PLUGIN_INPUT_CLASS} value={localConfig.meshDropTurnUsername || ''} onChange={e => updateLocalConfig({ meshDropTurnUsername: e.target.value })} />
                    </div>
                    <div>
                      <PluginFieldLabel>TURN credential</PluginFieldLabel>
                      <input className={PLUGIN_INPUT_CLASS} type="password" value={localConfig.meshDropTurnCredential || ''} onChange={e => updateLocalConfig({ meshDropTurnCredential: e.target.value })} />
                    </div>
                  </div>
                  <Checkbox
                    className="mt-3"
                    label="Enable LAN discovery (UDP beacon + offer HTTP)"
                    checked={localConfig.meshDropLanDiscovery !== false}
                    onChange={e => updateLocalConfig({ meshDropLanDiscovery: e.target.checked })}
                  />
                  <p className="text-[11px] text-gray-500 mt-1">Same-subnet peers find active Mesh Drop offers via BNDZ UDP beacons (no cloud).</p>
                  <PluginFieldLabel className="mt-3">Web share link base</PluginFieldLabel>
                  <input
                    className={PLUGIN_INPUT_CLASS}
                    value={localConfig.meshDropWebLinkBase || ''}
                    placeholder="https://bndz.app/mesh-drop"
                    onChange={e => updateLocalConfig({ meshDropWebLinkBase: e.target.value })}
                  />
                  <PluginFieldLabel className="mt-3">Signaling relay URL (optional)</PluginFieldLabel>
                  <input
                    className={PLUGIN_INPUT_CLASS}
                    value={localConfig.meshDropSignalingRelayUrl || ''}
                    placeholder="https://relay.example.com"
                    onChange={e => updateLocalConfig({ meshDropSignalingRelayUrl: e.target.value })}
                  />
                  <div className="mt-3">
                    <PluginToolbarButton onClick={() => (openMeshDrop ?? (() => openBottomPlugin?.('mesh-drop')))()}>
                      Open Mesh Drop panel
                    </PluginToolbarButton>
                  </div>
                </SettingsSection>
              </div>
            )}

            {toolTab === 'ghost-link' && (
              <div className="space-y-4">
                <div className="bndz-mesh-dashboard">
                  <div className="bndz-mesh-stat">
                    <div className="bndz-mesh-stat-value">{ghostStats.ghostCount}</div>
                    <div className="bndz-mesh-stat-label">Ghost links</div>
                  </div>
                  <div className="bndz-mesh-stat">
                    <div className="bndz-mesh-stat-value">{formatBytes(ghostStats.bytesReclaimed)}</div>
                    <div className="bndz-mesh-stat-label">Reclaimed</div>
                  </div>
                  <div className="bndz-mesh-stat">
                    <div className="bndz-mesh-stat-value">{ghostStats.ruleCount}</div>
                    <div className="bndz-mesh-stat-label">Rules</div>
                  </div>
                </div>

                <SettingsSection title="Cold storage">
                  <PluginFieldLabel>Default cold storage root</PluginFieldLabel>
                  <div className="flex gap-2">
                    <input
                      className={PLUGIN_INPUT_CLASS + ' flex-1'}
                      value={localConfig.ghostLinkColdStorageRoot || ''}
                      placeholder="D:\\ColdStorage"
                      onChange={e => updateLocalConfig({ ghostLinkColdStorageRoot: e.target.value })}
                    />
                    <PluginToolbarButton onClick={() => void pickColdRoot()}>Browse…</PluginToolbarButton>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-2">Used by context-menu offload and Automation Ghost-Link blocks. Original paths stay as symlinks.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <PluginToolbarButton onClick={() => void refreshGhost()}>Refresh stats</PluginToolbarButton>
                    <PluginToolbarButton onClick={() => openBottomPlugin?.('ghost-link')}>Open Ghost-Link plugin</PluginToolbarButton>
                  </div>
                </SettingsSection>

                <SettingsSection title="Recent ghosts">
                  {ghostRecent.length === 0 ? (
                    <PluginEmptyState
                      icon="emblem-symbolic-link"
                      title="No ghost links yet"
                      description="Offload cold files from the list context menu or the Ghost-Link plugin — originals become symlinks."
                    />
                  ) : ghostRecent.map(g => (
                    <div key={g.path} className="bndz-ws-tools-row">
                      <div className="bndz-ws-tools-row-body">
                        <div className="bndz-ws-tools-row-title truncate" title={formatUiPath(g.path)}>{formatUiPath(g.path)}</div>
                        <div className="bndz-ws-tools-row-meta">{formatBytes(g.bytesSaved)} saved on volume</div>
                      </div>
                    </div>
                  ))}
                </SettingsSection>
              </div>
            )}

            {toolTab === 'ram-staging' && (
              <div className="space-y-4">
                <div className="bndz-mesh-dashboard">
                  <div className="bndz-mesh-stat">
                    <div className="bndz-mesh-stat-value">{ramZones.length}</div>
                    <div className="bndz-mesh-stat-label">Zones</div>
                  </div>
                  <div className="bndz-mesh-stat">
                    <div className="bndz-mesh-stat-value">{ramZones.filter(z => z.isDirty).length}</div>
                    <div className="bndz-mesh-stat-label">Dirty</div>
                  </div>
                  <div className="bndz-mesh-stat">
                    <div className="bndz-mesh-stat-value">{ramStatus.imDiskAvailable ? 'Yes' : 'No'}</div>
                    <div className="bndz-mesh-stat-label">ImDisk</div>
                  </div>
                </div>

                <SettingsSection title="Staging preference">
                  <Checkbox
                    label="Prefer ImDisk RAM volumes when available"
                    checked={localConfig.ramStagingPreferImDisk !== false}
                    onChange={e => updateLocalConfig({ ramStagingPreferImDisk: e.target.checked })}
                  />
                  <p className="text-[11px] text-gray-500 mt-2">
                    Zones appear under <span className="bndz-mono text-gray-400">/bndz/ram</span>. Without ImDisk, BNDZ uses fast folder staging on NVMe.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <PluginToolbarButton onClick={() => void refreshRam()}>Refresh zones</PluginToolbarButton>
                    <PluginToolbarButton onClick={() => openBottomPlugin?.('ram-staging')}>Open RAM Staging plugin</PluginToolbarButton>
                  </div>
                </SettingsSection>

                <SettingsSection title="Zones">
                  {ramZones.length === 0 ? (
                    <PluginEmptyState
                      icon="hard_drive_ui"
                      title="No staging zones"
                      description="Create a zone in the RAM Staging plugin, then stage projects and flush when you are done."
                    />
                  ) : ramZones.map(z => {
                    const pct = z.sizeBudgetMb > 0
                      ? Math.min(100, (z.usedBytes / (z.sizeBudgetMb * 1024 * 1024)) * 100)
                      : 0;
                    return (
                      <div key={z.id} className="bndz-ws-tools-row">
                        <div className="bndz-ws-tools-row-body min-w-0 flex-1">
                          <div className="bndz-ws-tools-row-title">
                            {z.name}
                            {z.isDirty ? <span className="bndz-ws-tools-pill is-warn">Dirty</span> : null}
                            <span className="bndz-ws-tools-pill">{z.kind === 'ramdisk' ? 'RAM' : 'Fast'}</span>
                          </div>
                          <div className="bndz-ws-tools-row-meta">
                            {formatBytes(z.usedBytes)} / {z.sizeBudgetMb} MB · {z.stagedFileCount} file{z.stagedFileCount === 1 ? '' : 's'}
                          </div>
                          <div className="bndz-ws-tools-meter" aria-hidden>
                            <span style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </SettingsSection>
              </div>
            )}

            {toolTab === 'live-mirror' && (
              <div className="space-y-4">
                <SettingsSection title="Deploy-on-save mirrors">
                  <p className="text-[11px] text-gray-500 mb-3 max-w-[640px]">
                    Push local project folders to remote hosts when files are saved — ideal for instant deploys. Full controls also live in the Remote Mesh bottom plugin.
                  </p>
                  <div className="flex gap-2 mb-3 flex-wrap">
                    <PluginToolbarButton onClick={addRule}>Add rule</PluginToolbarButton>
                    <PluginToolbarButton onClick={() => void saveRules()} disabled={busy}>Save rules</PluginToolbarButton>
                    <PluginToolbarButton onClick={() => openBottomPlugin?.('remote-mesh')}>Open plugin panel</PluginToolbarButton>
                  </div>
                  {rules.length === 0 ? (
                    <PluginEmptyState icon="sync_folders" title="No mirror rules" description="Create a rule to push local folders to a remote host on save." />
                  ) : rules.map((r, i) => (
                    <PluginCard key={r.id} className="!p-3 grid gap-2 mb-2">
                      <div className="flex items-center justify-between gap-2">
                        <PluginFieldLabel className="!mb-0">Name</PluginFieldLabel>
                        <PluginToolbarButton onClick={() => removeRule(r.id)} title="Remove rule">Remove</PluginToolbarButton>
                      </div>
                      <input className={PLUGIN_INPUT_CLASS} value={r.name} onChange={e => setRules(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                      <PluginFieldLabel>Local folder</PluginFieldLabel>
                      <div className="flex gap-2">
                        <input className={PLUGIN_INPUT_CLASS + ' flex-1'} value={r.localPath} placeholder="C:\Projects\my-app" onChange={e => setRules(prev => prev.map((x, j) => j === i ? { ...x, localPath: e.target.value } : x))} />
                        <PluginToolbarButton onClick={() => void pickMirrorLocal(i)}>Browse…</PluginToolbarButton>
                      </div>
                      <PluginFieldLabel>Remote host</PluginFieldLabel>
                      <select className={PLUGIN_INPUT_CLASS} value={r.remoteHostId} onChange={e => setRules(prev => prev.map((x, j) => j === i ? { ...x, remoteHostId: e.target.value } : x))}>
                        {hosts.length === 0 && <option value="">No hosts configured</option>}
                        {hosts.map(h => <option key={h.id} value={h.id}>{h.alias}</option>)}
                      </select>
                      <PluginFieldLabel>Remote path</PluginFieldLabel>
                      <input className={PLUGIN_INPUT_CLASS} value={r.remotePath} onChange={e => setRules(prev => prev.map((x, j) => j === i ? { ...x, remotePath: e.target.value } : x))} />
                      <div className="flex flex-wrap items-center gap-4 mt-1">
                        <Checkbox
                          label="Enabled"
                          checked={r.enabled !== false}
                          onChange={e => setRules(prev => prev.map((x, j) => j === i ? { ...x, enabled: e.target.checked } : x))}
                        />
                        <Checkbox
                          label="Push on save"
                          checked={!!r.pushOnSave}
                          onChange={e => setRules(prev => prev.map((x, j) => j === i ? { ...x, pushOnSave: e.target.checked } : x))}
                        />
                        <label className="flex items-center gap-2 text-xs text-gray-400">
                          Debounce
                          <input
                            type="number"
                            min={100}
                            max={10000}
                            step={100}
                            className={PLUGIN_INPUT_CLASS + ' w-20'}
                            value={r.debounceMs ?? 800}
                            onChange={e => setRules(prev => prev.map((x, j) => j === i ? { ...x, debounceMs: Math.max(100, parseInt(e.target.value, 10) || 800) } : x))}
                          />
                          <span>ms</span>
                        </label>
                      </div>
                    </PluginCard>
                  ))}
                </SettingsSection>
              </div>
            )}

            {toolTab === 'folder-sync' && (
              <div className="space-y-4">
                <SettingsSection title="Bidirectional jobs">
                  <p className="text-[11px] text-gray-500 mb-3 max-w-[640px]">
                    Two-way folder sync with optional watch mode — separate from Live Mirror deploy pushes.
                  </p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    <PluginToolbarButton onClick={() => void refreshSync()}>Refresh jobs</PluginToolbarButton>
                    <PluginToolbarButton onClick={() => openBottomPlugin?.('folder-sync')}>
                      <Icons8Icon id="sync" size={12} /> Open Folder Sync plugin
                    </PluginToolbarButton>
                  </div>
                  {syncJobs.length === 0 ? (
                    <PluginEmptyState
                      icon="sync"
                      title="No sync jobs"
                      description="Create a source ↔ destination job in the Folder Sync plugin, then enable watching for live updates."
                    />
                  ) : syncJobs.map(job => (
                    <div key={job.id} className="bndz-ws-tools-row">
                      <div className="bndz-ws-tools-row-body min-w-0 flex-1">
                        <div className="bndz-ws-tools-row-title">
                          {job.name}
                          {job.watchEnabled ? <span className="bndz-ws-tools-pill is-live">Watching</span> : null}
                          {job.mirrorMode ? <span className="bndz-ws-tools-pill">Mirror</span> : null}
                        </div>
                        <div className="bndz-ws-tools-row-meta truncate" title={`${job.sourcePath} → ${job.destPath}`}>
                          {job.sourcePath || '—'} → {job.destPath || '—'}
                        </div>
                        <div className="bndz-ws-tools-row-meta">
                          Status: {job.lastStatus || 'idle'} · Last sync: {formatWhen(job.lastSyncUtc)}
                        </div>
                        {job.lastError && <div className="text-[10px] text-amber-300/90 mt-1">{job.lastError}</div>}
                      </div>
                      <PluginToolbarButton
                        disabled={job.lastStatus === 'syncing'}
                        onClick={() => void IPC.runFolderSync(job.id).then(() => { setStatus(`Synced ${job.name}`); void refreshSync(); })}
                      >
                        Run
                      </PluginToolbarButton>
                    </div>
                  ))}
                </SettingsSection>
              </div>
            )}

            {toolTab === 'spatial-automation' && (
              <div className="space-y-5">
                <div className="bndz-ws-tools-hero">
                  <div className="bndz-ws-tools-hero-title">Built-in workspaces</div>
                  <div className="bndz-ws-tools-hero-desc">
                    Zero-launch power tools wired into BNDZ — open from Home, the tree, or here. No sidecars.
                  </div>
                </div>

                <div className="bndz-ws-launch-grid">
                  <WorkspaceLaunchCard
                    title="Spatial Canvas"
                    desc="Freeform constellation board for file pins across folders. Annotate, arrange, snapshot — nothing moves on disk."
                    icon="view_grid"
                    accent="#c48b4a"
                    badge="Orrery"
                    badgeVariant="default"
                    features={['Multi-board', 'Snapshots', 'Relations', 'Automation seed']}
                    onClick={() => window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path: BNDZ_CANVAS } }))}
                  />
                  <WorkspaceLaunchCard
                    title="Automation pipelines"
                    desc="Visual file pipelines: watch, filter, branch, copy/move, and deploy — armed watchers restore at boot."
                    icon="zap_ui"
                    accent="#34d399"
                    badge="Circuit"
                    badgeVariant="green"
                    features={['30 blocks', 'Live watch', 'Schedules', 'Run history']}
                    onClick={() => window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path: BNDZ_AUTOMATION } }))}
                  />
                </div>

                {(recentBoards.length > 0 || recentPipelines.length > 0) && (
                  <SettingsSection title="Recent boards & pipelines">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <div className="text-[10px] uppercase tracking-wide text-white/35">Spatial boards</div>
                        {recentBoards.length === 0 ? (
                          <p className="text-[11px] text-white/30">No boards yet</p>
                        ) : recentBoards.slice(0, 5).map(b => (
                          <button
                            key={b.id}
                            type="button"
                            className="bndz-ws-tools-row w-full text-left"
                            onClick={() => {
                              void import('../../lib/spatialCanvasStore').then(m => m.switchSpatialBoard(b.id));
                              window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path: BNDZ_CANVAS } }));
                            }}
                          >
                            <div className="bndz-ws-tools-row-body">
                              <div className="bndz-ws-tools-row-title">
                                {b.name}{b.active ? <span className="bndz-ws-tools-pill is-live">Active</span> : null}
                              </div>
                              <div className="bndz-ws-tools-row-meta">{b.pinCount} pin(s)</div>
                            </div>
                          </button>
                        ))}
                      </div>
                      <div className="space-y-1.5">
                        <div className="text-[10px] uppercase tracking-wide text-white/35">Pipelines</div>
                        {recentPipelines.length === 0 ? (
                          <p className="text-[11px] text-white/30">No pipelines yet</p>
                        ) : recentPipelines.slice(0, 5).map(p => (
                          <button
                            key={p.id}
                            type="button"
                            className="bndz-ws-tools-row w-full text-left"
                            onClick={() => {
                              window.dispatchEvent(new CustomEvent('bndz-automation-select-pipeline', { detail: { id: p.id } }));
                              window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path: BNDZ_AUTOMATION } }));
                            }}
                          >
                            <div className="bndz-ws-tools-row-body">
                              <div className="bndz-ws-tools-row-title">
                                {p.name}{p.armed ? <span className="bndz-ws-tools-pill is-live">Armed</span> : null}
                              </div>
                              <div className="bndz-ws-tools-row-meta">{p.id}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </SettingsSection>
                )}

                <SettingsSection title="Spatial Canvas">
                  <p className="text-[11px] text-gray-500 mb-3 max-w-[640px]">
                    Infinite board for file references — drag from any pane, pan with Alt+drag or middle mouse, zoom with Ctrl+scroll.
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
                  <div className="mt-3">
                    <Checkbox
                      label="Spatial Canvas v2 (spring board, bezier wires, pip thumbnails)"
                      checked={localConfig.spatialCanvasV2 !== false}
                      onChange={e => updateLocalConfig({ spatialCanvasV2: e.target.checked })}
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

                <SettingsSection title="Automation pipelines">
                  <p className="text-[11px] text-gray-500 mb-3 max-w-[640px]">
                    Visual pipeline builder — separate from Custom Event Actions under Configuration → Automation.
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

                <SettingsSection title="List & selection chrome">
                  <p className="text-[11px] text-gray-500 mb-3 max-w-[640px]">
                    Workstation interaction systems that apply outside Spatial/Automation — Command Deck, fluid drag, and GPU preview shaders.
                  </p>
                  <Checkbox
                    label="Context Command Deck (selection tool morph bar)"
                    checked={localConfig.commandDeck === true}
                    onChange={e => updateLocalConfig({ commandDeck: e.target.checked })}
                  />
                  <div className="mt-2">
                    <Checkbox
                      label="Quick Actions Bar (multi-select strip below omnibar)"
                      checked={localConfig.showQuickActionsBar === true}
                      onChange={e => updateLocalConfig({ showQuickActionsBar: e.target.checked })}
                    />
                  </div>
                  <div className="mt-2">
                    <Checkbox
                      label="Fluid drag stacks (thumbnail fan while dragging files)"
                      checked={localConfig.fluidDragStacks !== false}
                      onChange={e => updateLocalConfig({ fluidDragStacks: e.target.checked })}
                    />
                  </div>
                  <div className="mt-2">
                    <Checkbox
                      label="GPU inspection shaders (luma inspect / loupe in preview)"
                      checked={localConfig.gpuInspection !== false}
                      onChange={e => updateLocalConfig({ gpuInspection: e.target.checked })}
                    />
                  </div>
                  <div className="mt-3 max-w-xs">
                    <PluginFieldLabel>Default image inspection mode</PluginFieldLabel>
                    <select
                      className={PLUGIN_INPUT_CLASS}
                      value={localConfig.inspectionShaderMode || 'passthrough'}
                      onChange={e => updateLocalConfig({
                        inspectionShaderMode: e.target.value as 'passthrough' | 'histogram' | 'loupe',
                      })}
                    >
                      <option value="passthrough">Standard (ImageZoom)</option>
                      <option value="histogram">Luma inspect</option>
                      <option value="loupe">Loupe magnifier</option>
                    </select>
                  </div>
                </SettingsSection>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
