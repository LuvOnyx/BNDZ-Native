import React, { useEffect, useState } from 'react';
import { Clock, Film, HardDrive, ChevronRight, Database } from 'lucide-react';
import { BNDZ_LARGE, BNDZ_MEDIA, BNDZ_RECENT, bndzVirtualLabel } from '../../lib/bndzVirtualViews';
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
  { path: BNDZ_RECENT, icon: Clock, color: 'text-amber-400', desc: 'Recently modified files from your indexed libraries' },
  { path: BNDZ_MEDIA, icon: Film, color: 'text-sky-400', desc: 'Photos and videos across indexed folders' },
  { path: BNDZ_LARGE, icon: HardDrive, color: 'text-violet-400', desc: 'Largest files — sorted and visualized by size' },
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

  if (!indexed) {
    return (
      <BndzIndexEmptyState
        title="BNDZ Smart Views"
        hint="Index your Desktop, Documents, Downloads, Pictures, Music, and Videos to unlock Recent, Media, and Large file views."
        onIndexed={onRefresh}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 max-w-2xl">
      <div className="flex items-center gap-2 text-gray-300">
        <Database size={18} className="text-sky-400" />
        <div>
          <h2 className="text-[14px] font-semibold text-gray-100">Smart Views</h2>
          <p className="text-[11px] text-gray-500">
            {(status?.fileCount ?? 0).toLocaleString()} files indexed
            {(status?.locations?.length ?? 0) > 0 ? ` · ${status!.locations!.length} location(s)` : ''}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {VIEWS.map(v => {
          const viewKey = v.path.split('/').pop() as 'recent' | 'media' | 'large';
          const Icon = v.icon;
          return (
            <button
              key={v.path}
              type="button"
              onClick={() => onNavigate(v.path)}
              className="flex items-center gap-3 p-3 text-left bg-[#252525] hover:bg-[#2e2e2e] border border-[#3a3a3a] group"
            >
              <div className={`w-10 h-10 flex items-center justify-center bg-[#1a1a1a] border border-[#333] shrink-0 ${v.color}`}>
                <Icon size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-gray-100">{bndzVirtualLabel(viewKey)}</div>
                <div className="text-[11px] text-gray-500 truncate">{v.desc}</div>
              </div>
              <ChevronRight size={16} className="text-gray-600 group-hover:text-gray-400 shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
