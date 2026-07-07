import React, { useMemo } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { ThumbnailIcon } from './ThumbnailIcon';
import { joinPanePath } from '../lib/pathUtils';
import { getDisplayName } from '../lib/settingsRuntime';

type Entity = Record<string, unknown>;

type Props = {
  rootPath: string;
  selectedPath: string;
  pathContentsCache: Record<string, Entity[]>;
  config: Record<string, unknown>;
  onNavigate: (path: string) => void;
  onOpen: (entity: Entity, columnPath: string) => void;
};

function splitPathSegments(panePath: string): string[] {
  if (!panePath || panePath === '/') return [];
  const norm = panePath.replace(/\\/g, '/');
  const parts = norm.split('/').filter(Boolean);
  const segs: string[] = [];
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : `/${part}`;
    segs.push(acc);
  }
  return segs;
}

/** File Pilot Miller / macOS columns navigation. */
export default function MillerColumnsView({
  rootPath,
  selectedPath,
  pathContentsCache,
  config,
  onNavigate,
  onOpen,
}: Props) {
  const columnPaths = useMemo(() => {
    const base = rootPath === '/' ? [] : [rootPath];
    const tail = splitPathSegments(selectedPath).filter(p => !base.includes(p));
    const all = [...base, ...tail];
    if (!all.length && selectedPath !== '/') all.push('/');
    return all.length ? all : ['/'];
  }, [rootPath, selectedPath]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        className="shrink-0 flex items-center gap-0.5 px-2 py-1.5 border-b border-white/[0.06] overflow-x-auto bndz-scrollbar text-[11px]"
        style={{ background: 'var(--bndz-surface-chrome, #12141a)' }}
      >
        {columnPaths.map((seg, i) => {
          const label = seg === '/' ? 'This PC' : (seg.split('/').pop() || seg);
          return (
            <React.Fragment key={seg}>
              {i > 0 && <Icons8Icon id="chevron_right" size={10} className="shrink-0 opacity-50" />}
              <button
                type="button"
                className={`shrink-0 px-1.5 py-0.5 rounded hover:bg-white/[0.06] truncate max-w-[140px] ${
                  i === columnPaths.length - 1 ? 'text-sky-300 font-medium' : 'text-gray-400'
                }`}
                onClick={() => onNavigate(seg)}
              >
                {label}
              </button>
            </React.Fragment>
          );
        })}
      </div>
    <div className="flex flex-1 min-h-0 overflow-x-auto bndz-scrollbar bndz-file-list-scroll bndz-gpu-layer">
      {columnPaths.map((colPath) => {
        const items = pathContentsCache[colPath] || [];
        return (
          <div
            key={colPath}
            className="shrink-0 w-[220px] border-r border-white/[0.06] flex flex-col min-h-0 bndz-gpu-layer"
          >
            <div className="shrink-0 px-2 py-1 text-[10px] uppercase tracking-wider text-gray-500 border-b border-white/[0.04] truncate">
              {colPath === '/' ? 'This PC' : colPath.split('/').pop()}
            </div>
            <div className="flex-1 overflow-y-auto bndz-scrollbar">
              {items.map(entity => {
                const isDir = entity.type === 'directory';
                const childPath = joinPanePath(colPath, entity as { name: string; path?: string });
                const isSelected = selectedPath === childPath || selectedPath.startsWith(`${childPath}/`);
                const displayName = getDisplayName(entity, config as any, colPath);
                return (
                  <button
                    key={String(entity.id)}
                    type="button"
                    className={`w-full flex items-center gap-2 px-2 py-1.5 text-left text-[12px] hover:bg-white/[0.06] ${
                      isSelected ? 'bg-sky-500/15 text-sky-200' : 'text-gray-300'
                    }`}
                    onClick={() => {
                      if (isDir) onNavigate(childPath);
                      else onOpen(entity, colPath);
                    }}
                    onDoubleClick={() => {
                      if (isDir) onNavigate(childPath);
                      else onOpen(entity, colPath);
                    }}
                  >
                    <ThumbnailIcon entity={entity} isDir={isDir} path={childPath} size={16} />
                    <span className="flex-1 truncate">{displayName}</span>
                    {isDir && <Icons8Icon id="chevron_right" size={12} className="shrink-0 opacity-50" />}
                  </button>
                );
              })}
              {!items.length && (
                <div className="px-2 py-4 text-[11px] text-gray-600 text-center">Empty</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
    </div>
  );
}
