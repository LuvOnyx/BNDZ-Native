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
  createEmptyIncusEndpoint,
  incusEndpointToPayload,
} from '../../lib/incusTypes';
import { requestNativeConfirm } from '../../lib/nativeDialog';
import { pushToast } from '../ToastHost';

type Props = {
  onNavigate?: (path: string) => void;
  onStatus?: (msg: string | null) => void;
};

function toastIncus(message: string, kind: 'success' | 'warning' | 'info' | 'error' = 'info') {
  pushToast({
    message,
    kind,
    title: kind === 'success' ? 'Ephemeral Mesh' : kind === 'warning' || kind === 'error' ? 'Incus' : 'Remote Mesh',
  });
}

export default function MeshEphemeralPanel({ onNavigate, onStatus }: Props) {
  const [endpoints, setEndpoints] = useState<IncusEndpoint[]>([]);
  const [instances, setInstances] = useState<IncusEphemeralInstance[]>([]);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<IncusEndpoint | null | 'new'>(null);
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);
  const [launchImage, setLaunchImage] = useState('ubuntu/24.04/cloud');
  const [launchType, setLaunchType] = useState<'container' | 'virtual-machine'>('container');
  const [launchAlias, setLaunchAlias] = useState('');
  const [imageAliases, setImageAliases] = useState<Array<{ name: string; description?: string }>>([]);

  const setStatus = (msg: string | null) => onStatus?.(msg);

  const setStatusAndToast = (
    msg: string | null,
    kind: 'success' | 'warning' | 'info' | 'error' = 'info',
  ) => {
    setStatus(msg);
    if (msg) toastIncus(msg, kind);
  };

  const hydratedRef = React.useRef(false);
  const seenIpRef = React.useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const [eps, inst] = await Promise.all([
        IPC.meshIncusListEndpoints(),
        IPC.meshIncusListEphemeral(),
      ]);
      const endpointsNorm = (eps as Record<string, unknown>[]).map(normalizeIncusEndpoint);
      const instancesNorm = (inst as Record<string, unknown>[]).map(normalizeIncusEphemeral);
      setEndpoints(endpointsNorm);
      setInstances(instancesNorm);
      if (!selectedEndpointId && endpointsNorm[0]) setSelectedEndpointId(endpointsNorm[0].id);

      for (const i of instancesNorm) {
        const ip = i.ipv4 || i.ipv6;
        if (!ip) continue;
        const key = `${i.id}|${ip}`;
        if (hydratedRef.current && !seenIpRef.current.has(key)) {
          toastIncus(`${i.instanceName} online @ ${ip}`, 'success');
        }
        seenIpRef.current.add(key);
      }
      hydratedRef.current = true;

      return endpointsNorm;
    } catch (e: any) {
      setStatus(e?.message || 'Could not load Incus mesh state');
      return [];
    }
  }, [onStatus, selectedEndpointId]);

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
    const ep = endpoints.find(e => e.id === selectedEndpointId);
    if (ep) {
      setLaunchImage(ep.defaultImage || 'ubuntu/24.04/cloud');
      setLaunchType(ep.defaultInstanceType === 'virtual-machine' ? 'virtual-machine' : 'container');
    }
  }, [selectedEndpointId, endpoints]);

  useEffect(() => {
    if (!selectedEndpointId) {
      setImageAliases([]);
      return;
    }
    let cancelled = false;
    void IPC.meshIncusListImages(selectedEndpointId).then(res => {
      if (cancelled) return;
      if (res.ok) setImageAliases(res.aliases.map(a => ({ name: a.name, description: a.description })));
    }).catch(() => {
      if (!cancelled) setImageAliases([]);
    });
    return () => { cancelled = true; };
  }, [selectedEndpointId]);

  const saveEndpoint = async (endpoint: IncusEndpoint) => {
    setBusy(true);
    setStatus(null);
    try {
      await IPC.meshIncusUpsertEndpoint(incusEndpointToPayload(endpoint));
      await refresh();
      setEditor(null);
      setSelectedEndpointId(endpoint.id);
      setStatusAndToast(`Saved Incus endpoint ${endpoint.alias}`, 'success');
    } catch (e: any) {
      setStatusAndToast(e?.message || 'Could not save endpoint', 'warning');
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
      setStatusAndToast('Endpoint removed', 'success');
    } catch (e: any) {
      setStatusAndToast(e?.message || 'Delete failed', 'warning');
    } finally { setBusy(false); }
  };

  const testEndpoint = async (endpointId: string) => {
    setBusy(true);
    try {
      const res = await IPC.meshIncusTestEndpoint(endpointId);
      if (!res.ok) throw new Error(res.error || 'Trust probe failed');
      if (res.endpoints) setEndpoints(res.endpoints.map((e: Record<string, unknown>) => normalizeIncusEndpoint(e)));
      setStatusAndToast(
        res.info?.trusted ? 'Trusted — Incus API reachable' : 'Connected but not trusted yet — paste a trust token and save',
        res.info?.trusted ? 'success' : 'info',
      );
    } catch (e: any) {
      setStatusAndToast(e?.message || 'Test failed', 'warning');
      await refresh();
    } finally { setBusy(false); }
  };

  const launch = async () => {
    if (!selectedEndpointId) {
      setStatusAndToast('Add an Incus endpoint first', 'warning');
      return;
    }
    setBusy(true);
    setStatusAndToast('Launching ephemeral instance…', 'info');
    try {
      const res = await IPC.meshIncusLaunch({
        endpointId: selectedEndpointId,
        imageAlias: launchImage,
        instanceType: launchType,
        ephemeral: true,
        start: true,
        registerMeshHost: true,
        alias: launchAlias || undefined,
      });
      if (!res.ok) throw new Error(res.error || 'Launch failed');
      await refresh();
      const inst = res.instance ? normalizeIncusEphemeral(res.instance as Record<string, unknown>) : null;
      setStatusAndToast(inst?.ipv4
        ? `Ready — ${inst.instanceName} @ ${inst.ipv4} registered on Mesh`
        : `Launched ${inst?.instanceName || 'instance'} — waiting for IP (Refresh)`,
        inst?.ipv4 ? 'success' : 'info');
    } catch (e: any) {
      setStatusAndToast(e?.message || 'Launch failed', 'warning');
      await refresh();
    } finally { setBusy(false); }
  };

  const refreshOne = async (id: string) => {
    setBusy(true);
    try {
      const res = await IPC.meshIncusRefresh(id);
      if (!res.ok) throw new Error(res.error || 'Refresh failed');
      const before = instances.find(i => i.id === id);
      await refresh();
      const after = res.instance ? normalizeIncusEphemeral(res.instance as Record<string, unknown>) : null;
      const ip = after?.ipv4 || after?.ipv6;
      if (ip && !(before?.ipv4 || before?.ipv6)) {
        setStatusAndToast(`${after?.instanceName || 'Instance'} got IP ${ip} — Mesh host ready`, 'success');
      } else {
        setStatusAndToast('Instance state refreshed', 'info');
      }
    } catch (e: any) {
      setStatusAndToast(e?.message || 'Refresh failed', 'warning');
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
      setStatusAndToast('Ephemeral host destroyed', 'success');
    } catch (e: any) {
      setStatusAndToast(e?.message || 'Destroy failed', 'warning');
    } finally { setBusy(false); }
  };

  const browseMesh = async (inst: IncusEphemeralInstance) => {
    if (!inst.meshHostId) {
      setStatusAndToast('No Mesh host registered yet — Refresh after IP appears', 'warning');
      return;
    }
    setBusy(true);
    try {
      const res = await IPC.meshConnect(inst.meshHostId);
      if (res?.error) throw new Error(res.error);
      onNavigate?.(buildMeshPath(inst.meshHostId, ''));
      setStatusAndToast(`Browsing ${inst.instanceName}`, 'success');
    } catch (e: any) {
      setStatusAndToast(e?.message || 'Browse failed — check SSH user/key on the endpoint', 'warning');
    } finally { setBusy(false); }
  };

  const shellHere = async (inst: IncusEphemeralInstance) => {
    if (!inst.meshHostId) {
      setStatusAndToast('No Mesh host registered yet — Refresh after IP appears', 'warning');
      return;
    }
    setBusy(true);
    try {
      const res = await IPC.meshTerminalOpen({ hostId: inst.meshHostId, cwd: '/' });
      if (res?.error) throw new Error(res.error);
      setStatusAndToast(`Shell Here · ${inst.instanceName}`, 'success');
    } catch (e: any) {
      setStatusAndToast(e?.message || 'Shell Here failed — ensure cloud-init injected your SSH pubkey', 'warning');
    } finally { setBusy(false); }
  };

  const draft = editor === 'new' ? createEmptyIncusEndpoint() : editor;

  return (
    <div className="flex flex-col gap-3 min-h-0">
      <PluginHeroStrip
        icon={<Icons8Icon id="server_ui" size={40} />}
        name="Ephemeral Mesh"
        typeLabel="Incus · VPS-like temps"
        meta={<span className="text-[10px] text-gray-500">Launch → IP → Mesh SSH · destroy when done</span>}
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
            <PluginFieldLabel>Mesh alias (optional)</PluginFieldLabel>
            <input className={PLUGIN_INPUT_CLASS} value={launchAlias} onChange={e => setLaunchAlias(e.target.value)} placeholder="Build box" />
            <PluginToolbarButton onClick={() => void launch()} disabled={busy || !selectedEndpointId}>
              <Icons8Icon id="play" size={12} /> Launch ephemeral · register Mesh host
            </PluginToolbarButton>
          </PluginCard>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] font-semibold tracking-wide text-sky-200/80 uppercase">Live ephemerals</div>
        {instances.length === 0 ? (
          <PluginEmptyState
            icon="cloud_ui"
            title="No temporary hosts"
            description="Launch a container or VM from your Incus endpoint. When an IPv4 appears, BNDZ registers it as a Mesh SSH host for browse / terminal / mirror."
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
      <PluginFieldLabel>SSH user / port / key for Mesh registration</PluginFieldLabel>
      <div className="grid grid-cols-3 gap-2">
        <input className={PLUGIN_INPUT_CLASS} value={draft.defaultSshUser} onChange={e => set('defaultSshUser', e.target.value)} placeholder="root" />
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
