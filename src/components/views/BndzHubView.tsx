import React, { useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { BNDZ_AUDIO, BNDZ_AUTOMATION, BNDZ_CANVAS, BNDZ_DOCUMENTS, BNDZ_LARGE, BNDZ_MEDIA, BNDZ_RAM_ROOT, BNDZ_RECENT, BNDZ_PROBLEMS, BNDZ_INBOUND, bndzVirtualLabel } from '../../lib/bndzVirtualViews';
import { IPC } from '../../lib/ipcBridge';
import { getIndexStatusCached } from '../../lib/indexStatusCache';
import { loadSpatialCanvas } from '../../lib/spatialCanvasStore';
import { loadAutomationGraph } from '../../lib/automationStore';
import BndzIndexEmptyState from './BndzIndexEmptyState';
import WorkspaceLaunchCard from '../workspace/WorkspaceLaunchCard';

type IndexStatus = {
  fileCount?: number;
  folderCount?: number;
  locations?: Array<{ path: string; lastIndexed: number }>;
};

type Props = {
  onNavigate: (path: string) => void;
  onRefresh?: () => void;
  onOpenMeshDrop?: () => void;
  onOpenGhostLink?: () => void;
  onOpenRamStaging?: () => void;
};

const VIEWS = [
  {
    path: BNDZ_RECENT,
    icon: 'clock_ui',
    accent: '#fbbf24',
    desc: 'Recently modified files across your indexed libraries',
  },
  {
    path: BNDZ_MEDIA,
    icon: 'film_ui',
    accent: '#7eb8e8',
    desc: 'Photos and videos from indexed Pictures, Videos, and more',
  },
  {
    path: BNDZ_AUDIO,
    icon: 'music_ui',
    accent: '#34d399',
    desc: 'Music and audio from indexed libraries',
  },
  {
    path: BNDZ_DOCUMENTS,
    icon: 'file_ui',
    accent: '#60a5fa',
    desc: 'PDFs, Office docs, and text from the index',
  },
  {
    path: BNDZ_LARGE,
    icon: 'hard_drive_ui',
    accent: '#c48b4a',
    desc: 'Largest files — sorted and visualized by size',
  },
  {
    path: BNDZ_PROBLEMS,
    icon: 'warning',
    accent: '#f59e0b',
    desc: 'Broken links, naming conflicts, and integrity issues',
  },
  {
    path: BNDZ_INBOUND,
    icon: 'download_ui',
    accent: '#60a5fa',
    desc: 'Clipboard captures and inbound file staging',
  },
] as const;

const WORKSPACES = [
  {
    path: BNDZ_CANVAS,
    icon: 'view_grid',
    accent: '#c4a35a',
    title: 'Spatial Canvas',
    desc: 'Freeform 2D board — organize files from many folders without moving them on disk',
  },
  {
    path: BNDZ_AUTOMATION,
    icon: 'zap_ui',
    accent: '#fbbf24',
    title: 'Automation',
    desc: 'Visual pipelines for watch, filter, copy, and rsync deploy blocks',
  },
] as const;

export default function BndzHubView({ onNavigate, onRefresh, onOpenMeshDrop, onOpenGhostLink, onOpenRamStaging }: Props) {
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [pinCount, setPinCount] = useState(0);
  const [blockCount, setBlockCount] = useState(0);

  useEffect(() => {
    if (!IPC.isNative) return;
    let active = true;
    getIndexStatusCached().then(s => { if (active) setStatus(s); }).catch(() => {});
    void loadSpatialCanvas().then(d => { if (active) setPinCount(d.items.length); });
    void loadAutomationGraph().then(g => { if (active) setBlockCount(g.nodes.length); });
    return () => { active = false; };
  }, []);

  const indexed = (status?.fileCount ?? 0) > 0;

  const workspaceSection = (
    <>
      <div className="px-1 pt-1 pb-2 text-[10px] uppercase tracking-wider text-gray-500">Workspaces</div>
      <div className="space-y-2 mb-2">
        {WORKSPACES.map(v => (
          <WorkspaceLaunchCard
            key={v.path}
            title={v.title}
            desc={v.desc}
            icon={v.icon}
            accent={v.accent}
            badge={v.path === BNDZ_CANVAS
              ? (pinCount ? `${pinCount} pins` : 'Board')
              : (blockCount ? `${blockCount} blocks` : 'Pipeline')}
            badgeVariant="gold"
            features={v.path === BNDZ_CANVAS
              ? ['Pins', 'Snapshots', 'Relations']
              : ['Triggers', 'Filters', 'Actions']}
            onClick={() => onNavigate(v.path)}
          />
        ))}
      </div>
      {(onOpenMeshDrop || onOpenGhostLink || onOpenRamStaging) && (
        <div className="px-1 pt-3 pb-2">
          <div className="px-1 pb-2 text-[10px] uppercase tracking-wider text-gray-500">Power tools</div>
          <div className="space-y-2">
            {onOpenMeshDrop && (
              <WorkspaceLaunchCard
                title="Mesh Drop"
                desc="Zero-trust P2P file streaming — one-time pairing codes, no cloud middleman"
                icon="share"
                emblemId="share-check"
                accent="#5b9fd4"
                badge="P2P"
                badgeVariant="gold"
                features={['LAN beacon', 'Mesh codes', 'Web share']}
                onClick={onOpenMeshDrop}
              />
            )}
            {onOpenGhostLink && (
              <WorkspaceLaunchCard
                title="Ghost-Link"
                desc="Offload cold files to storage while keeping original paths via symlinks"
                icon="link"
                emblemId="emblem-symbolic-link"
                accent="#8fa8bc"
                badge="Symlink"
                badgeVariant="gold"
                features={['Cold vault', 'Reclaim space', 'Restore']}
                onClick={onOpenGhostLink}
              />
            )}
            {onOpenRamStaging && (
              <WorkspaceLaunchCard
                title="RAM Staging"
                desc="Stage projects in RAM or fast NVMe — browse zones at /bndz/ram, flush on eject"
                icon="hard_drive_ui"
                emblemId="emblem-mounted"
                accent="#c48b4a"
                badge="Staging"
                badgeVariant="gold"
                features={['ImDisk / Fast', 'Flush on eject', '/bndz/ram']}
                onClick={onOpenRamStaging}
              />
            )}
          </div>
        </div>
      )}
    </>
  );

  if (!indexed) {
    return (
      <div className="bndz-smart-hub flex flex-col h-full min-h-0">
        <div className="px-3 pt-3">{workspaceSection}</div>
        <BndzIndexEmptyState
          title="Smart Views"
          hint="Index Desktop, Documents, Downloads, Pictures, Music, and Videos to unlock Recent, Media, and Large file views."
          onIndexed={onRefresh}
        />
      </div>
    );
  }

  return (
    <div className="bndz-smart-hub flex flex-col h-full min-h-0">
      <header className="bndz-smart-hub-header shrink-0 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="bndz-smart-hub-mark" aria-hidden>
            <Icons8Icon id="sparkles_ui" size={16} />
          </div>
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-[#e8eaed] tracking-wide">Smart Views</h2>
            <p className="text-[11px] text-[#8b919a] mt-0.5">
              {(status?.fileCount ?? 0).toLocaleString()} files indexed
              {(status?.locations?.length ?? 0) > 0 ? ` · ${status!.locations!.length} location${status!.locations!.length === 1 ? '' : 's'}` : ''}
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto bndz-scrollbar px-3 pb-4 pt-1 space-y-1.5">
        {workspaceSection}
        <div className="px-1 pt-3 pb-2 text-[10px] uppercase tracking-wider text-gray-500">Indexed views</div>
        {VIEWS.map(v => {
          const viewKey = v.path.split('/').pop() as 'recent' | 'media' | 'audio' | 'documents' | 'large';
          return (
            <button
              key={v.path}
              type="button"
              onClick={() => onNavigate(v.path)}
              className="bndz-smart-hub-row group w-full flex items-center gap-3 text-left"
              style={{ ['--hub-accent' as string]: v.accent }}
            >
              <div className="bndz-smart-hub-row-icon shrink-0">
                <Icons8Icon id={v.icon} size={18} />
              </div>
              <div className="flex-1 min-w-0 py-0.5">
                <div className="text-[12.5px] font-medium text-[#e4e6ea] group-hover:text-white transition-colors">
                  {bndzVirtualLabel(viewKey)}
                </div>
                <div className="text-[10.5px] text-[#7a8088] truncate mt-0.5">{v.desc}</div>
              </div>
              <Icons8Icon
                id="chevron_right"
                size={14}
                className="text-[#555] group-hover:text-[#9aa0a8] shrink-0 transition-colors"
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
