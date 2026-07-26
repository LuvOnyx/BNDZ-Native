import React, { useCallback, useEffect, useState } from 'react';
import { IPC } from '../../lib/ipcBridge';
import { buildMeshPath } from '../../lib/meshPaths';
import { Icons8Icon } from '../Icons8Icon';
import MeshHostEditor from './MeshHostEditor';
import {
  PluginToolbarButton, PluginCard, PluginEmptyState, PluginHeroStrip, PluginHeroActionButton,
} from '../plugins/PluginPanelPrimitives';
import {
  type MeshHost,
  MESH_STATE_LABEL,
  MESH_PROVIDER_LABEL,
  normalizeMeshHost,
  meshHostToPayload,
  createEmptyMeshHost,
} from '../../lib/meshTypes';

type Props = {
  onNavigate?: (path: string) => void;
  onStatus?: (msg: string | null) => void;
  compact?: boolean;
  showHero?: boolean;
};

export default function MeshHostsManager({ onNavigate, onStatus, compact, showHero = true }: Props) {
  const [hosts, setHosts] = useState<MeshHost[]>([]);
  const [busy, setBusy] = useState(false);
  const [editorHost, setEditorHost] = useState<MeshHost | null | 'new'>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await IPC.meshListHosts();
      const normalized = (list as Record<string, unknown>[]).map(normalizeMeshHost);
      setHosts(normalized);
      return normalized;
    } catch (e: any) {
      onStatus?.(e?.message || 'Could not load remote hosts');
      return [];
    }
  }, [onStatus]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    return IPC.onMeshHostsChanged((list) => {
      const rows = Array.isArray(list) ? list : (list as any)?.hosts;
      if (Array.isArray(rows)) setHosts(rows.map((h: Record<string, unknown>) => normalizeMeshHost(h)));
    });
  }, []);

  const setStatus = (msg: string | null) => onStatus?.(msg);

  const importSsh = async () => {
    setBusy(true);
    try {
      const res = await IPC.meshImportSshConfig();
      setHosts((res.hosts as Record<string, unknown>[]).map(normalizeMeshHost));
      setStatus(`Imported ${res.imported} host(s) from ~/.ssh/config`);
    } catch (e: any) {
      setStatus(e?.message || 'SSH import failed');
    } finally { setBusy(false); }
  };

  const saveHost = async (host: MeshHost) => {
    setBusy(true);
    setStatus(null);
    try {
      await IPC.meshUpsertHost(meshHostToPayload(host));
      await refresh();
      setEditorHost(null);
      setSelectedId(host.id);
      setStatus(`Saved ${host.alias}`);
    } catch (e: any) {
      setStatus(e?.message || 'Could not save host');
    } finally { setBusy(false); }
  };

  const deleteHost = async (hostId: string) => {
    if (!confirm('Remove this remote host? Sync rules referencing it will stop working.')) return;
    setBusy(true);
    try {
      await IPC.meshDeleteHost(hostId);
      await refresh();
      if (selectedId === hostId) setSelectedId(null);
      setStatus('Host removed');
    } catch (e: any) {
      setStatus(e?.message || 'Delete failed');
    } finally { setBusy(false); }
  };

  const connect = async (hostId: string) => {
    setBusy(true);
    setSelectedId(hostId);
    try {
      const res = await IPC.meshConnect(hostId);
      if (res?.error) throw new Error(res.error);
      await refresh();
      setStatus('Connected');
    } catch (e: any) {
      setStatus(e?.message || 'Connection failed');
      await refresh();
    } finally { setBusy(false); }
  };

  const browse = (host: MeshHost) => {
    const root = host.remoteRootPath && host.remoteRootPath !== '/' ? host.remoteRootPath : '';
    onNavigate?.(buildMeshPath(host.id, root));
    setStatus(`Browsing ${host.alias}`);
  };

  const stateClass = (state: number) =>
    state === 2 ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' :
    state === 4 ? 'bg-red-500/15 text-red-400 border-red-500/25' :
    state === 1 ? 'bg-amber-500/15 text-amber-300 border-amber-500/25' :
    'bg-white/5 text-gray-400 border-white/10';

  return (
    <div className={`flex flex-col gap-3 ${compact ? '' : 'min-h-0'}`}>
      {showHero && (
        <PluginHeroStrip
          icon={<Icons8Icon id="cloud_ui" size={40} />}
          name="Remote Mesh Hosts"
          typeLabel="SSH · SFTP · S3"
          meta={<span className="text-[10px] text-gray-500">Browse, mirror, terminal</span>}
          actions={
            <>
              <PluginHeroActionButton icon="add" variant="primary" onClick={() => setEditorHost('new')}>
                Add host
              </PluginHeroActionButton>
              <PluginHeroActionButton icon="import" onClick={() => void importSsh()} disabled={busy}>
                Import SSH config
              </PluginHeroActionButton>
            </>
          }
        />
      )}

      {!showHero && (
        <div className="flex flex-wrap gap-2">
          <PluginToolbarButton onClick={() => setEditorHost('new')} disabled={busy}>
            <Icons8Icon id="add" size={12} /> Add host
          </PluginToolbarButton>
          <PluginToolbarButton onClick={() => void importSsh()} disabled={busy}>
            <Icons8Icon id="import" size={12} /> Import SSH
          </PluginToolbarButton>
          <PluginToolbarButton onClick={() => void refresh()} disabled={busy}>
            <Icons8Icon id="refresh" size={12} /> Refresh
          </PluginToolbarButton>
        </div>
      )}

      {editorHost !== null && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !busy && setEditorHost(null)}>
          <div className="w-full max-w-2xl" onClick={e => e.stopPropagation()}>
            <MeshHostEditor
              host={editorHost === 'new' ? null : editorHost}
              busy={busy}
              onCancel={() => setEditorHost(null)}
              onSave={saveHost}
            />
          </div>
        </div>
      )}

      {hosts.length === 0 ? (
        <PluginEmptyState
          icon="cloud_ui"
          title="No remote hosts yet"
          description="Add a server manually or import from ~/.ssh/config. Pin hosts to the folder tree in Workspace Tools settings."
        />
      ) : (
        <div className={`grid gap-2 ${compact ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2'}`}>
          {hosts.map(h => (
            <PluginCard
              key={h.id}
              className={`!p-3 flex flex-col gap-2 transition-colors ${selectedId === h.id ? 'ring-1 ring-sky-400/40' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Icons8Icon id={h.provider === 1 ? 'cloud_ui' : 'server_ui'} size={14} className="text-sky-400 shrink-0" />
                    <div className="font-semibold text-sm text-white truncate">{h.alias}</div>
                    {h.showInNavTree !== false && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-400/20 shrink-0">Tree</span>
                    )}
                  </div>
                  <div className="text-[10px] text-gray-500 truncate mt-0.5">
                    {h.provider === 1
                      ? `${MESH_PROVIDER_LABEL[h.provider]} · ${h.s3Bucket || 'no bucket'}`
                      : `${h.username}@${h.hostname}:${h.port}`}
                  </div>
                  {h.notes && <div className="text-[10px] text-gray-600 truncate mt-1">{h.notes}</div>}
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${stateClass(h.state)}`}>
                  {MESH_STATE_LABEL[h.state] ?? 'Unknown'}
                </span>
              </div>

              {h.lastError && <div className="text-[10px] text-red-400/90 bg-red-500/5 border border-red-500/10 rounded px-2 py-1">{h.lastError}</div>}

              <div className="flex flex-wrap gap-1.5 pt-1">
                <PluginToolbarButton onClick={() => { setSelectedId(h.id); void connect(h.id); }} disabled={busy}>
                  <Icons8Icon id="link" size={12} /> Connect
                </PluginToolbarButton>
                <PluginToolbarButton onClick={() => browse(h)} disabled={h.state !== 2}>
                  <Icons8Icon id="folder_open_ui" size={12} /> Browse
                </PluginToolbarButton>
                <PluginToolbarButton onClick={() => setEditorHost(h)} disabled={busy}>
                  <Icons8Icon id="edit" size={12} /> Edit
                </PluginToolbarButton>
                <PluginToolbarButton onClick={() => void deleteHost(h.id)} disabled={busy}>
                  <Icons8Icon id="trash" size={12} /> Remove
                </PluginToolbarButton>
              </div>
            </PluginCard>
          ))}
        </div>
      )}
    </div>
  );
}

export { createEmptyMeshHost };
