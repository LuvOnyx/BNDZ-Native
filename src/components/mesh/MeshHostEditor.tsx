import React, { useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { PluginFieldLabel, PLUGIN_INPUT_CLASS } from '../plugins/PluginPanelPrimitives';
import {
  type MeshHost,
  MESH_AUTH_LABEL,
  MESH_PROVIDER_LABEL,
  createEmptyMeshHost,
} from '../../lib/meshTypes';

type Props = {
  host?: MeshHost | null;
  onSave: (host: MeshHost) => void | Promise<void>;
  onCancel: () => void;
  busy?: boolean;
};

export default function MeshHostEditor({ host, onSave, onCancel, busy }: Props) {
  const [draft, setDraft] = useState<MeshHost>(host ?? createEmptyMeshHost());

  useEffect(() => {
    setDraft(host ?? createEmptyMeshHost());
  }, [host]);

  const isS3 = draft.provider === 1;
  const patch = (p: Partial<MeshHost>) => setDraft(prev => ({ ...prev, ...p }));

  return (
    <div className="bndz-mesh-host-editor flex flex-col gap-4 p-4 rounded-xl border border-white/10 bg-[#12141a]/95 backdrop-blur-md max-h-[min(72vh,640px)] overflow-y-auto bndz-scrollbar">
      <div className="flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <Icons8Icon id="cloud_ui" size={18} className="text-sky-400" />
          <h3 className="text-sm font-bold text-white">{host ? 'Edit Remote Host' : 'Add Remote Host'}</h3>
        </div>
        <button type="button" onClick={onCancel} className="text-gray-500 hover:text-white p-1" title="Close">
          <Icons8Icon id="close" size={14} />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <PluginFieldLabel>Display name</PluginFieldLabel>
          <input className={PLUGIN_INPUT_CLASS} value={draft.alias} onChange={e => patch({ alias: e.target.value })} placeholder="Production VPS" />
        </div>

        <div>
          <PluginFieldLabel>Provider</PluginFieldLabel>
          <select
            className={PLUGIN_INPUT_CLASS}
            value={draft.provider}
            onChange={e => {
              const provider = Number(e.target.value) as 0 | 1;
              patch({
                provider,
                port: provider === 1 ? 443 : 22,
                authKind: provider === 1 ? 2 : draft.authKind,
              });
            }}
          >
            {Object.entries(MESH_PROVIDER_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        <div className="flex items-end gap-2">
          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none pb-1">
            <input type="checkbox" checked={draft.showInNavTree !== false} onChange={e => patch({ showInNavTree: e.target.checked })} />
            Show in folder tree
          </label>
        </div>

        {!isS3 ? (
          <>
            <div>
              <PluginFieldLabel>Hostname / IP</PluginFieldLabel>
              <input className={PLUGIN_INPUT_CLASS} value={draft.hostname} onChange={e => patch({ hostname: e.target.value })} placeholder="192.168.1.10" />
            </div>
            <div>
              <PluginFieldLabel>Port</PluginFieldLabel>
              <input type="number" className={PLUGIN_INPUT_CLASS} value={draft.port} onChange={e => patch({ port: Number(e.target.value) || 22 })} />
            </div>
            <div>
              <PluginFieldLabel>Username</PluginFieldLabel>
              <input className={PLUGIN_INPUT_CLASS} value={draft.username} onChange={e => patch({ username: e.target.value })} placeholder="ubuntu" />
            </div>
            <div>
              <PluginFieldLabel>Authentication</PluginFieldLabel>
              <select className={PLUGIN_INPUT_CLASS} value={draft.authKind} onChange={e => patch({ authKind: Number(e.target.value) as MeshHost['authKind'] })}>
                {Object.entries(MESH_AUTH_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            {draft.authKind === 1 && (
              <div className="md:col-span-2">
                <PluginFieldLabel>Private key path</PluginFieldLabel>
                <input className={PLUGIN_INPUT_CLASS} value={draft.keyPath || ''} onChange={e => patch({ keyPath: e.target.value })} placeholder="C:\Users\you\.ssh\id_ed25519" />
              </div>
            )}
            {draft.authKind === 2 && (
              <div className="md:col-span-2">
                <PluginFieldLabel>Password</PluginFieldLabel>
                <input type="password" className={PLUGIN_INPUT_CLASS} value={draft.passwordPlain || ''} onChange={e => patch({ passwordPlain: e.target.value })} placeholder="Stored securely with DPAPI" autoComplete="new-password" />
              </div>
            )}
            <div className="md:col-span-2">
              <PluginFieldLabel>Remote root path</PluginFieldLabel>
              <input className={PLUGIN_INPUT_CLASS} value={draft.remoteRootPath || '/'} onChange={e => patch({ remoteRootPath: e.target.value })} placeholder="/home/ubuntu" />
            </div>
          </>
        ) : (
          <>
            <div className="md:col-span-2">
              <PluginFieldLabel>S3 Endpoint</PluginFieldLabel>
              <input className={PLUGIN_INPUT_CLASS} value={draft.s3Endpoint || ''} onChange={e => patch({ s3Endpoint: e.target.value })} placeholder="https://s3.amazonaws.com or play.min.io" />
            </div>
            <div>
              <PluginFieldLabel>Bucket</PluginFieldLabel>
              <input className={PLUGIN_INPUT_CLASS} value={draft.s3Bucket || ''} onChange={e => patch({ s3Bucket: e.target.value })} />
            </div>
            <div>
              <PluginFieldLabel>Region</PluginFieldLabel>
              <input className={PLUGIN_INPUT_CLASS} value={draft.s3Region || ''} onChange={e => patch({ s3Region: e.target.value })} placeholder="us-east-1" />
            </div>
            <div>
              <PluginFieldLabel>Access key ID</PluginFieldLabel>
              <input className={PLUGIN_INPUT_CLASS} value={draft.s3AccessKeyId || ''} onChange={e => patch({ s3AccessKeyId: e.target.value })} />
            </div>
            <div>
              <PluginFieldLabel>Secret key</PluginFieldLabel>
              <input type="password" className={PLUGIN_INPUT_CLASS} value={draft.passwordPlain || ''} onChange={e => patch({ passwordPlain: e.target.value })} autoComplete="new-password" />
            </div>
          </>
        )}

        <div className="md:col-span-2">
          <PluginFieldLabel>Notes</PluginFieldLabel>
          <textarea className={`${PLUGIN_INPUT_CLASS} min-h-[64px] resize-y`} value={draft.notes || ''} onChange={e => patch({ notes: e.target.value })} placeholder="Deploy target, staging server, etc." />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-white/5 shrink-0">
        <button type="button" onClick={onCancel} disabled={busy} className="px-4 py-1.5 text-xs font-semibold text-gray-400 hover:text-white rounded-md border border-white/10">
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !draft.alias.trim() || (!isS3 && !draft.hostname.trim())}
          onClick={() => void onSave(draft)}
          className="px-4 py-1.5 text-xs font-bold text-white rounded-md bg-sky-600 hover:bg-sky-500 disabled:opacity-40"
        >
          {busy ? 'Saving…' : host ? 'Save changes' : 'Add host'}
        </button>
      </div>
    </div>
  );
}
