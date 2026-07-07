import React, { useEffect, useMemo } from 'react';
import { LauncherIcon } from './LauncherIcon';
import { ThumbnailIcon } from './ThumbnailIcon';
import { joinPanePath, normalizePanePath } from '../lib/pathUtils';
import { getDisplayName } from '../lib/settingsRuntime';

type Entity = Record<string, unknown>;

type Props = {
  rootPath: string;
  selectedPath: string;
  pathContentsCache: Record<string, Entity[]>;
  config: Record<string, unknown>;
  onNavigate: (path: string) => void;
  onOpen: (entity: Entity, columnPath: string) => void;
  onPrefetchPath?: (path: string) => void;
};

function splitPathSegments(panePath: string): string[] {
  const norm = normalizePanePath(panePath);
  if (!norm || norm === '/') return [];
  const parts = norm.split('/').filter(Boolean);
  const segs: string[] = [];
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : `/${part}`;
    segs.push(acc);
  }
  return segs;
}

/** File Pilot / macOS Miller columns navigation. */
export default function MillerColumnsView({
  rootPath,
  selectedPath,
  pathContentsCache,
  config,
  onNavigate,
  onOpen,
  onPrefetchPath,
}: Props) {
  const columnPaths = useMemo(() => {
    const normRoot = normalizePanePath(rootPath);
    const normSelected = normalizePanePath(selectedPath);
    const base = normRoot === '/' ? [] : [normRoot];
    const tail = splitPathSegments(normSelected).filter(p => !base.includes(p));
    const all = [...base, ...tail];
    if (!all.length && normSelected !== '/') all.push('/');
    return all.length ? all : ['/'];
  }, [rootPath, selectedPath]);

  useEffect(() => {
    if (!onPrefetchPath) return;
    for (const colPath of columnPaths) {
      if (pathContentsCache[colPath] === undefined) onPrefetchPath(colPath);
    }
    const last = columnPaths[columnPaths.length - 1];
    const lastItems = pathContentsCache[last] || [];
    const selected = normalizePanePath(selectedPath);
    const active = lastItems.find((entity) => {
      const childPath = normalizePanePath(joinPanePath(last, entity as { name: string; path?: string }));
      return selected === childPath || selected.startsWith(`${childPath}/`);
    });
    if (active && active.type === 'directory') {
      const childPath = normalizePanePath(joinPanePath(last, active as { name: string; path?: string }));
      if (pathContentsCache[childPath] === undefined) onPrefetchPath(childPath);
    }
  }, [columnPaths, onPrefetchPath, pathContentsCache, selectedPath]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        className="shrink-0 flex items-center gap-0.5 px-2 py-1.5 border-b border-white/[0.06] overflow-x-auto bndz-scrollbar text-[11px]"
        style={{ background: 'var(--bndz-surface-chrome, #12141a)' }}
      >
        <LauncherIcon id="view_columns" size={12} className="opacity-60 mr-1" />
        {columnPaths.map((seg, i) => {
          const label = seg === '/' ? 'This PC' : (seg.split('/').pop() || seg);
          return (
            <React.Fragment key={seg}>
              {i > 0 && <LauncherIcon id="chevron_right" size={10} className="shrink-0 opacity-50" />}
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
          const items = pathContentsCache[colPath];
          const loading = items === undefined;
          const colLabel = colPath === '/' ? 'This PC' : colPath.split('/').pop();
          return (
            <div
              key={colPath}
              className="shrink-0 w-[220px] border-r border-white/[0.06] flex flex-col min-h-0 bndz-gpu-layer"
            >
              <div className="shrink-0 px-2 py-1 text-[10px] uppercase tracking-wider text-gray-500 border-b border-white/[0.04] truncate">
                {colLabel}
              </div>
              <div className="flex-1 overflow-y-auto bndz-scrollbar">
                {loading ? (
                  <div className="px-2 py-4 text-[11px] text-gray-500 text-center">Loading…</div>
                ) : items.map(entity => {
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
                      {isDir && <LauncherIcon id="chevron_right" size={12} className="shrink-0 opacity-50" />}
                    </button>
                  );
                })}
                {!loading && !items.length && (
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
