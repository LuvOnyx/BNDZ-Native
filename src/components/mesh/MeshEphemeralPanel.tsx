import React, { useCallback, useEffect, useState } from 'react';
import { IPC } from '../../lib/ipcBridge';
import { buildMeshPath } from '../../lib/meshPaths';
import { Icons8Icon } from '../Icons8Icon';
import {
  PluginToolbarButton, PluginCard, PluginEmptyState, PluginHeroStrip, PluginHeroActionButton,
  PluginFieldLabel, PLUGIN_INPUT_CLASS,
} from '../plugins/PluginPanelPrimitives';
import {
  type IncusEndpoint,
  type IncusEphemeralInstance,
  normalizeIncusEndpoint,
  normalizeIncusEphemeral,
  normalizeIncusServerInstance,
  type IncusServerInstance,
  createEmptyIncusEndpoint,
  incusEndpointToPayload,
} from '../../lib/incusTypes';
import { requestNativeConfirm } from '../../lib/nativeDialog';
import MeshIncusInstanceInspector from './MeshIncusInstanceInspector';

type Props = {
  onNavigate?: (path: string) => void;
  onStatus?: (msg: string | null) => void;
};

export default function MeshEphemeralPanel({ onNavigate, onStatus }: Props) {
  const [endpoints, setEndpoints] = useState<IncusEndpoint[]>([]);
  const [instances, setInstances] = useState<IncusEphemeralInstance[]>([]);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<IncusEndpoint | null | 'new'>(null);
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);
  const [launchImage, setLaunchImage] = useState('ubuntu/24.04/cloud');
  const [launchType, setLaunchType] = useState<'container' | 'virtual-machine'>('container');
  const [launchAlias, setLaunchAlias] = useState('');
  const [launchName, setLaunchName] = useState('');
  const [launchPersistent, setLaunchPersistent] = useState(false);
  const [imageAliases, setImageAliases] = useState<Array<{ name: string; description?: string }>>([]);
  const [serverInstances, setServerInstances] = useState<IncusServerInstance[]>([]);
  const [inventoryBusy, setInventoryBusy] = useState(false);
  const [profiles, setProfiles] = useState<Array<{ name: string; description?: string }>>([]);
  const [networks, setNetworks] = useState<Array<{ name: string; type?: string }>>([]);
  const [launchProfiles, setLaunchProfiles] = useState('default');
  const [launchNetwork, setLaunchNetwork] = useState('');
  const [launchCpu, setLaunchCpu] = useState('');
  const [launchMemory, setLaunchMemory] = useState('');
  const [inspectId, setInspectId] = useState<string | null>(null);

  const setStatus = (msg: string | null) => onStatus?.(msg);

  const refresh = useCallback(async () => {
    try {
      const [eps, inst] = await Promise.all([
        IPC.meshIncusListEndpoints(),
        IPC.meshIncusListEphemeral(),
      ]);
      const endpointsNorm = (eps as Record<string, unknown>[]).map(normalizeIncusEndpoint);
      setEndpoints(endpointsNorm);
      setInstances((inst as Record<string, unknown>[]).map(normalizeIncusEphemeral));
      if (!selectedEndpointId && endpointsNorm[0]) setSelectedEndpointId(endpointsNorm[0].id);
      return endpointsNorm;
    } catch (e: any) {
      setStatus(e?.message || 'Could not load Incus mesh state');
      return [];
    }
  }, [onStatus, selectedEndpointId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Reconcile tracked ephemerals against live Incus on first open (app restart / stale DB).
  useEffect(() => {
    let cancelled = false;
    void IPC.meshIncusReconcile().then(res => {
      if (cancelled || !res.ok) return;
      if (res.instances) setInstances(res.instances.map((i: Record<string, unknown>) => normalizeIncusEphemeral(i)));
    }).catch(() => { /* ignore — list still loads from DB */ });
    return () => { cancelled = true; };
  }, []);

  // Auto-refresh ephemerals waiting for IP (cloud-init / DHCP lag).
  useEffect(() => {
    const pending = instances.some(i =>
      (!i.ipv4 && !i.ipv6) || (!i.meshHostId && (i.status === 'Running' || i.status === 'Creating')));
    if (!pending) return;
    const timer = window.setInterval(() => {
      void (async () => {
        for (const inst of instances) {
          if (inst.ipv4 || inst.ipv6) continue;
          if (inst.status === 'Error') continue;
          try { await IPC.meshIncusRefresh(inst.id); } catch { /* ignore */ }
        }
        await refresh();
      })();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [instances, refresh]);

  useEffect(() => {
    const ep = endpoints.find(e => e.id === selectedEndpointId);
    if (ep) {
      setLaunchImage(ep.defaultImage || 'ubuntu/24.04/cloud');
      setLaunchType(ep.defaultInstanceType === 'virtual-machine' ? 'virtual-machine' : 'container');
    }
  }, [selectedEndpointId, endpoints]);

  useEffect(() => {
    if (!selectedEndpointId) {
      setImageAliases([]);
      setProfiles([]);
      setNetworks([]);
      return;
    }
    let cancelled = false;
    void IPC.meshIncusListImages(selectedEndpointId).then(res => {
      if (cancelled) return;
      if (res.ok) setImageAliases(res.aliases.map(a => ({ name: a.name, description: a.description })));
    }).catch(() => {
      if (!cancelled) setImageAliases([]);
    });
    void IPC.meshIncusListProfiles(selectedEndpointId).then(res => {
      if (cancelled) return;
      if (res.ok) {
        setProfiles(res.profiles.map(p => ({
          name: String((p as any).name ?? (p as any).Name ?? ''),
          description: (p as any).description ?? (p as any).Description,
        })));
      }
    }).catch(() => { if (!cancelled) setProfiles([]); });
    void IPC.meshIncusListNetworks(selectedEndpointId).then(res => {
      if (cancelled) return;
      if (res.ok) {
        const nets = res.networks.map(n => ({
          name: String((n as any).name ?? (n as any).Name ?? ''),
          type: (n as any).type ?? (n as any).Type,
        }));
        setNetworks(nets);
        if (!launchNetwork && nets[0]) setLaunchNetwork(nets[0].name);
      }
    }).catch(() => { if (!cancelled) setNetworks([]); });
    return () => { cancelled = true; };
  }, [selectedEndpointId]);

  const loadServerInventory = useCallback(async () => {
    if (!selectedEndpointId) {
      setServerInstances([]);
      return;
    }
    setInventoryBusy(true);
    try {
      const res = await IPC.meshIncusListServerInstances(selectedEndpointId);
      if (!res.ok) throw new Error(res.error || 'Could not list Incus instances');
      const tracked = new Set((res.tracked || []).map(n => n.toLowerCase()));
      setServerInstances((res.instances as Record<string, unknown>[]).map(raw =>
        normalizeIncusServerInstance(raw, tracked)));
    } catch (e: any) {
      setStatus(e?.message || 'Server inventory failed');
      setServerInstances([]);
    } finally {
      setInventoryBusy(false);
    }
  }, [selectedEndpointId, onStatus]);

  useEffect(() => {
    void loadServerInventory();
  }, [loadServerInventory]);

  const saveEndpoint = async (endpoint: IncusEndpoint) => {
    setBusy(true);
    setStatus(null);
    try {
      await IPC.meshIncusUpsertEndpoint(incusEndpointToPayload(endpoint));
      await refresh();
      setEditor(null);
      setSelectedEndpointId(endpoint.id);
      setStatus(`Saved Incus endpoint ${endpoint.alias}`);
    } catch (e: any) {
      setStatus(e?.message || 'Could not save endpoint');
    } finally { setBusy(false); }
  };

  const deleteEndpoint = async (endpointId: string) => {
    const ok = await requestNativeConfirm({
      title: 'Remove Incus endpoint',
      message: 'Remove this Incus endpoint? Tracked ephemeral instances will be destroyed when possible.',
      type: 'warning',
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await IPC.meshIncusDeleteEndpoint(endpointId);
      await refresh();
      if (selectedEndpointId === endpointId) setSelectedEndpointId(null);
      setStatus('Endpoint removed');
    } catch (e: any) {
      setStatus(e?.message || 'Delete failed');
    } finally { setBusy(false); }
  };

  const testEndpoint = async (endpointId: string) => {
    setBusy(true);
    try {
      const res = await IPC.meshIncusTestEndpoint(endpointId);
      if (!res.ok) throw new Error(res.error || 'Trust probe failed');
      if (res.endpoints) setEndpoints(res.endpoints.map((e: Record<string, unknown>) => normalizeIncusEndpoint(e)));
      setStatus(res.info?.trusted ? 'Trusted — Incus API reachable' : 'Connected but not trusted yet — paste a trust token and save');
    } catch (e: any) {
      setStatus(e?.message || 'Test failed');
      await refresh();
    } finally { setBusy(false); }
  };

  const launch = async () => {
    if (!selectedEndpointId) {
      setStatus('Add an Incus endpoint first');
      return;
    }
    setBusy(true);
    setStatus('Launching ephemeral instance…');
    try {
      const profileList = launchProfiles.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
      const config: Record<string, string> = {};
      if (launchCpu.trim()) config['limits.cpu'] = launchCpu.trim();
      if (launchMemory.trim()) config['limits.memory'] = launchMemory.trim();
      const res = await IPC.meshIncusLaunch({
        endpointId: selectedEndpointId,
        name: launchName.trim() || undefined,
        imageAlias: launchImage,
        instanceType: launchType,
        ephemeral: !launchPersistent,
        start: true,
        registerMeshHost: true,
        alias: launchAlias || undefined,
        profiles: profileList.length ? profileList : undefined,
        network: launchNetwork || undefined,
        config: Object.keys(config).length ? config : undefined,
      });
      if (!res.ok) throw new Error(res.error || 'Launch failed');
      await refresh();
      const inst = res.instance ? normalizeIncusEphemeral(res.instance as Record<string, unknown>) : null;
      const addr = inst?.ipv4 || inst?.ipv6;
      setStatus(addr
        ? `Ready — ${inst?.instanceName} @ ${addr} registered on Mesh`
        : `Launched ${inst?.instanceName || 'instance'} — waiting for IP`);
    } catch (e: any) {
      setStatus(e?.message || 'Launch failed');
      await refresh();
    } finally { setBusy(false); }
  };

  const refreshOne = async (id: string) => {
    setBusy(true);
    try {
      const res = await IPC.meshIncusRefresh(id);
      if (!res.ok) throw new Error(res.error || 'Refresh failed');
      await refresh();
      setStatus('Instance state refreshed');
    } catch (e: any) {
      setStatus(e?.message || 'Refresh failed');
    } finally { setBusy(false); }
  };

  const instanceAction = async (id: string, action: 'start' | 'stop' | 'restart') => {
    setBusy(true);
    try {
      const res = await IPC.meshIncusInstanceAction(id, action);
      if (!res.ok) throw new Error(res.error || `${action} failed`);
      await refresh();
      void loadServerInventory();
      setStatus(`Instance ${action} completed`);
    } catch (e: any) {
      setStatus(e?.message || `${action} failed`);
      await refresh();
    } finally { setBusy(false); }
  };

  const importServerInstance = async (inst: IncusServerInstance) => {
    if (!selectedEndpointId || inst.tracked) return;
    setBusy(true);
    try {
      const res = await IPC.meshIncusImportInstance({
        endpointId: selectedEndpointId,
        instanceName: inst.name,
        alias: `Incus · ${inst.name}`,
        registerMeshHost: true,
      });
      if (!res.ok) throw new Error(res.error || 'Import failed');
      await refresh();
      void loadServerInventory();
      setStatus(`Imported ${inst.name} — Mesh host registered when IP is ready`);
    } catch (e: any) {
      setStatus(e?.message || 'Import failed');
    } finally { setBusy(false); }
  };

  const destroyOne = async (id: string) => {
    const ok = await requestNativeConfirm({
      title: 'Destroy ephemeral host',
      message: 'Stop and delete this Incus instance, and remove its Mesh SSH host?',
      type: 'warning',
      confirmLabel: 'Destroy',
      cancelLabel: 'Cancel',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await IPC.meshIncusDestroy(id);
      if (!res.ok) throw new Error(res.error || 'Destroy failed');
      await refresh();
      setStatus('Ephemeral host destroyed');
    } catch (e: any) {
      setStatus(e?.message || 'Destroy failed');
    } finally { setBusy(false); }
  };

  const browseMesh = async (inst: IncusEphemeralInstance) => {
    if (!inst.meshHostId) {
      setStatus('No Mesh host registered yet — Refresh after IP appears');
      return;
    }
    setBusy(true);
    try {
      const res = await IPC.meshConnect(inst.meshHostId);
      if (res?.error) throw new Error(res.error);
      onNavigate?.(buildMeshPath(inst.meshHostId, ''));
      setStatus(`Browsing ${inst.instanceName}`);
    } catch (e: any) {
      setStatus(e?.message || 'Browse failed — check SSH user/key on the endpoint');
    } finally { setBusy(false); }
  };

  const shellHere = async (inst: IncusEphemeralInstance) => {
    if (!inst.meshHostId) {
      setStatus('No Mesh host registered yet — Refresh after IP appears');
      return;
    }
    setBusy(true);
    try {
      const res = await IPC.meshTerminalOpen({ hostId: inst.meshHostId, cwd: '/' });
      if (res?.error) throw new Error(res.error);
      setStatus(`Shell Here · ${inst.instanceName}`);
    } catch (e: any) {
      setStatus(e?.message || 'Shell Here failed — ensure cloud-init injected your SSH pubkey');
    } finally { setBusy(false); }
  };

  const draft = editor === 'new' ? createEmptyIncusEndpoint() : editor;

  return (
    <div className="flex flex-col gap-3 min-h-0">
      <PluginHeroStrip
        icon={<Icons8Icon id="server_ui" size={40} />}
        name="Incus VPS Control"
        typeLabel="Remote Mesh · full instance plane"
        meta={<span className="text-[10px] text-gray-500">Launch · import · start/stop · browse · shell · destroy — native in Mesh, no external admin UI</span>}
        actions={
          <>
            <PluginHeroActionButton icon="add" variant="primary" onClick={() => setEditor('new')}>
              Add Incus endpoint
            </PluginHeroActionButton>
            <PluginHeroActionButton icon="refresh" onClick={() => void refresh()} disabled={busy}>
              Refresh
            </PluginHeroActionButton>
          </>
        }
      />

      {draft && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !busy && setEditor(null)}>
          <div className="w-full max-w-2xl bndz-mesh-ephemeral-editor" onClick={e => e.stopPropagation()}>
            <EndpointEditor endpoint={draft} busy={busy} onCancel={() => setEditor(null)} onSave={saveEndpoint} />
          </div>
        </div>
      )}

      {inspectId && (() => {
        const inst = instances.find(i => i.id === inspectId);
        if (!inst) return null;
        return (
          <MeshIncusInstanceInspector
            ephemeralId={inst.id}
            instanceName={inst.notes || inst.instanceName}
            busy={busy}
            onBusy={setBusy}
            onStatus={setStatus}
            onClose={() => setInspectId(null)}
            onChanged={() => { void refresh(); void loadServerInventory(); }}
          />
        );
      })()}

      <div className="grid gap-3 xl:grid-cols-2">
        <div className="space-y-2">
          <div className="text-[11px] font-semibold tracking-wide text-sky-200/80 uppercase">Endpoints</div>
          {endpoints.length === 0 ? (
            <PluginEmptyState
              icon="server_ui"
              title="No Incus remotes"
              description="Point Remote Mesh at an Incus HTTPS API (trust token + client cert). BNDZ never ships incusd — it drives your lab/server."
            />
          ) : endpoints.map(ep => (
            <PluginCard
              key={ep.id}
              className={`!p-3 flex flex-col gap-2 bndz-mesh-ephemeral-card ${selectedEndpointId === ep.id ? 'is-selected' : ''}`}
            >
              <button type="button" className="text-left" onClick={() => setSelectedEndpointId(ep.id)}>
                <div className="flex items-center gap-2">
                  <span className={`bndz-mesh-ephemeral-dot ${ep.trusted ? 'is-trusted' : 'is-pending'}`} />
                  <div className="font-semibold text-sm text-white truncate">{ep.alias}</div>
                  {ep.trusted && <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-400/20">Trusted</span>}
                </div>
                <div className="text-[10px] text-gray-500 truncate mt-0.5">{ep.apiUrl}</div>
                {ep.lastError && <div className="text-[10px] text-red-400/90 mt-1">{ep.lastError}</div>}
              </button>
              <div className="flex flex-wrap gap-1.5">
                <PluginToolbarButton onClick={() => void testEndpoint(ep.id)} disabled={busy}>Test</PluginToolbarButton>
                <PluginToolbarButton onClick={() => setEditor(ep)} disabled={busy}>Edit</PluginToolbarButton>
                <PluginToolbarButton onClick={() => void deleteEndpoint(ep.id)} disabled={busy}>Remove</PluginToolbarButton>
              </div>
            </PluginCard>
          ))}
        </div>

        <div className="space-y-2">
          <div className="text-[11px] font-semibold tracking-wide text-sky-200/80 uppercase">Launch pad</div>
          <PluginCard className="!p-3 space-y-2 bndz-mesh-ephemeral-launch">
            <PluginFieldLabel>Endpoint</PluginFieldLabel>
            <select className={PLUGIN_INPUT_CLASS} value={selectedEndpointId || ''} onChange={e => setSelectedEndpointId(e.target.value || null)}>
              <option value="">Select…</option>
              {endpoints.map(ep => <option key={ep.id} value={ep.id}>{ep.alias}</option>)}
            </select>
            <PluginFieldLabel>Image alias</PluginFieldLabel>
            <input
              className={PLUGIN_INPUT_CLASS}
              list="bndz-incus-image-aliases"
              value={launchImage}
              onChange={e => setLaunchImage(e.target.value)}
              placeholder="ubuntu/24.04/cloud"
            />
            <datalist id="bndz-incus-image-aliases">
              {imageAliases.slice(0, 80).map(a => (
                <option key={a.name} value={a.name}>{a.description || a.name}</option>
              ))}
            </datalist>
            {imageAliases.length > 0 && (
              <div className="text-[10px] text-gray-500">{imageAliases.length} aliases from Incus · prefer /cloud for SSH inject</div>
            )}
            <PluginFieldLabel>Type</PluginFieldLabel>
            <select className={PLUGIN_INPUT_CLASS} value={launchType} onChange={e => setLaunchType(e.target.value as 'container' | 'virtual-machine')}>
              <option value="container">Container</option>
              <option value="virtual-machine">Virtual machine</option>
            </select>
            <PluginFieldLabel>Profiles</PluginFieldLabel>
            <input
              className={PLUGIN_INPUT_CLASS}
              list="bndz-incus-profiles"
              value={launchProfiles}
              onChange={e => setLaunchProfiles(e.target.value)}
              placeholder="default"
            />
            <datalist id="bndz-incus-profiles">
              {profiles.map(p => <option key={p.name} value={p.name}>{p.description || p.name}</option>)}
            </datalist>
            <PluginFieldLabel>Network (NIC)</PluginFieldLabel>
            <select className={PLUGIN_INPUT_CLASS} value={launchNetwork} onChange={e => setLaunchNetwork(e.target.value)}>
              <option value="">Profile default</option>
              {networks.map(n => <option key={n.name} value={n.name}>{n.name}{n.type ? ` · ${n.type}` : ''}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <PluginFieldLabel>limits.cpu</PluginFieldLabel>
                <input className={PLUGIN_INPUT_CLASS} value={launchCpu} onChange={e => setLaunchCpu(e.target.value)} placeholder="2" />
              </div>
              <div>
                <PluginFieldLabel>limits.memory</PluginFieldLabel>
                <input className={PLUGIN_INPUT_CLASS} value={launchMemory} onChange={e => setLaunchMemory(e.target.value)} placeholder="2GiB" />
              </div>
            </div>
            <PluginFieldLabel>Mesh alias (optional)</PluginFieldLabel>
            <input className={PLUGIN_INPUT_CLASS} value={launchAlias} onChange={e => setLaunchAlias(e.target.value)} placeholder="Build box" />
            <PluginFieldLabel>Instance name (optional)</PluginFieldLabel>
            <input className={PLUGIN_INPUT_CLASS} value={launchName} onChange={e => setLaunchName(e.target.value)} placeholder="bndz-build-01" />
            <label className="flex items-center gap-2 text-[11px] text-gray-400">
              <input type="checkbox" checked={launchPersistent} onChange={e => setLaunchPersistent(e.target.checked)} />
              Persistent VPS (not auto-deleted on stop)
            </label>
            <PluginToolbarButton onClick={() => void launch()} disabled={busy || !selectedEndpointId}>
              <Icons8Icon id="play" size={12} /> Launch · register Mesh host
            </PluginToolbarButton>
          </PluginCard>

          <div className="text-[11px] font-semibold tracking-wide text-sky-200/80 uppercase flex items-center justify-between gap-2">
            <span>Server inventory</span>
            <PluginToolbarButton onClick={() => void loadServerInventory()} disabled={inventoryBusy || !selectedEndpointId}>
              {inventoryBusy ? 'Scanning…' : 'Scan Incus'}
            </PluginToolbarButton>
          </div>
          <PluginCard className="!p-2 space-y-1 bndz-mesh-ephemeral-inventory max-h-[220px] overflow-y-auto bndz-scrollbar">
            {!selectedEndpointId ? (
              <div className="text-[10px] text-gray-500 px-2 py-3">Select an endpoint to list all instances on the Incus server.</div>
            ) : serverInstances.length === 0 ? (
              <div className="text-[10px] text-gray-500 px-2 py-3">No instances reported — scan after connecting a trusted endpoint.</div>
            ) : serverInstances.map(srv => (
              <div key={srv.name} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.03] bndz-mesh-ephemeral-inventory-row">
                <span className={`bndz-mesh-ephemeral-dot ${srv.status === 'Running' ? 'is-trusted' : 'is-pending'}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-white truncate font-medium">{srv.name}</div>
                  <div className="text-[9px] text-gray-500 truncate">{srv.type}{srv.ephemeral ? ' · ephemeral' : ' · persistent'} · {srv.status}</div>
                </div>
                {srv.tracked ? (
                  <span className="text-[9px] text-emerald-300/80 shrink-0">In Mesh</span>
                ) : (
                  <PluginToolbarButton onClick={() => void importServerInstance(srv)} disabled={busy}>Import</PluginToolbarButton>
                )}
              </div>
            ))}
          </PluginCard>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] font-semibold tracking-wide text-sky-200/80 uppercase">Managed VPS hosts</div>
        {instances.length === 0 ? (
          <PluginEmptyState
            icon="cloud_ui"
            title="No managed hosts"
            description="Launch a new VPS or import an existing Incus instance. When an IP appears, BNDZ registers Mesh SSH for browse, terminal, mirror, and sync."
          />
        ) : (
          <div className="grid gap-2 xl:grid-cols-2">
            {instances.map(inst => (
              <PluginCard key={inst.id} className="!p-3 flex flex-col gap-2 bndz-mesh-ephemeral-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-white truncate">{inst.notes || inst.instanceName}</div>
                    <div className="text-[10px] text-gray-500 truncate mt-0.5">
                      {inst.instanceType} · {inst.imageAlias}{inst.ephemeral ? ' · ephemeral' : ''}
                    </div>
                    <div className="text-[10px] text-sky-300/80 mt-1 bndz-mono">
                      {inst.ipv4 || inst.ipv6 || 'waiting for IP…'}
                      {inst.meshHostId ? ` · mesh:${inst.meshHostId}` : ''}
                      {!inst.ipv4 && !inst.ipv6 && inst.status !== 'Error' ? (
                        <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse align-middle" />
                      ) : null}
                    </div>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-gray-300 shrink-0">{inst.status}</span>
                </div>
                {inst.lastError && <div className="text-[10px] text-amber-300/90">{inst.lastError}</div>}
                <div className="flex flex-wrap gap-1.5">
                  <PluginToolbarButton onClick={() => void browseMesh(inst)} disabled={busy || !inst.meshHostId}>Browse</PluginToolbarButton>
                  <PluginToolbarButton onClick={() => void shellHere(inst)} disabled={busy || !inst.meshHostId}>Shell Here</PluginToolbarButton>
                  <PluginToolbarButton onClick={() => setInspectId(inst.id)} disabled={busy}>Manage</PluginToolbarButton>
                  {inst.status !== 'Running' && (
                    <PluginToolbarButton onClick={() => void instanceAction(inst.id, 'start')} disabled={busy}>Start</PluginToolbarButton>
                  )}
                  {inst.status === 'Running' && (
                    <>
                      <PluginToolbarButton onClick={() => void instanceAction(inst.id, 'stop')} disabled={busy}>Stop</PluginToolbarButton>
                      <PluginToolbarButton onClick={() => void instanceAction(inst.id, 'restart')} disabled={busy}>Restart</PluginToolbarButton>
                    </>
                  )}
                  <PluginToolbarButton onClick={() => void refreshOne(inst.id)} disabled={busy}>Refresh IP</PluginToolbarButton>
                  <PluginToolbarButton onClick={() => void destroyOne(inst.id)} disabled={busy}>Destroy</PluginToolbarButton>
                </div>
              </PluginCard>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EndpointEditor({
  endpoint,
  busy,
  onCancel,
  onSave,
}: {
  endpoint: IncusEndpoint;
  busy: boolean;
  onCancel: () => void;
  onSave: (e: IncusEndpoint) => void;
}) {
  const [draft, setDraft] = useState<IncusEndpoint>(endpoint);
  useEffect(() => { setDraft(endpoint); }, [endpoint]);

  const set = <K extends keyof IncusEndpoint>(key: K, value: IncusEndpoint[K]) =>
    setDraft(prev => ({ ...prev, [key]: value }));

  return (
    <PluginCard className="!p-4 space-y-2 max-h-[85vh] overflow-y-auto bndz-scrollbar">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-white">Incus endpoint</h3>
        <button type="button" className="text-xs text-gray-400 hover:text-white" onClick={onCancel}>Close</button>
      </div>
      <PluginFieldLabel>Alias</PluginFieldLabel>
      <input className={PLUGIN_INPUT_CLASS} value={draft.alias} onChange={e => set('alias', e.target.value)} />
      <PluginFieldLabel>API URL</PluginFieldLabel>
      <input className={PLUGIN_INPUT_CLASS} value={draft.apiUrl} onChange={e => set('apiUrl', e.target.value)} placeholder="https://incus.lab:8443" />
      <PluginFieldLabel>Trust token (one-shot)</PluginFieldLabel>
      <input className={PLUGIN_INPUT_CLASS} value={draft.trustTokenPlain || ''} onChange={e => set('trustTokenPlain', e.target.value)} placeholder="From: incus config trust add" />
      <PluginFieldLabel>Server cert fingerprint (optional pin)</PluginFieldLabel>
      <input className={PLUGIN_INPUT_CLASS} value={draft.serverFingerprint || ''} onChange={e => set('serverFingerprint', e.target.value)} />
      <label className="flex items-center gap-2 text-xs text-gray-400">
        <input type="checkbox" checked={draft.allowInsecureTls} onChange={e => set('allowInsecureTls', e.target.checked)} />
        Allow insecure TLS (lab only)
      </label>
      <PluginFieldLabel>Project</PluginFieldLabel>
      <input className={PLUGIN_INPUT_CLASS} value={draft.project || 'default'} onChange={e => set('project', e.target.value)} />
      <PluginFieldLabel>Default image (prefer /cloud for SSH)</PluginFieldLabel>
      <input className={PLUGIN_INPUT_CLASS} value={draft.defaultImage} onChange={e => set('defaultImage', e.target.value)} />
      <PluginFieldLabel>Image server</PluginFieldLabel>
      <input className={PLUGIN_INPUT_CLASS} value={draft.defaultImageServer} onChange={e => set('defaultImageServer', e.target.value)} />
      <PluginFieldLabel>Default instance type</PluginFieldLabel>
      <select
        className={PLUGIN_INPUT_CLASS}
        value={draft.defaultInstanceType}
        onChange={e => set('defaultInstanceType', e.target.value)}
      >
        <option value="container">Container</option>
        <option value="virtual-machine">Virtual machine</option>
      </select>
      <PluginFieldLabel>SSH user / port / key for Mesh registration</PluginFieldLabel>
      <div className="text-[10px] text-gray-500 -mt-1">Use ubuntu for LXC cloud images; root for many VMs</div>
      <div className="grid grid-cols-3 gap-2">
        <input className={PLUGIN_INPUT_CLASS} value={draft.defaultSshUser} onChange={e => set('defaultSshUser', e.target.value)} placeholder="ubuntu" />
        <input className={PLUGIN_INPUT_CLASS} type="number" value={draft.defaultSshPort} onChange={e => set('defaultSshPort', Number(e.target.value) || 22)} />
        <input className={PLUGIN_INPUT_CLASS} value={draft.defaultSshKeyPath || ''} onChange={e => set('defaultSshKeyPath', e.target.value)} placeholder="~/.ssh/id_ed25519" />
      </div>
      <div className="flex gap-2 pt-2">
        <PluginToolbarButton onClick={() => onSave(draft)} disabled={busy}>Save</PluginToolbarButton>
        <PluginToolbarButton onClick={onCancel} disabled={busy}>Cancel</PluginToolbarButton>
      </div>
    </PluginCard>
  );
}
