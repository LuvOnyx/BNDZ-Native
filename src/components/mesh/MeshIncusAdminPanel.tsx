import React, { useMemo, useState } from 'react';
import { IPC } from '../../lib/ipcBridge';
import { type IncusEndpoint, incusAdminWebUrl } from '../../lib/incusTypes';
import { Icons8Icon } from '../Icons8Icon';
import { PluginCard, PluginToolbarButton } from '../plugins/PluginPanelPrimitives';

type Props = {
  endpoint: IncusEndpoint;
  onClose: () => void;
};

/** Embedded web admin for a trusted remote VPS host (same origin as the HTTPS API). */
export default function MeshIncusAdminPanel({ endpoint, onClose }: Props) {
  const adminUrl = useMemo(() => incusAdminWebUrl(endpoint.apiUrl), [endpoint.apiUrl]);
  const [frameKey, setFrameKey] = useState(0);

  const openInBrowser = () => {
    if (!adminUrl) return;
    void IPC.shellExecute('open', adminUrl);
  };

  return (
    <div className="bndz-mesh-incus-admin space-y-2">
      <PluginCard className="!p-3 space-y-2 bndz-mesh-ephemeral-editor">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white truncate">VPS Admin · {endpoint.alias}</div>
            <div className="text-[10px] text-gray-500 truncate mt-0.5">{adminUrl || 'Set a valid API URL on the host'}</div>
          </div>
          <div className="flex flex-wrap gap-1.5 shrink-0">
            <PluginToolbarButton onClick={() => setFrameKey(k => k + 1)} disabled={!adminUrl}>
              Reload
            </PluginToolbarButton>
            <PluginToolbarButton onClick={openInBrowser} disabled={!adminUrl}>
              Open in browser
            </PluginToolbarButton>
            <PluginToolbarButton onClick={onClose}>Close</PluginToolbarButton>
          </div>
        </div>
        {!endpoint.trusted && (
          <div className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-400/20 rounded-lg px-2.5 py-2">
            Trust this host first (Test + trust token) so Admin can authenticate against the VPS API.
          </div>
        )}
        <p className="text-[10px] text-gray-500 leading-relaxed">
          Opens the host&apos;s web console when enabled on the server.
          Native Create / inventory / snapshots / Mesh SSH stay in this tab — use Admin for full console control.
        </p>
        {adminUrl ? (
          <div className="relative rounded-xl overflow-hidden border border-white/[0.08] bg-[#07090e] min-h-[320px] h-[min(52vh,520px)]">
            <iframe
              key={frameKey}
              src={adminUrl}
              title={`VPS admin — ${endpoint.alias}`}
              className="absolute inset-0 w-full h-full border-0 bg-[#07090e]"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
              referrerPolicy="no-referrer"
            />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-[#07090e]/80 to-transparent" aria-hidden />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-gray-500">
            <Icons8Icon id="server_ui" size={32} className="opacity-40" />
            <span className="text-xs">Add a valid HTTPS API URL to open VPS Admin.</span>
          </div>
        )}
      </PluginCard>
    </div>
  );
}
