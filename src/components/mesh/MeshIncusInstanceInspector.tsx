import React, { useCallback, useEffect, useState } from 'react';
import { IPC } from '../../lib/ipcBridge';
import { Icons8Icon } from '../Icons8Icon';
import { PluginToolbarButton, PluginFieldLabel, PLUGIN_INPUT_CLASS } from '../plugins/PluginPanelPrimitives';
import { requestNativeConfirm } from '../../lib/nativeDialog';

type Snapshot = { name: string; stateful?: boolean; createdAt?: string; CreatedAt?: string };
type InstanceDetail = {
  name?: string;
  Name?: string;
  status?: string;
  Status?: string;
  type?: string;
  Type?: string;
  ephemeral?: boolean;
  Ephemeral?: boolean;
  description?: string;
  Description?: string;
  profiles?: string[];
  Profiles?: string[];
  config?: Record<string, string>;
  Config?: Record<string, string>;
  devices?: Record<string, Record<string, string>>;
  Devices?: Record<string, Record<string, string>>;
  etag?: string;
  ETag?: string;
};

type Props = {
  ephemeralId: string;
  instanceName: string;
  busy: boolean;
  onBusy: (v: boolean) => void;
  onStatus: (msg: string | null) => void;
  onClose: () => void;
  onChanged: () => void;
};

export default function MeshIncusInstanceInspector({
  ephemeralId,
  instanceName,
  busy,
  onBusy,
  onStatus,
  onClose,
  onChanged,
}: Props) {
  const [detail, setDetail] = useState<InstanceDetail | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapName, setSnapName] = useState('');
  const [stateful, setStateful] = useState(false);
  const [profilesText, setProfilesText] = useState('default');
  const [description, setDescription] = useState('');
  const [limitsCpu, setLimitsCpu] = useState('');
  const [limitsMemory, setLimitsMemory] = useState('');
  const [etag, setEtag] = useState<string | undefined>();

  const load = useCallback(async () => {
    onBusy(true);
    try {
      const [instRes, snapRes] = await Promise.all([
        IPC.meshIncusGetInstance(ephemeralId),
        IPC.meshIncusListSnapshots(ephemeralId),
      ]);
      if (!instRes.ok) throw new Error(instRes.error || 'Could not load instance');
      const d = (instRes.instance || {}) as InstanceDetail;
      setDetail(d);
      setEtag(instRes.etag || d.etag || d.ETag);
      const profiles = d.profiles || d.Profiles || [];
      setProfilesText(profiles.join(', ') || 'default');
      setDescription(d.description || d.Description || '');
      const cfg = d.config || d.Config || {};
      setLimitsCpu(cfg['limits.cpu'] || '');
      setLimitsMemory(cfg['limits.memory'] || '');
      if (snapRes.ok) setSnapshots(snapRes.snapshots as Snapshot[]);
    } catch (e: any) {
      onStatus(e?.message || 'Inspector load failed');
    } finally {
      onBusy(false);
    }
  }, [ephemeralId, onBusy, onStatus]);

  useEffect(() => { void load(); }, [load]);

  const saveConfig = async () => {
    onBusy(true);
    try {
      const profiles = profilesText.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
      const config: Record<string, string> = {};
      if (limitsCpu.trim()) config['limits.cpu'] = limitsCpu.trim();
      if (limitsMemory.trim()) config['limits.memory'] = limitsMemory.trim();
      const res = await IPC.meshIncusUpdateInstance({
        ephemeralId,
        profiles,
        description: description || undefined,
        config,
        etag,
      });
      if (!res.ok) throw new Error(res.error || 'Save failed');
      onStatus(`Saved config for ${instanceName}`);
      onChanged();
      await load();
    } catch (e: any) {
      onStatus(e?.message || 'Save failed');
    } finally {
      onBusy(false);
    }
  };

  const createSnap = async () => {
    const name = snapName.trim() || `snap-${Date.now().toString(36)}`;
    onBusy(true);
    try {
      const res = await IPC.meshIncusCreateSnapshot(ephemeralId, name, stateful);
      if (!res.ok) throw new Error(res.error || 'Snapshot failed');
      setSnapshots((res.snapshots || []) as Snapshot[]);
      setSnapName('');
      onStatus(`Snapshot ${name} created`);
    } catch (e: any) {
      onStatus(e?.message || 'Snapshot failed');
    } finally {
      onBusy(false);
    }
  };

  const restoreSnap = async (name: string) => {
    const ok = await requestNativeConfirm({
      title: 'Restore snapshot',
      message: `Restore ${instanceName} to snapshot “${name}”? Running state will change.`,
      type: 'warning',
      confirmLabel: 'Restore',
      cancelLabel: 'Cancel',
      destructive: true,
    });
    if (!ok) return;
    onBusy(true);
    try {
      const res = await IPC.meshIncusRestoreSnapshot(ephemeralId, name);
      if (!res.ok) throw new Error(res.error || 'Restore failed');
      onStatus(`Restored to ${name}`);
      onChanged();
      await load();
    } catch (e: any) {
      onStatus(e?.message || 'Restore failed');
    } finally {
      onBusy(false);
    }
  };

  const deleteSnap = async (name: string) => {
    const ok = await requestNativeConfirm({
      title: 'Delete snapshot',
      message: `Permanently delete snapshot “${name}”?`,
      type: 'warning',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      destructive: true,
    });
    if (!ok) return;
    onBusy(true);
    try {
      const res = await IPC.meshIncusDeleteSnapshot(ephemeralId, name);
      if (!res.ok) throw new Error(res.error || 'Delete failed');
      setSnapshots((res.snapshots || []) as Snapshot[]);
      onStatus(`Deleted snapshot ${name}`);
    } catch (e: any) {
      onStatus(e?.message || 'Delete failed');
    } finally {
      onBusy(false);
    }
  };

  const devices = detail?.devices || detail?.Devices || {};

  return (
    <div className="bndz-mesh-incus-inspector fixed inset-0 z-[130] flex items-end sm:items-center justify-center p-3 sm:p-6 bg-black/65 backdrop-blur-sm" onClick={() => !busy && onClose()}>
      <div
        className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bndz-scrollbar rounded-2xl border border-sky-400/20 bg-gradient-to-br from-[#0c1824] via-[#0a121c] to-[#080e14] shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3 border-b border-white/[0.06] bg-[#0c1824]/95 backdrop-blur-md">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white truncate flex items-center gap-2">
              <Icons8Icon id="server_ui" size={16} />
              {instanceName}
            </div>
            <div className="text-[10px] text-sky-300/70 mt-0.5">
              {(detail?.status || detail?.Status || '…')} · {(detail?.type || detail?.Type || 'instance')}
              {(detail?.ephemeral ?? detail?.Ephemeral) ? ' · ephemeral' : ' · persistent'}
            </div>
          </div>
          <button type="button" className="text-xs text-gray-400 hover:text-white px-2 py-1" onClick={onClose} disabled={busy}>Close</button>
        </div>

        <div className="p-4 grid gap-4 lg:grid-cols-2">
          <section className="space-y-2">
            <div className="text-[11px] font-semibold tracking-wide text-sky-200/80 uppercase">Config &amp; profiles</div>
            <PluginFieldLabel>Profiles (comma-separated)</PluginFieldLabel>
            <input className={PLUGIN_INPUT_CLASS} value={profilesText} onChange={e => setProfilesText(e.target.value)} placeholder="default" />
            <PluginFieldLabel>Description</PluginFieldLabel>
            <input className={PLUGIN_INPUT_CLASS} value={description} onChange={e => setDescription(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <PluginFieldLabel>limits.cpu</PluginFieldLabel>
                <input className={PLUGIN_INPUT_CLASS} value={limitsCpu} onChange={e => setLimitsCpu(e.target.value)} placeholder="2" />
              </div>
              <div>
                <PluginFieldLabel>limits.memory</PluginFieldLabel>
                <input className={PLUGIN_INPUT_CLASS} value={limitsMemory} onChange={e => setLimitsMemory(e.target.value)} placeholder="2GiB" />
              </div>
            </div>
            <PluginToolbarButton onClick={() => void saveConfig()} disabled={busy}>
              <Icons8Icon id="save" size={12} /> Save instance config
            </PluginToolbarButton>

            <div className="text-[11px] font-semibold tracking-wide text-sky-200/80 uppercase pt-2">Devices</div>
            {Object.keys(devices).length === 0 ? (
              <div className="text-[10px] text-gray-500">No devices reported (profiles may supply eth0/root).</div>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto bndz-scrollbar">
                {Object.entries(devices).map(([name, props]) => (
                  <div key={name} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
                    <div className="text-[11px] text-white font-medium">{name}</div>
                    <div className="text-[9px] text-gray-500 bndz-mono truncate">
                      {Object.entries(props).map(([k, v]) => `${k}=${v}`).join(' · ')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <div className="text-[11px] font-semibold tracking-wide text-sky-200/80 uppercase">Snapshots</div>
            <div className="flex gap-2">
              <input
                className={`${PLUGIN_INPUT_CLASS} flex-1`}
                value={snapName}
                onChange={e => setSnapName(e.target.value)}
                placeholder="snap-before-upgrade"
              />
              <PluginToolbarButton onClick={() => void createSnap()} disabled={busy}>Create</PluginToolbarButton>
            </div>
            <label className="flex items-center gap-2 text-[11px] text-gray-400">
              <input type="checkbox" checked={stateful} onChange={e => setStateful(e.target.checked)} />
              Stateful snapshot (VM memory when supported)
            </label>
            {snapshots.length === 0 ? (
              <div className="text-[10px] text-gray-500 py-4 text-center rounded-xl border border-dashed border-white/10">
                No snapshots yet — create a checkpoint before risky changes.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto bndz-scrollbar">
                {snapshots.map(s => {
                  const name = s.name;
                  const created = s.createdAt || s.CreatedAt;
                  return (
                    <div key={name} className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.025] px-2.5 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] text-white font-medium truncate">{name}</div>
                        <div className="text-[9px] text-gray-500">
                          {s.stateful ? 'stateful · ' : ''}{created ? new Date(created).toLocaleString() : '—'}
                        </div>
                      </div>
                      <PluginToolbarButton onClick={() => void restoreSnap(name)} disabled={busy}>Restore</PluginToolbarButton>
                      <PluginToolbarButton onClick={() => void deleteSnap(name)} disabled={busy}>Delete</PluginToolbarButton>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
