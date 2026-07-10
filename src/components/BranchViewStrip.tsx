import React, { useMemo } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { ShellNativeIcon } from './ShellNativeIcon';
import { joinPanePath } from '../lib/pathUtils';
import { getDisplayName, entitySortName } from '../lib/settingsRuntime';

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

/** XYplorer branch view — horizontal sibling folders for quick lateral navigation. */
export default function BranchViewStrip({ panePath, contents, config, branchType, onNavigate }: Props) {
  const folders = useMemo(() => {
    let dirs = contents.filter(c => c.type === 'directory');
    const mode = branchType || 'Files and folders';
    if (mode === 'Files only') return [];
    if (mode === 'Folders only') {
      // all folders already
    }
    return dirs.sort((a, b) => entitySortName(a).localeCompare(entitySortName(b), undefined, { sensitivity: 'base' }));
  }, [contents, config, panePath, branchType]);

  if (!folders.length) return null;

  return (
    <div className="shrink-0 border-b border-white/[0.06] backdrop-blur-sm bndz-gpu-layer" style={{ background: 'var(--bndz-surface-chrome)' }}>
      <div className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-gray-500">Branch</div>
      <div className="flex gap-1 px-2 pb-2 overflow-x-auto bndz-scrollbar">
        {folders.map(folder => {
          const childPath = joinPanePath(panePath, folder);
          const label = getDisplayName(folder, config as any, panePath);
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
