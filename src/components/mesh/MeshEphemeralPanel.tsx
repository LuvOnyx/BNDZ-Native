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
  validateMeshVpsApiUrl,
} from '../../lib/incusTypes';
import { requestNativeConfirm } from '../../lib/nativeDialog';
import { pushToast } from '../ToastHost';
import MeshIncusInstanceInspector from './MeshIncusInstanceInspector';
import MeshIncusAdminPanel from './MeshIncusAdminPanel';

type Props = {
  onNavigate?: (path: string) => void;
  onStatus?: (msg: string | null) => void;
  onOpenTerminal?: (sessionId: string, hostId: string) => void;
};

function toastMeshVps(message: string, kind: 'success' | 'warning' | 'info' | 'error' = 'info') {
  pushToast({
    message,
    kind,
    title: kind === 'success' ? 'Mesh VPS' : kind === 'warning' || kind === 'error' ? 'Mesh VPS' : 'Remote Mesh',
  });
}

export default function MeshEphemeralPanel({ onNavigate, onStatus, onOpenTerminal }: Props) {
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
  const [meshHosts, setMeshHosts] = useState<Array<{ id: string; alias: string; hostname: string; username: string; provider?: number | string }>>([]);
  const [factoryStatus, setFactoryStatus] = useState<{
    ready?: boolean; runtime?: string; phase?: string; detail?: string; needsElevation?: boolean; error?: string;
  } | null>(null);
  const [adminEndpointId, setAdminEndpointId] = useState<string | null>(null);
  const [imagePreset, setImagePreset] = useState('lscr.io/linuxserver/openssh-server:latest');
  const [sizePreset, setSizePreset] = useState<'small' | 'medium' | 'large' | 'custom'>('medium');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const setStatus = (msg: string | null) => onStatus?.(msg);

  const setStatusAndToast = (
    msg: string | null,
    kind: 'success' | 'warning' | 'info' | 'error' = 'info',
  ) => {
    setStatus(msg);
    if (msg) toastMeshVps(msg, kind);
  };

  const hydratedRef = React.useRef(false);
  const seenIpRef = React.useRef<Set<string>>(new Set());

  const refresh = useCallback(async (opts?: { reconcile?: boolean }) => {
    try {
      if (opts?.reconcile) {
        try {
          const res = await IPC.meshIncusReconcile();
          if (res.ok && res.instances) {
            setInstances(res.instances.map((i: Record<string, unknown>) => normalizeIncusEphemeral(i)));
          }
        } catch { /* optional — list still loads from DB */ }
      }
      const [eps, inst, hosts, local] = await Promise.all([
        IPC.meshIncusListEndpoints(),
        IPC.meshIncusListEphemeral(),
        IPC.meshListHosts().catch(() => []),
        IPC.meshIncusLocalStatus().catch(() => ({ ok: false as const })),
      ]);
      if (local && 'status' in local && local.status) setFactoryStatus(local.status);
      const endpointsNorm = (eps as Record<string, unknown>[]).map(normalizeIncusEndpoint);
      const instancesNorm = (inst as Record<string, unknown>[]).map(normalizeIncusEphemeral);
      setEndpoints(endpointsNorm);
      setInstances(instancesNorm);
      setMeshHosts(
        (Array.isArray(hosts) ? hosts : []).map((h: any) => ({
          id: String(h.id ?? h.Id ?? ''),
          alias: String(h.alias ?? h.Alias ?? ''),
          hostname: String(h.hostname ?? h.Hostname ?? ''),
          username: String(h.username ?? h.Username ?? ''),
          provider: h.provider ?? h.Provider,
        })).filter(h => h.id && h.provider !== 1 && h.provider !== 'S3'),
      );

      // Prefer BNDZ Local factory for Create VPS (this PC is the host).
      setSelectedEndpointId(prev => {
        const local = endpointsNorm.find(e => e.id === 'bndz-local');
        if (local) return 'bndz-local';
        const stillThere = prev && endpointsNorm.some(e => e.id === prev);
        if (stillThere) return prev!;
        return endpointsNorm[0]?.id ?? 'bndz-local';
      });

      for (const i of instancesNorm) {
        const ip = i.ipv4 || i.ipv6;
        if (!ip) continue;
        const key = `${i.id}|${ip}`;
        if (hydratedRef.current && !seenIpRef.current.has(key)) {
          toastMeshVps(`${i.instanceName} online @ ${ip}`, 'success');
        }
        seenIpRef.current.add(key);
      }
      hydratedRef.current = true;

      return endpointsNorm;
    } catch (e: any) {
      setStatus(e?.message || 'Could not load Mesh VPS state');
      return [];
    }
  }, [onStatus]);

  useEffect(() => { void refresh(); }, [refresh]);

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
    if (sizePreset === 'small') { setLaunchCpu('1'); setLaunchMemory('1GiB'); }
    else if (sizePreset === 'medium') { setLaunchCpu('2'); setLaunchMemory('2GiB'); }
    else if (sizePreset === 'large') { setLaunchCpu('4'); setLaunchMemory('4GiB'); }
  }, [sizePreset]);

  useEffect(() => {
    if (imagePreset !== '__custom__') setLaunchImage(imagePreset);
  }, [imagePreset]);

  useEffect(() => {
    const ep = endpoints.find(e => e.id === selectedEndpointId);
    const local = !selectedEndpointId || selectedEndpointId === 'bndz-local' || selectedEndpointId === 'local'
      || ep?.id === 'bndz-local';
    if (local) {
      setImagePreset('lscr.io/linuxserver/openssh-server:latest');
      setLaunchImage('lscr.io/linuxserver/openssh-server:latest');
      setLaunchType('container');
      return;
    }
    if (ep) {
      const img = ep.defaultImage || 'ubuntu/24.04/cloud';
      setLaunchImage(img);
      const known = ['ubuntu/24.04/cloud', 'ubuntu/22.04/cloud', 'debian/12/cloud', 'debian/13/cloud'];
      setImagePreset(known.includes(img) ? img : '__custom__');
      setLaunchType(ep.defaultInstanceType === 'virtual-machine' ? 'virtual-machine' : 'container');
    }
  }, [selectedEndpointId, endpoints]);

  const friendlyError = (raw: string) => {
    const m = raw || '';
    if (/SSL|TLS|certificate/i.test(m)) {
      return `${m} — Edit host: enable “Allow insecure TLS” for lab certs, or paste a trust token and Test again.`;
    }
    if (/No such host|getaddrinfo|Name or service not known|https:443/i.test(m)) {
      return `${m} — That looks like a remote-host URL error. Primary Create uses BNDZ Local on this PC — select “BNDZ Local · this PC” and Create again.`;
    }
    if (/WSL|0x80070422|Subsystem for Linux/i.test(m)) {
      return m;
    }
    if (/not trusted/i.test(m)) {
      return m;
    }
    return m;
  };

  useEffect(() => {
    if (!selectedEndpointId || selectedEndpointId === 'bndz-local' || selectedEndpointId === 'local') {
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
    if (!selectedEndpointId || selectedEndpointId === 'bndz-local' || selectedEndpointId === 'local') {
      setServerInstances([]);
      return;
    }
    setInventoryBusy(true);
    try {
      const res = await IPC.meshIncusListServerInstances(selectedEndpointId);
      if (!res.ok) throw new Error(res.error || 'Could not list VPS instances');
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

  const bootstrapTrust = async (req: {
    endpointId?: string;
    alias?: string;
    apiUrl?: string;
    apiPort?: number;
    allowInsecureTls?: boolean;
    meshHostId?: string;
    sshHostname?: string;
    sshPort?: number;
    sshUsername?: string;
    sshKeyPath?: string;
    sshPassword?: string;
    persistControlHost?: boolean;
  }) => {
    setBusy(true);
    setStatusAndToast('Connecting over SSH and auto-trusting…', 'info');
    try {
      const res = await IPC.meshIncusBootstrapTrust(req);
      if (!res.ok) throw new Error(res.error || 'Auto-trust failed');
      if (res.endpoints) setEndpoints(res.endpoints.map((e: Record<string, unknown>) => normalizeIncusEndpoint(e)));
      else await refresh();
      const ep = res.endpoint ? normalizeIncusEndpoint(res.endpoint as Record<string, unknown>) : null;
      if (ep?.id) setSelectedEndpointId(ep.id);
      setEditor(null);
      setStatusAndToast(
        ep?.trusted || res.info?.trusted
          ? `Trusted — ${ep?.alias || 'VPS host'} ready. Hit Create VPS.`
          : `Connected ${ep?.alias || 'host'} — trust pending`,
        ep?.trusted || res.info?.trusted ? 'success' : 'info',
      );
    } catch (e: any) {
      setStatusAndToast(friendlyError(e?.message || 'Auto-trust failed'), 'warning');
      await refresh();
    } finally { setBusy(false); }
  };

  const saveEndpointManual = async (endpoint: IncusEndpoint) => {
    const urlCheck = validateMeshVpsApiUrl(endpoint.apiUrl);
    if (!urlCheck.ok) {
      setStatusAndToast(urlCheck.error, 'warning');
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const payload = { ...endpoint, apiUrl: urlCheck.url };
      await IPC.meshIncusUpsertEndpoint(incusEndpointToPayload(payload));
      await refresh();
      setSelectedEndpointId(endpoint.id);
      setStatusAndToast(`Saved ${endpoint.alias} — use Connect & trust if not Trusted yet`, 'info');
    } catch (e: any) {
      setStatusAndToast(e?.message || 'Could not save VPS host', 'warning');
    } finally { setBusy(false); }
  };

  const deleteEndpoint = async (endpointId: string) => {
    const ok = await requestNativeConfirm({
      title: 'Remove VPS host',
      message: 'Remove this VPS host? Tracked instances will be destroyed on the server when reachable, otherwise removed from Mesh only.',
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
      setStatusAndToast('VPS host removed', 'success');
    } catch (e: any) {
      setStatusAndToast(e?.message || 'Delete failed', 'warning');
    } finally { setBusy(false); }
  };

  const testEndpoint = async (endpointId: string) => {
    const ep = endpoints.find(e => e.id === endpointId);
    if (ep) {
      const urlCheck = validateMeshVpsApiUrl(ep.apiUrl);
      if (!urlCheck.ok) {
        setStatusAndToast(urlCheck.error, 'warning');
        setEditor(ep);
        return;
      }
    }
    setBusy(true);
    try {
      const res = await IPC.meshIncusTestEndpoint(endpointId);
      if (!res.ok) throw new Error(res.error || 'Trust probe failed');
      if (res.endpoints) setEndpoints(res.endpoints.map((e: Record<string, unknown>) => normalizeIncusEndpoint(e)));
      setStatusAndToast(
        res.info?.trusted ? 'Trusted — VPS API reachable' : 'Connected but not trusted yet — paste a trust token and save',
        res.info?.trusted ? 'success' : 'info',
      );
    } catch (e: any) {
      setStatusAndToast(friendlyError(e?.message || 'Test failed'), 'warning');
      await refresh();
    } finally { setBusy(false); }
  };

  const selectedEndpoint = endpoints.find(e => e.id === selectedEndpointId) || null;
  const isLocalCreate = !selectedEndpointId || selectedEndpointId === 'bndz-local' || selectedEndpointId === 'local';
  const selectedUrlOk = selectedEndpoint ? validateMeshVpsApiUrl(selectedEndpoint.apiUrl).ok : true;
  const canCreateVps = Boolean(!busy && (isLocalCreate || (selectedEndpoint?.trusted && selectedUrlOk)));

  const launch = async () => {
    setBusy(true);
    try {
      if (isLocalCreate) {
        setStatusAndToast('Preparing local VPS factory on this PC…', 'info');
        const ensure = await IPC.meshIncusLocalEnsure();
        if (!ensure.ok) throw new Error(ensure.error || 'Local VPS factory not ready');
        if (ensure.status) setFactoryStatus(ensure.status);
        if (ensure.endpoints?.length) {
          setEndpoints(ensure.endpoints.map((e: Record<string, unknown>) => normalizeIncusEndpoint(e)));
        }
        setSelectedEndpointId('bndz-local');
      } else if (selectedEndpoint && !selectedEndpoint.trusted) {
        setStatusAndToast('Trusting remote compute host…', 'info');
        const test = await IPC.meshIncusTestEndpoint(selectedEndpoint.id);
        if (!test.ok || !test.info?.trusted) {
          throw new Error(test.error || 'Remote host is not trusted');
        }
      }

      setStatusAndToast(isLocalCreate ? 'Creating temporary VPS on this PC…' : 'Creating VPS…', 'info');
      const profileList = launchProfiles.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
      const config: Record<string, string> = {};
      if (launchCpu.trim()) config['limits.cpu'] = launchCpu.trim();
      if (launchMemory.trim()) config['limits.memory'] = launchMemory.trim();
      const res = await IPC.meshIncusLaunch({
        endpointId: isLocalCreate ? 'bndz-local' : selectedEndpointId!,
        name: launchName.trim() || undefined,
        imageAlias: isLocalCreate
          ? (imagePreset === '__custom__' ? launchImage : 'lscr.io/linuxserver/openssh-server:latest')
          : launchImage,
        instanceType: launchType,
        ephemeral: !launchPersistent,
        start: true,
        registerMeshHost: true,
        alias: launchAlias || undefined,
        profiles: isLocalCreate ? undefined : (profileList.length ? profileList : undefined),
        network: isLocalCreate ? undefined : (launchNetwork || undefined),
        config: Object.keys(config).length ? config : undefined,
      });
      if (!res.ok) throw new Error(res.error || 'Create VPS failed');
      await refresh();
      const inst = res.instance ? normalizeIncusEphemeral(res.instance as Record<string, unknown>) : null;
      const addr = inst?.ipv4 || inst?.ipv6;
      setStatusAndToast(addr
        ? `Temporary VPS ready — ${inst?.instanceName} @ ${addr}${inst?.meshHostId ? ' (Mesh)' : ''}`
        : `VPS created (${inst?.instanceName || 'instance'}) — waiting for SSH`,
        addr ? 'success' : 'info');
    } catch (e: any) {
      setStatusAndToast(friendlyError(e?.message || 'Create VPS failed'), 'warning');
      await refresh();
    } finally { setBusy(false); }
  };

  const refreshOne = async (id: string) => {
    setBusy(true);
    try {
      const res = await IPC.meshIncusRefresh(id);
      if (!res.ok) throw new Error(res.error || 'Refresh failed');
      await refresh();
      setStatusAndToast('Instance state refreshed', 'success');
    } catch (e: any) {
      setStatusAndToast(e?.message || 'Refresh failed', 'warning');
    } finally { setBusy(false); }
  };

  const instanceAction = async (id: string, action: 'start' | 'stop' | 'restart') => {
    setBusy(true);
    try {
      const res = await IPC.meshIncusInstanceAction(id, action);
      if (!res.ok) throw new Error(res.error || `${action} failed`);
      await refresh();
      void loadServerInventory();
      setStatusAndToast(`Instance ${action} completed`, 'success');
    } catch (e: any) {
      setStatusAndToast(e?.message || `${action} failed`, 'warning');
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
        alias: `VPS · ${inst.name}`,
        registerMeshHost: true,
      });
      if (!res.ok) throw new Error(res.error || 'Import failed');
      await refresh();
      void loadServerInventory();
      setStatusAndToast(`Imported ${inst.name} — Mesh host registered when IP is ready`, 'success');
    } catch (e: any) {
      setStatusAndToast(e?.message || 'Import failed', 'warning');
    } finally { setBusy(false); }
  };

  const destroyOne = async (id: string) => {
    const ok = await requestNativeConfirm({
      title: 'Destroy VPS',
      message: 'Stop and delete this VPS on the remote host, and remove its Mesh SSH entry? If the host is offline, Mesh still removes the local record.',
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
      void loadServerInventory();
      setStatusAndToast('VPS destroyed', 'success');
    } catch (e: any) {
      setStatusAndToast(e?.message || 'Destroy failed', 'warning');
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
      // Pop-out Browse: also fire host navigate so main list always receives it.
      window.dispatchEvent(new CustomEvent('bndz-navigate', {
        detail: { path: buildMeshPath(inst.meshHostId, '') },
      }));
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
      const sessionId = res?.id ?? res?.Id ?? res?.sessionId ?? res?.SessionId;
      if (sessionId && onOpenTerminal) {
        onOpenTerminal(String(sessionId), inst.meshHostId);
      }
      setStatusAndToast(`Shell · ${inst.instanceName}`, 'success');
    } catch (e: any) {
      setStatusAndToast(e?.message || 'Shell Here failed — ensure cloud-init injected your SSH pubkey', 'warning');
    } finally { setBusy(false); }
  };

  const draft = editor === 'new' ? createEmptyIncusEndpoint() : editor;

  return (
    <div className="flex flex-col gap-3 min-h-0">
      <PluginHeroStrip
        icon={<Icons8Icon id="server_ui" size={40} />}
        name="Mesh VPS"
        typeLabel="Local temporary VPS · BNDZ is the host"
        meta={<span className="text-[10px] text-gray-500">Create disposable Linux instances on this PC · Mesh SSH · destroy when done</span>}
        actions={
          <>
            <PluginHeroActionButton icon="play" variant="primary" onClick={() => void launch()} disabled={!canCreateVps}>
              {busy ? 'Creating…' : 'Create VPS'}
            </PluginHeroActionButton>
            <PluginHeroActionButton icon="refresh" onClick={() => void refresh({ reconcile: true })} disabled={busy}>
              Refresh
            </PluginHeroActionButton>
          </>
        }
      />

      {draft && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !busy && setEditor(null)}>
          <div className="w-full max-w-2xl bndz-mesh-ephemeral-editor" onClick={e => e.stopPropagation()}>
            <EndpointEditor
              endpoint={draft}
              busy={busy}
              meshHosts={meshHosts}
              onCancel={() => setEditor(null)}
              onBootstrap={bootstrapTrust}
              onSaveManual={saveEndpointManual}
            />
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

      {adminEndpointId && (() => {
        const ep = endpoints.find(e => e.id === adminEndpointId);
        if (!ep) return null;
        return (
          <MeshIncusAdminPanel
            endpoint={ep}
            onClose={() => setAdminEndpointId(null)}
          />
        );
      })()}

      <div className="grid gap-3 xl:grid-cols-2">
        <div className="space-y-2">
          <div className="text-[11px] font-semibold tracking-wide text-sky-200/80 uppercase">Local factory</div>
          <PluginCard className="!p-3 space-y-2 bndz-mesh-ephemeral-card is-selected">
            <div className="flex items-center gap-2">
              <span className={`bndz-mesh-ephemeral-dot ${factoryStatus?.ready ? 'is-trusted' : 'is-pending'}`} />
              <div className="font-semibold text-sm text-white">BNDZ Local</div>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-200 border border-sky-400/25">This PC</span>
            </div>
            <div className="text-[11px] text-gray-400 leading-relaxed">
              {factoryStatus?.detail?.replace(/\bPodman\b/gi, 'local runtime')
                || 'Creates temporary Linux VPS on this PC (no remote Incus host required).'}
            </div>
            {factoryStatus?.phase && (
              <div className="text-[10px] text-gray-500 bndz-mono">
                runtime:{factoryStatus.runtime || '—'} · {factoryStatus.phase}
                {factoryStatus.needsElevation ? ' · needs admin once for WSL' : ''}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              <PluginToolbarButton
                onClick={() => {
                  setBusy(true);
                  void IPC.meshIncusLocalEnsure()
                    .then(r => {
                      if (!r.ok) throw new Error(r.error || 'Factory prepare failed');
                      if (r.status) setFactoryStatus(r.status);
                      setStatusAndToast(r.status?.ready ? 'Local factory ready' : (r.status?.detail || 'Factory preparing…'), r.status?.ready ? 'success' : 'info');
                    })
                    .catch((e: any) => setStatusAndToast(friendlyError(e?.message || 'Factory prepare failed'), 'warning'))
                    .finally(() => setBusy(false));
                }}
                disabled={busy}
              >
                Prepare factory
              </PluginToolbarButton>
              <PluginToolbarButton onClick={() => setSelectedEndpointId('bndz-local')} disabled={busy}>
                Use for Create
              </PluginToolbarButton>
            </div>
          </PluginCard>
          <button
            type="button"
            className="text-[11px] text-sky-300/80 hover:text-sky-200 text-left"
            onClick={() => setEditor('new')}
          >
            Advanced: optional remote compute host…
          </button>
        </div>

        <div className="space-y-2">
          <div className="text-[11px] font-semibold tracking-wide text-sky-200/80 uppercase">Create temporary VPS</div>
          <PluginCard className="!p-3 bndz-mesh-ephemeral-launch bndz-mesh-one-push">
            <div className="text-[11px] text-gray-400 leading-relaxed -mt-0.5 mb-1">
              One push creates a disposable Linux instance on this PC, waits for SSH, and registers Mesh.
            </div>
            <PluginFieldLabel>Where</PluginFieldLabel>
            <select className={PLUGIN_INPUT_CLASS} value={selectedEndpointId || 'bndz-local'} onChange={e => setSelectedEndpointId(e.target.value || 'bndz-local')}>
              <option value="bndz-local">BNDZ Local · this PC (temporary)</option>
              {endpoints.filter(ep => ep.id !== 'bndz-local').map(ep => (
                <option key={ep.id} value={ep.id}>{ep.alias}{ep.trusted ? '' : ' · not trusted'}</option>
              ))}
            </select>

            <PluginFieldLabel>Image</PluginFieldLabel>
            {isLocalCreate ? (
              <select
                className={PLUGIN_INPUT_CLASS}
                value={imagePreset}
                onChange={e => setImagePreset(e.target.value)}
              >
                <option value="lscr.io/linuxserver/openssh-server:latest">Linux · SSH ready (temporary VPS)</option>
                <option value="__custom__">Custom container image…</option>
              </select>
            ) : (
              <select
                className={PLUGIN_INPUT_CLASS}
                value={imagePreset}
                onChange={e => setImagePreset(e.target.value)}
              >
                <option value="ubuntu/24.04/cloud">Ubuntu 24.04 (cloud · SSH ready)</option>
                <option value="ubuntu/22.04/cloud">Ubuntu 22.04 (cloud)</option>
                <option value="debian/12/cloud">Debian 12 (cloud)</option>
                {(imageAliases.length > 0) && imageAliases.slice(0, 40).map(a => (
                  <option key={`srv-${a.name}`} value={a.name}>{a.description || a.name}</option>
                ))}
                <option value="__custom__">Custom alias…</option>
              </select>
            )}
            {imagePreset === '__custom__' && (
              <input
                className={PLUGIN_INPUT_CLASS}
                list={isLocalCreate ? undefined : 'bndz-incus-image-aliases'}
                value={launchImage}
                onChange={e => setLaunchImage(e.target.value)}
                placeholder={isLocalCreate ? 'docker.io/library/ubuntu:24.04' : 'ubuntu/24.04/cloud'}
              />
            )}
            {!isLocalCreate && (
              <datalist id="bndz-incus-image-aliases">
                {imageAliases.slice(0, 80).map(a => (
                  <option key={a.name} value={a.name}>{a.description || a.name}</option>
                ))}
              </datalist>
            )}

            <div className="grid grid-cols-2 gap-2">
              {!isLocalCreate && (
                <div>
                  <PluginFieldLabel>Type</PluginFieldLabel>
                  <select className={PLUGIN_INPUT_CLASS} value={launchType} onChange={e => setLaunchType(e.target.value as 'container' | 'virtual-machine')}>
                    <option value="container">Container (fast)</option>
                    <option value="virtual-machine">Virtual machine</option>
                  </select>
                </div>
              )}
              <div className={isLocalCreate ? 'col-span-2' : undefined}>
                <PluginFieldLabel>Size</PluginFieldLabel>
                <select
                  className={PLUGIN_INPUT_CLASS}
                  value={sizePreset}
                  onChange={e => setSizePreset(e.target.value as 'small' | 'medium' | 'large' | 'custom')}
                >
                  <option value="small">Small · 1 CPU / 1 GiB</option>
                  <option value="medium">Medium · 2 CPU / 2 GiB</option>
                  <option value="large">Large · 4 CPU / 4 GiB</option>
                  <option value="custom">Custom limits…</option>
                </select>
              </div>
            </div>
            {sizePreset === 'custom' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <PluginFieldLabel>CPU</PluginFieldLabel>
                  <input className={PLUGIN_INPUT_CLASS} value={launchCpu} onChange={e => setLaunchCpu(e.target.value)} placeholder="2" />
                </div>
                <div>
                  <PluginFieldLabel>Memory</PluginFieldLabel>
                  <input className={PLUGIN_INPUT_CLASS} value={launchMemory} onChange={e => setLaunchMemory(e.target.value)} placeholder="2GiB" />
                </div>
              </div>
            )}

            <button
              type="button"
              className="bndz-mesh-one-push-btn"
              onClick={() => void launch()}
              disabled={!canCreateVps}
              title={isLocalCreate
                ? 'Create a temporary Linux VPS on this PC'
                : !selectedUrlOk
                  ? 'Fix the remote host API URL'
                  : !selectedEndpoint?.trusted
                    ? 'Trust the remote host first'
                    : 'Create VPS on remote compute host'}
            >
              <Icons8Icon id="play" size={14} />
              {busy ? 'Creating VPS…' : 'Create temporary VPS · one push'}
            </button>
            <div className="text-[10px] text-gray-500 text-center -mt-1">
              BNDZ is the host — spins a local instance · Mesh SSH · Destroy when done
            </div>
            {isLocalCreate && (
              <>
                <PluginFieldLabel>Mesh alias (optional)</PluginFieldLabel>
                <input className={PLUGIN_INPUT_CLASS} value={launchAlias} onChange={e => setLaunchAlias(e.target.value)} placeholder="Temp build box" />
              </>
            )}

            {!isLocalCreate && (
            <button
              type="button"
              className="text-[11px] text-sky-300/80 hover:text-sky-200 text-left"
              onClick={() => setShowAdvanced(v => !v)}
            >
              {showAdvanced ? 'Hide advanced' : 'Advanced options'}
            </button>
            )}
            {!isLocalCreate && showAdvanced && (
              <div className="space-y-2 bndz-mesh-one-push-advanced">
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
                <PluginFieldLabel>Mesh alias (optional)</PluginFieldLabel>
                <input className={PLUGIN_INPUT_CLASS} value={launchAlias} onChange={e => setLaunchAlias(e.target.value)} placeholder="Build box" />
                <PluginFieldLabel>Instance name (optional)</PluginFieldLabel>
                <input className={PLUGIN_INPUT_CLASS} value={launchName} onChange={e => setLaunchName(e.target.value)} placeholder="bndz-build-01" />
                <label className="flex items-center gap-2 text-[11px] text-gray-400">
                  <input type="checkbox" checked={launchPersistent} onChange={e => setLaunchPersistent(e.target.checked)} />
                  Persistent VPS (not auto-deleted on stop)
                </label>
              </div>
            )}
          </PluginCard>

          {!isLocalCreate && (
            <>
          <div className="text-[11px] font-semibold tracking-wide text-sky-200/80 uppercase flex items-center justify-between gap-2">
            <span>Remote server inventory</span>
            <PluginToolbarButton onClick={() => void loadServerInventory()} disabled={inventoryBusy || !selectedEndpointId}>
              {inventoryBusy ? 'Scanning…' : 'Scan host'}
            </PluginToolbarButton>
          </div>
          <PluginCard className="!p-2 space-y-1 bndz-mesh-ephemeral-inventory max-h-[220px] overflow-y-auto bndz-scrollbar">
            {!selectedEndpointId ? (
              <div className="text-[10px] text-gray-500 px-2 py-3">Select a remote host to list instances on that server.</div>
            ) : serverInstances.length === 0 ? (
              <div className="text-[10px] text-gray-500 px-2 py-3">No instances yet — Create VPS above, or scan after the host is Trusted.</div>
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
            </>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] font-semibold tracking-wide text-sky-200/80 uppercase">Temporary VPS on this PC</div>
        {instances.length === 0 ? (
          <PluginEmptyState
            icon="cloud_ui"
            title="No temporary VPS yet"
            description="Press Create temporary VPS — BNDZ spins a disposable Linux instance on this PC and registers Mesh SSH for browse and Shell Here."
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
                  <PluginToolbarButton onClick={() => setInspectId(inst.id)} disabled={busy || inst.endpointId === 'bndz-local'} title={inst.endpointId === 'bndz-local' ? 'Incus inspector is for remote hosts — use Start/Stop/Destroy for local VPS' : undefined}>Manage</PluginToolbarButton>
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
                  <PluginToolbarButton destructive title="Stop and delete this VPS" onClick={() => void destroyOne(inst.id)} disabled={busy}>Destroy</PluginToolbarButton>
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
  meshHosts,
  onCancel,
  onBootstrap,
  onSaveManual,
}: {
  endpoint: IncusEndpoint;
  busy: boolean;
  meshHosts: Array<{ id: string; alias: string; hostname: string; username: string; provider?: number | string }>;
  onCancel: () => void;
  onBootstrap: (req: {
    endpointId?: string;
    alias?: string;
    apiUrl?: string;
    apiPort?: number;
    allowInsecureTls?: boolean;
    meshHostId?: string;
    sshHostname?: string;
    sshPort?: number;
    sshUsername?: string;
    sshKeyPath?: string;
    sshPassword?: string;
    persistControlHost?: boolean;
  }) => void;
  onSaveManual: (e: IncusEndpoint) => void;
}) {
  const parsedHost = (() => {
    try {
      const u = new URL(endpoint.apiUrl.includes('://') ? endpoint.apiUrl : `https://${endpoint.apiUrl}`);
      return u.hostname && u.hostname !== 'https' ? u.hostname : '';
    } catch { return ''; }
  })();

  const [alias, setAlias] = useState(endpoint.alias || 'My VPS host');
  const [sshHostname, setSshHostname] = useState(parsedHost);
  const [sshPort, setSshPort] = useState(22);
  const [sshUsername, setSshUsername] = useState('root');
  const [sshKeyPath, setSshKeyPath] = useState(endpoint.defaultSshKeyPath || '~/.ssh/id_ed25519');
  const [sshPassword, setSshPassword] = useState('');
  const [authMode, setAuthMode] = useState<'key' | 'password'>('key');
  const [meshHostId, setMeshHostId] = useState('');
  const [apiPort, setApiPort] = useState(8443);
  const [allowInsecureTls, setAllowInsecureTls] = useState(endpoint.allowInsecureTls !== false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [draft, setDraft] = useState<IncusEndpoint>(endpoint);

  useEffect(() => {
    setDraft(endpoint);
    setAlias(endpoint.alias || 'My VPS host');
    try {
      const u = new URL(endpoint.apiUrl.includes('://') ? endpoint.apiUrl : `https://${endpoint.apiUrl}`);
      if (u.hostname && u.hostname !== 'https') setSshHostname(u.hostname);
      if (u.port) setApiPort(Number(u.port) || 8443);
    } catch { /* keep */ }
    if (endpoint.defaultSshKeyPath) setSshKeyPath(endpoint.defaultSshKeyPath);
    setAllowInsecureTls(endpoint.allowInsecureTls !== false);
  }, [endpoint]);

  const sshHosts = meshHosts.filter(h => h.hostname);
  const canBootstrap = meshHostId
    ? true
    : Boolean(sshHostname.trim() && sshUsername.trim() && (authMode === 'password' ? sshPassword : true));

  const runBootstrap = () => {
    if (meshHostId) {
      onBootstrap({
        endpointId: endpoint.id,
        alias,
        apiPort,
        allowInsecureTls,
        meshHostId,
        persistControlHost: true,
      });
      return;
    }
    onBootstrap({
      endpointId: endpoint.id,
      alias,
      apiPort,
      allowInsecureTls,
      sshHostname: sshHostname.trim(),
      sshPort,
      sshUsername: sshUsername.trim(),
      sshKeyPath: authMode === 'key' ? sshKeyPath.trim() || undefined : undefined,
      sshPassword: authMode === 'password' ? sshPassword : (undefined),
      persistControlHost: true,
    });
  };

  return (
    <PluginCard className="!p-4 space-y-2 max-h-[85vh] overflow-y-auto bndz-scrollbar">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-white">Advanced · remote compute host</h3>
        <button type="button" className="text-xs text-gray-400 hover:text-white" onClick={onCancel}>Close</button>
      </div>
      <p className="text-[11px] text-gray-400 leading-relaxed -mt-1">
        Optional. Primary Create VPS uses BNDZ Local on this PC. Use this only for an extra remote Incus lab host.
      </p>
      <p className="text-[11px] text-gray-400 leading-relaxed">
        Enter SSH to the Linux box that runs the VPS API. BNDZ installs its client certificate and marks the host Trusted — you do not paste a trust token.
      </p>

      <PluginFieldLabel>Alias</PluginFieldLabel>
      <input className={PLUGIN_INPUT_CLASS} value={alias} onChange={e => setAlias(e.target.value)} placeholder="Lab hypervisor" />

      {sshHosts.length > 0 && (
        <>
          <PluginFieldLabel>Use existing Mesh SSH host</PluginFieldLabel>
          <select
            className={PLUGIN_INPUT_CLASS}
            value={meshHostId}
            onChange={e => {
              const id = e.target.value;
              setMeshHostId(id);
              const h = sshHosts.find(x => x.id === id);
              if (h) {
                setSshHostname(h.hostname);
                if (h.username) setSshUsername(h.username);
              }
            }}
          >
            <option value="">Enter SSH below…</option>
            {sshHosts.map(h => (
              <option key={h.id} value={h.id}>{h.alias || h.hostname} · {h.username}@{h.hostname}</option>
            ))}
          </select>
        </>
      )}

      {!meshHostId && (
        <>
          <PluginFieldLabel>SSH host (IP or DNS)</PluginFieldLabel>
          <input
            className={PLUGIN_INPUT_CLASS}
            value={sshHostname}
            onChange={e => setSshHostname(e.target.value)}
            placeholder="192.168.1.10"
          />
          <div className="grid grid-cols-3 gap-2">
            <div>
              <PluginFieldLabel>SSH user</PluginFieldLabel>
              <input className={PLUGIN_INPUT_CLASS} value={sshUsername} onChange={e => setSshUsername(e.target.value)} placeholder="root" />
            </div>
            <div>
              <PluginFieldLabel>SSH port</PluginFieldLabel>
              <input className={PLUGIN_INPUT_CLASS} type="number" value={sshPort} onChange={e => setSshPort(Number(e.target.value) || 22)} />
            </div>
            <div>
              <PluginFieldLabel>API port</PluginFieldLabel>
              <input className={PLUGIN_INPUT_CLASS} type="number" value={apiPort} onChange={e => setApiPort(Number(e.target.value) || 8443)} />
            </div>
          </div>
          <PluginFieldLabel>SSH auth</PluginFieldLabel>
          <select className={PLUGIN_INPUT_CLASS} value={authMode} onChange={e => setAuthMode(e.target.value as 'key' | 'password')}>
            <option value="key">Private key</option>
            <option value="password">Password</option>
          </select>
          {authMode === 'key' ? (
            <>
              <PluginFieldLabel>Private key path</PluginFieldLabel>
              <input
                className={PLUGIN_INPUT_CLASS}
                value={sshKeyPath}
                onChange={e => setSshKeyPath(e.target.value)}
                placeholder="~/.ssh/id_ed25519"
              />
              <div className="text-[10px] text-gray-500">Leave blank to try agent / default keys under ~/.ssh</div>
            </>
          ) : (
            <>
              <PluginFieldLabel>SSH password</PluginFieldLabel>
              <input
                className={PLUGIN_INPUT_CLASS}
                type="password"
                value={sshPassword}
                onChange={e => setSshPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="off"
              />
            </>
          )}
        </>
      )}

      <label className="flex items-center gap-2 text-xs text-gray-400 pt-1">
        <input type="checkbox" checked={allowInsecureTls} onChange={e => setAllowInsecureTls(e.target.checked)} />
        Allow insecure TLS (lab / self-signed API certs)
      </label>

      <button
        type="button"
        className="bndz-mesh-one-push-btn"
        disabled={busy || !canBootstrap}
        onClick={runBootstrap}
      >
        <Icons8Icon id="play" size={14} />
        {busy ? 'Connecting & trusting…' : 'Connect & trust · auto'}
      </button>
      <div className="text-[10px] text-gray-500 text-center -mt-1">
        SSH → install BNDZ cert on host → Trusted → Create VPS unlocked
      </div>

      <button
        type="button"
        className="text-[11px] text-sky-300/80 hover:text-sky-200 text-left"
        onClick={() => setShowAdvanced(v => !v)}
      >
        {showAdvanced ? 'Hide advanced' : 'Advanced (manual URL / token)'}
      </button>
      {showAdvanced && (
        <div className="space-y-2 bndz-mesh-one-push-advanced">
          <PluginFieldLabel>API URL override</PluginFieldLabel>
          <input
            className={PLUGIN_INPUT_CLASS}
            value={draft.apiUrl}
            onChange={e => setDraft(prev => ({ ...prev, apiUrl: e.target.value }))}
            placeholder="https://192.168.1.10:8443"
          />
          <PluginFieldLabel>Trust token (optional fallback)</PluginFieldLabel>
          <input
            className={PLUGIN_INPUT_CLASS}
            value={draft.trustTokenPlain || ''}
            onChange={e => setDraft(prev => ({ ...prev, trustTokenPlain: e.target.value }))}
            placeholder="Only if auto-trust cannot run on the host"
          />
          <PluginFieldLabel>Default image / SSH for launched VPS</PluginFieldLabel>
          <input className={PLUGIN_INPUT_CLASS} value={draft.defaultImage} onChange={e => setDraft(prev => ({ ...prev, defaultImage: e.target.value }))} />
          <div className="grid grid-cols-3 gap-2">
            <input className={PLUGIN_INPUT_CLASS} value={draft.defaultSshUser} onChange={e => setDraft(prev => ({ ...prev, defaultSshUser: e.target.value }))} placeholder="ubuntu" />
            <input className={PLUGIN_INPUT_CLASS} type="number" value={draft.defaultSshPort} onChange={e => setDraft(prev => ({ ...prev, defaultSshPort: Number(e.target.value) || 22 }))} />
            <input className={PLUGIN_INPUT_CLASS} value={draft.defaultSshKeyPath || ''} onChange={e => setDraft(prev => ({ ...prev, defaultSshKeyPath: e.target.value }))} placeholder="~/.ssh/id_ed25519" />
          </div>
          <PluginToolbarButton
            onClick={() => onSaveManual({
              ...draft,
              alias,
              allowInsecureTls,
              apiUrl: draft.apiUrl && draft.apiUrl !== 'https://'
                ? draft.apiUrl
                : `https://${sshHostname.trim()}:${apiPort}`,
            })}
            disabled={busy}
          >
            Save settings only
          </PluginToolbarButton>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <PluginToolbarButton onClick={onCancel} disabled={busy}>Cancel</PluginToolbarButton>
      </div>
    </PluginCard>
  );
}
