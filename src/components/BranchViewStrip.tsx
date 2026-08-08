import React, { useMemo } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { ShellNativeIcon } from './ShellNativeIcon';
import { joinPanePath, normalizePanePath } from '../lib/pathUtils';
import { getDisplayName, entitySortName } from '../lib/settingsRuntime';
import { protectDirectionalFormatting } from '../lib/bidiProtection';

type Entity = {
  id: string;
  name: string;
  type?: string;
  path?: string;
};

type Props = {
  panePath: string;
  contents: Entity[];
  config: Record<string, unknown>;
  branchType?: string;
  onNavigate: (path: string) => void;
};

/** Ancestor folder chips when Settings → Multi branch view lists top folders. */
function topFolderChips(panePath: string): Array<{ path: string; label: string }> {
  const norm = normalizePanePath(panePath).replace(/\\/g, '/').replace(/\/+$/, '');
  if (!norm || norm === '/' || /^\/[A-Za-z]:$/.test(norm)) return [];
  const parts = norm.split('/').filter(Boolean);
  if (parts.length <= 1) return [];
  const chips: Array<{ path: string; label: string }> = [];
  let acc = '';
  for (let i = 0; i < parts.length - 1; i++) {
    acc = acc ? `${acc}/${parts[i]}` : `/${parts[i]}`;
    chips.push({ path: acc, label: parts[i] });
  }
  return chips;
}

/** XYplorer branch view — horizontal sibling folders for quick lateral navigation. */
export default function BranchViewStrip({ panePath, contents, config, branchType, onNavigate }: Props) {
  const folders = useMemo(() => {
    let dirs = contents.filter(c => c.type === 'directory');
    const mode = branchType || 'Files and folders';
    if (mode === 'Files only') return [];
    return dirs.sort((a, b) => entitySortName(a).localeCompare(entitySortName(b), undefined, { sensitivity: 'base' }));
  }, [contents, config, panePath, branchType]);

  // Settings → Multi branch view lists top folders
  const topFolders = useMemo(
    () => (config.multiBranchViewListsTopFolders ? topFolderChips(panePath) : []),
    [config.multiBranchViewListsTopFolders, panePath],
  );

  if (!folders.length && !topFolders.length) return null;

  return (
    <div className="shrink-0 border-b border-white/[0.06] backdrop-blur-sm bndz-gpu-layer" style={{ background: 'var(--bndz-surface-chrome)' }}>
      <div className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-gray-500">Branch</div>
      <div className="flex gap-1 px-2 pb-2 overflow-x-auto bndz-scrollbar">
        {topFolders.map(folder => (
          <button
            key={`top-${folder.path}`}
            type="button"
            onClick={() => onNavigate(folder.path)}
            onDoubleClick={() => onNavigate(folder.path)}
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] text-amber-100/90 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 transition-colors"
            title={folder.path}
          >
            <ShellNativeIcon path={folder.path} isDir size={14} />
            <span className="truncate max-w-[140px]">{protectDirectionalFormatting(folder.label, config as any)}</span>
            <Icons8Icon id="chevron_right" size={10} className="opacity-50 shrink-0 -rotate-90" />
          </button>
        ))}
        {folders.map(folder => {
          const childPath = joinPanePath(panePath, folder);
          const label = protectDirectionalFormatting(
            getDisplayName(folder, config as any, panePath),
            config as any,
          );
          return (
            <button
              key={folder.id}
              type="button"
              onClick={() => onNavigate(childPath)}
              onDoubleClick={() => onNavigate(childPath)}
              className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] text-gray-300 bg-white/[0.04] hover:bg-[#0078d4]/15 hover:text-[#cce4f7] border border-white/[0.06] transition-colors"
              title={childPath}
            >
              <ShellNativeIcon path={childPath} isDir size={14} />
              <span className="truncate max-w-[140px]">{label}</span>
              <Icons8Icon id="chevron_right" size={10} className="opacity-50 shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
