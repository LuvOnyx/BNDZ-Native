import React, { useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { BNDZ_AUDIO, BNDZ_AUTOMATION, BNDZ_CANVAS, BNDZ_DOCUMENTS, BNDZ_LARGE, BNDZ_MEDIA, BNDZ_RECENT, bndzVirtualLabel } from '../../lib/bndzVirtualViews';
import { IPC } from '../../lib/ipcBridge';
import BndzIndexEmptyState from './BndzIndexEmptyState';

type IndexStatus = {
  fileCount?: number;
  folderCount?: number;
  locations?: Array<{ path: string; lastIndexed: number }>;
};

type Props = {
  onNavigate: (path: string) => void;
  onRefresh?: () => void;
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
    accent: '#a78bfa',
    desc: 'Largest files — sorted and visualized by size',
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

export default function BndzHubView({ onNavigate, onRefresh }: Props) {
  const [status, setStatus] = useState<IndexStatus | null>(null);

  useEffect(() => {
    if (!IPC.isNative) return;
    let active = true;
    IPC.getIndexStatus().then(s => { if (active) setStatus(s); }).catch(() => {});
    return () => { active = false; };
  }, []);

  const indexed = (status?.fileCount ?? 0) > 0;

  const workspaceSection = (
    <>
      <div className="px-1 pt-1 pb-2 text-[10px] uppercase tracking-wider text-gray-500">Workspaces</div>
      {WORKSPACES.map(v => (
        <button
          key={v.path}
          type="button"
          onClick={() => onNavigate(v.path)}
          className="bndz-smart-hub-row group w-full flex items-center gap-3 text-left"
          style={{ ['--hub-accent' as string]: v.accent }}
        >
          <span className="bndz-smart-hub-icon" aria-hidden><Icons8Icon id={v.icon} size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-medium text-[#e8eaed] group-hover:text-white">{v.title}</span>
            <span className="block text-[10px] text-[#8b919a] mt-0.5 leading-snug">{v.desc}</span>
          </span>
          <Icons8Icon id="chevron_right" size={14} className="opacity-40 group-hover:opacity-80 shrink-0" />
        </button>
      ))}
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
