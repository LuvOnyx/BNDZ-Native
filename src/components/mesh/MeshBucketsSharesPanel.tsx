import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { IPC } from '../../lib/ipcBridge';
import { buildMeshPath } from '../../lib/meshPaths';
import { Icons8Icon } from '../Icons8Icon';
import {
  PluginToolbarButton, PluginCard, PluginEmptyState, PluginFieldLabel, PLUGIN_INPUT_CLASS,
} from '../plugins/PluginPanelPrimitives';
import {
  type MeshHost,
  MESH_PROVIDER_LABEL,
  MESH_STATE_LABEL,
  normalizeMeshHost,
  createEmptyMeshHost,
  meshHostToPayload,
} from '../../lib/meshTypes';
import { useAppConfig } from '../../data/configContext';
import { toWindowsPath } from '../../lib/pathUtils';

export type SharedLibrary = {
  id: string;
  name: string;
  path: string;
  kind: 'folder' | 'bucket';
};

type Props = {
  onNavigate?: (path: string) => void;
  onStatus?: (msg: string | null) => void;
};

function loadSharedLibraries(raw: unknown): SharedLibrary[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row, i) => {
      const r = row as Record<string, unknown>;
      const path = String(r.path ?? r.Path ?? '').trim();
      if (!path) return null;
      return {
        id: String(r.id ?? r.Id ?? `share-${i}`),
        name: String(r.name ?? r.Name ?? (path.split(/[/\\]/).filter(Boolean).pop() || 'Shared')),
        path,
        kind: (r.kind === 'bucket' ? 'bucket' : 'folder') as SharedLibrary['kind'],
      };
    })
    .filter(Boolean) as SharedLibrary[];
}

export default function MeshBucketsSharesPanel({ onNavigate, onStatus }: Props) {
  const { config, updateConfig } = useAppConfig();
  const [hosts, setHosts] = useState<MeshHost[]>([]);
  const [busy, setBusy] = useState(false);
  const [folderDraft, setFolderDraft] = useState('');
  const [bucketName, setBucketName] = useState('');
  const [bucketEndpoint, setBucketEndpoint] = useState('');
  const [bucketRegion, setBucketRegion] = useState('us-east-1');
  const [bucketKey, setBucketKey] = useState('');
  const [bucketSecret, setBucketSecret] = useState('');

  const shared = useMemo(() => loadSharedLibraries(config.sharedLibraries), [config.sharedLibraries]);

  const refresh = useCallback(async () => {
    try {
      const list = await IPC.meshListHosts();
      setHosts((list as Record<string, unknown>[]).map(normalizeMeshHost));
    } catch (e: any) {
      onStatus?.(e?.message || 'Could not load buckets');
    }
  }, [onStatus]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    return IPC.onMeshHostsChanged((list) => {
      const rows = Array.isArray(list) ? list : (list as any)?.hosts;
      if (Array.isArray(rows)) setHosts(rows.map((h: Record<string, unknown>) => normalizeMeshHost(h)));
    });
  }, []);

  const buckets = useMemo(
    () => hosts.filter(h => h.provider === 1),
    [hosts],
  );

  const persistShared = (next: SharedLibrary[]) => {
    updateConfig({ sharedLibraries: next });
    window.dispatchEvent(new CustomEvent('bndz-shared-libraries-changed', { detail: { libraries: next } }));
  };

  const addSharedFolder = async () => {
    let path = folderDraft.trim();
    if (!path) {
      path = (await IPC.openFolderDialog('Select a shared folder')) || '';
    }
    if (!path) return;
    const win = toWindowsPath(path) || path;
    if (shared.some(s => s.path.toLowerCase() === win.toLowerCase())) {
      onStatus?.('Folder already in Shared Libraries.');
      return;
    }
    const name = win.split(/[/\\]/).filter(Boolean).pop() || 'Shared Folder';
    const next = [...shared, { id: `share-${Date.now()}`, name, path: win, kind: 'folder' as const }];
    persistShared(next);
    setFolderDraft('');
    onStatus?.(`Shared folder added: ${name}`);
  };

  const removeShared = (id: string) => {
    persistShared(shared.filter(s => s.id !== id));
    onStatus?.('Removed from Shared Libraries.');
  };

  const openInList = (path: string) => {
    const pane = path.includes('\\') || /^[A-Za-z]:/.test(path)
      ? `/${path.replace(/\\/g, '/')}`
      : path;
    onNavigate?.(pane);
    onStatus?.(`Opened ${path}`);
  };

  const openBucket = (host: MeshHost) => {
    onNavigate?.(buildMeshPath(host.id, host.remoteRootPath || '/'));
    onStatus?.(`Browsing bucket ${host.s3Bucket || host.alias}`);
  };

  const createBucketHost = async () => {
    const name = bucketName.trim();
    if (!name) {
      onStatus?.('Bucket name is required.');
      return;
    }
    setBusy(true);
    try {
      const host = createEmptyMeshHost({
        provider: 1,
        alias: name,
        s3Bucket: name,
        s3Region: bucketRegion.trim() || 'us-east-1',
        s3Endpoint: bucketEndpoint.trim() || undefined,
        s3AccessKeyId: bucketKey.trim() || undefined,
        passwordPlain: bucketSecret || undefined,
        showInNavTree: true,
        hostname: bucketEndpoint.trim() || 's3.amazonaws.com',
      });
      await IPC.meshUpsertHost(meshHostToPayload(host));
      await refresh();
      setBucketName('');
      setBucketSecret('');
      onStatus?.(`Bucket host saved: ${name}`);
      onNavigate?.(buildMeshPath(host.id, '/'));
    } catch (e: any) {
      onStatus?.(e?.message || 'Could not save bucket');
    } finally {
      setBusy(false);
    }
  };

  const shareViaMeshDrop = (path: string) => {
    window.dispatchEvent(new CustomEvent('bndz-mesh-drop-send', {
      detail: { paths: path ? [path] : [] },
    }));
  };

  return (
    <div className="space-y-4">
      <PluginCard>
        <div className="flex items-center gap-2 mb-2">
          <Icons8Icon id="cloud_ui" size={14} className="text-sky-300" />
          <div>
            <div className="text-[12px] font-semibold text-white/90">S3 Buckets</div>
            <div className="text-[10px] text-white/45">Browse object storage as folders in the file list</div>
          </div>
        </div>
        {buckets.length === 0 ? (
          <PluginEmptyState
            icon="cloud_ui"
            title="No buckets yet"
            description="Add an S3-compatible bucket below — it opens in the file list like a drive."
          />
        ) : (
          <div className="space-y-2">
            {buckets.map(b => (
              <div
                key={b.id}
                className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-gradient-to-br from-sky-500/[0.08] to-transparent px-3 py-2"
              >
                <Icons8Icon id="cloud_ui" size={16} className="text-sky-300 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-semibold text-white/90 truncate">{b.alias}</div>
                  <div className="text-[10px] text-white/45 truncate">
                    {MESH_PROVIDER_LABEL[b.provider]} · {b.s3Bucket || 'bucket'} · {MESH_STATE_LABEL[b.state] || 'Offline'}
                  </div>
                </div>
                <PluginToolbarButton onClick={() => openBucket(b)}>Open in list</PluginToolbarButton>
                <PluginToolbarButton onClick={() => shareViaMeshDrop(buildMeshPath(b.id, '/'))}>
                  Link share
                </PluginToolbarButton>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <PluginFieldLabel>Bucket name</PluginFieldLabel>
            <input className={PLUGIN_INPUT_CLASS} value={bucketName} onChange={e => setBucketName(e.target.value)} placeholder="my-bucket" />
          </div>
          <div>
            <PluginFieldLabel>Region</PluginFieldLabel>
            <input className={PLUGIN_INPUT_CLASS} value={bucketRegion} onChange={e => setBucketRegion(e.target.value)} placeholder="us-east-1" />
          </div>
          <div className="sm:col-span-2">
            <PluginFieldLabel>Endpoint (optional — MinIO / R2 / Wasabi)</PluginFieldLabel>
            <input className={PLUGIN_INPUT_CLASS} value={bucketEndpoint} onChange={e => setBucketEndpoint(e.target.value)} placeholder="https://…" />
          </div>
          <div>
            <PluginFieldLabel>Access key</PluginFieldLabel>
            <input className={PLUGIN_INPUT_CLASS} value={bucketKey} onChange={e => setBucketKey(e.target.value)} autoComplete="off" />
          </div>
          <div>
            <PluginFieldLabel>Secret</PluginFieldLabel>
            <input className={PLUGIN_INPUT_CLASS} type="password" value={bucketSecret} onChange={e => setBucketSecret(e.target.value)} autoComplete="off" />
          </div>
        </div>
        <div className="mt-2 flex gap-2">
          <PluginToolbarButton onClick={() => void createBucketHost()} disabled={busy}>
            Save bucket & open
          </PluginToolbarButton>
        </div>
      </PluginCard>

      <PluginCard>
        <div className="flex items-center gap-2 mb-2">
          <Icons8Icon id="emblem-shared" size={14} className="text-violet-300" />
          <div>
            <div className="text-[12px] font-semibold text-white/90">Shared Folders</div>
            <div className="text-[10px] text-white/45">Local libraries for collaboration + MeshDrop link sharing</div>
          </div>
        </div>
        <div className="flex gap-2 mb-3">
          <input
            className={`${PLUGIN_INPUT_CLASS} flex-1`}
            value={folderDraft}
            onChange={e => setFolderDraft(e.target.value)}
            placeholder="C:\\Users\\…\\Shared"
            onKeyDown={e => { if (e.key === 'Enter') void addSharedFolder(); }}
          />
          <PluginToolbarButton onClick={() => void addSharedFolder()}>Add folder</PluginToolbarButton>
        </div>

        {shared.length === 0 ? (
          <PluginEmptyState
            icon="emblem-shared"
            title="No shared folders"
            description="Add a local folder — open it in the list, or MeshDrop a link from the context menu."
          />
        ) : (
          <div className="space-y-2">
            {shared.map(s => (
              <div
                key={s.id}
                className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-gradient-to-br from-violet-500/[0.07] to-transparent px-3 py-2"
              >
                <Icons8Icon id="emblem-shared" size={16} className="text-violet-300 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-semibold text-white/90 truncate">{s.name}</div>
                  <div className="text-[10px] text-white/45 truncate">{s.path}</div>
                </div>
                <PluginToolbarButton onClick={() => openInList(s.path)}>Open</PluginToolbarButton>
                <PluginToolbarButton onClick={() => shareViaMeshDrop(s.path)}>MeshDrop</PluginToolbarButton>
                <PluginToolbarButton onClick={() => removeShared(s.id)}>Remove</PluginToolbarButton>
              </div>
            ))}
          </div>
        )}
      </PluginCard>

      <PluginCard>
        <div className="flex items-center gap-2 mb-2">
          <Icons8Icon id="emblem-shared" size={14} className="text-emerald-300" />
          <div>
            <div className="text-[12px] font-semibold text-white/90">Link sharing</div>
            <div className="text-[10px] text-white/45">Mesh Code · deep link · QR · LAN · relay</div>
          </div>
        </div>
        <p className="text-[11px] text-white/50 mb-2 leading-relaxed">
          Pick files in the list, then Share → MeshDrop — or open MeshDrop here to create a share code,
          copy a <code className="text-white/70">bndz://meshdrop/…</code> deep link, show a QR, or join via LAN/relay.
        </p>
        <div className="flex flex-wrap gap-2">
          <PluginToolbarButton onClick={() => shareViaMeshDrop(folderDraft.trim() || '')}>
            Open MeshDrop sender
          </PluginToolbarButton>
          <PluginToolbarButton onClick={() => {
            window.dispatchEvent(new CustomEvent('bndz-mesh-drop-send', { detail: { paths: [], receive: true } }));
          }}>
            Receive / join link
          </PluginToolbarButton>
        </div>
      </PluginCard>
    </div>
  );
}
