import React, { useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { EmblemIcon } from '../EmblemIcon';
import MeshDropDialog from './MeshDropDialog';
import MeshDropSessionPanel from './MeshDropSessionPanel';
import {
  PluginCard, PluginEmptyState, PluginHeroStrip, PluginHeroActionButton, PluginToolbarButton,
} from '../plugins/PluginPanelPrimitives';

type Props = {
  selectionPaths?: string[];
  onStatus?: (msg: string | null) => void;
};

/**
 * Remote Mesh · Mesh Drop — P2P send/receive (separate from SSH hosts and Mesh VPS).
 */
export default function MeshDropPanel({ selectionPaths = [], onStatus }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'host' | 'receive'>('host');
  const [paths, setPaths] = useState<string[]>(selectionPaths);

  const openSend = (extra: string[] = []) => {
    const next = [...new Set([...selectionPaths, ...extra, ...paths].filter(Boolean))];
    setPaths(next);
    setMode('host');
    setOpen(true);
    onStatus?.(next.length ? `Mesh Drop · sending ${next.length} path(s)` : 'Mesh Drop · pick files to send');
  };

  const openReceive = () => {
    setMode('receive');
    setOpen(true);
    onStatus?.('Mesh Drop · receive');
  };

  return (
    <div className="flex flex-col gap-3 min-h-0">
      <PluginHeroStrip
        icon={<EmblemIcon id="share-check" size={40} />}
        name="Mesh Drop"
        typeLabel="P2P stream · not your VPS host"
        meta={
          <span className="text-[10px] text-gray-500">
            Pair two BNDZ desktops with a Mesh Code · files stream direct (WebRTC) · separate from Hosts SSH and Mesh VPS
          </span>
        }
        actions={
          <>
            <PluginHeroActionButton icon="play" variant="primary" onClick={() => openSend()}>
              Send
            </PluginHeroActionButton>
            <PluginHeroActionButton icon="download" onClick={openReceive}>
              Receive
            </PluginHeroActionButton>
          </>
        }
      />

      <div className="grid gap-3 xl:grid-cols-2">
        <PluginCard className="!p-3 space-y-2 bndz-meshdrop-studio-card">
          <div className="text-[11px] font-semibold tracking-wide text-cyan-200/85 uppercase">How it works</div>
          <ol className="text-[11px] text-gray-400 leading-relaxed space-y-1.5 list-decimal pl-4">
            <li>Sender: pick files → Generate offer → copy Mesh Code.</li>
            <li>Receiver: paste Mesh Code → choose folder → Accept &amp; answer.</li>
            <li>Sender pastes Answer Code → Connect &amp; Stream.</li>
          </ol>
          <p className="text-[10px] text-gray-500 leading-relaxed">
            Same LAN is easiest. Cross-internet needs TURN in Settings → Workspace Tools → Mesh Drop.
            Purchased hosts (e.g. BandzVPS) stay under Hosts — Mesh Drop is peer-to-peer only.
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <PluginToolbarButton onClick={() => openSend(selectionPaths)}>
              Send selection ({selectionPaths.length})
            </PluginToolbarButton>
            <PluginToolbarButton onClick={openReceive}>Open receive</PluginToolbarButton>
          </div>
        </PluginCard>

        <PluginCard className="!p-0 overflow-hidden bndz-meshdrop-studio-card">
          <MeshDropSessionPanel />
          {!selectionPaths.length && (
            <div className="px-3 pb-3">
              <PluginEmptyState
                icon="cloud_ui"
                title="Nothing queued"
                description="Select files in the list and Send, or drop onto the Mesh Drop inbox in the transfer panel."
              />
            </div>
          )}
        </PluginCard>
      </div>

      {open && (
        <MeshDropDialog
          paths={paths}
          initialMode={mode}
          onClose={() => {
            setOpen(false);
            onStatus?.(null);
          }}
        />
      )}
    </div>
  );
}
