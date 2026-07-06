/**
 * BNDZ recents list — adapted from Spacedrive RecentsView (date-grouped recent files).
 */
import React, { useMemo } from 'react';
import { ThumbnailIcon } from '../ThumbnailIcon';
import { formatFsDate } from '../../lib/pathUtils';
import { FSEntity } from '../../types';

export type BndzRecentEntity = FSEntity & { path?: string; modified?: number; size?: number };

import BndzIndexEmptyState from './BndzIndexEmptyState';

type Props = {
  items: BndzRecentEntity[];
  selectedIds: string[];
  buildPath: (entity: BndzRecentEntity) => string;
  onItemClick: (e: React.MouseEvent, entity: BndzRecentEntity) => void;
  onItemDoubleClick: (entity: BndzRecentEntity) => void;
  onContextMenu: (e: React.MouseEvent, entity: BndzRecentEntity) => void;
  onIndexBuilt?: () => void;
};

function sectionLabel(ts?: number): string {
  if (!ts) return 'Earlier';
  const d = new Date(ts * 1000);
  const today = new Date();
  const sod = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = sod(today) - sod(d);
  if (diff === 0) return 'Today';
  if (diff === 86400000) return 'Yesterday';
  if (diff < 7 * 86400000) return 'This week';
  return 'Earlier';
}

function formatSize(n?: number) {
  if (!n) return '';
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function groupRecents(items: BndzRecentEntity[]) {
  const groups: Array<{ label: string; items: BndzRecentEntity[] }> = [];
  let current = '';
  for (const item of items) {
    const label = sectionLabel(item.modified);
    if (label !== current) {
      current = label;
      groups.push({ label, items: [] });
    }
    groups[groups.length - 1].items.push(item);
  }
  return groups;
}

export default function BndzRecentsView({
  items,
  selectedIds,
  buildPath,
  onItemClick,
  onItemDoubleClick,
  onContextMenu,
  onIndexBuilt,
}: Props) {
  const groups = useMemo(() => groupRecents(items), [items]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  if (!items.length) {
    return (
      <BndzIndexEmptyState
        title="No recent files in the index yet"
        onIndexed={onIndexBuilt}
      />
    );
  }

  return (
    <div className="flex flex-col w-full">
      {groups.map(group => (
        <section key={group.label}>
          <div className="sticky top-0 z-10 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-sky-300/90 bg-[#1a1a1f]/95 border-y border-white/[0.06]">
            {group.label}
          </div>
          {group.items.map(entity => {
            const path = buildPath(entity);
            const isSelected = selected.has(entity.id);
            const isDir = entity.type === 'directory';
            return (
              <div
                key={entity.id}
                data-id={entity.id}
                className={`fs-item-wrapper fs-list-item flex items-center gap-2 text-[12px] py-1 px-2 cursor-default border border-transparent ${
                  isSelected ? 'bg-[#094771]/40 border-[#094771]/50' : 'hover:bg-[#333]/60'
                }`}
                onClick={e => onItemClick(e, entity)}
                onDoubleClick={() => onItemDoubleClick(entity)}
                onContextMenu={e => onContextMenu(e, entity)}
              >
                <ThumbnailIcon entity={entity} isDir={isDir} path={path} size={16} />
                <span className="flex-1 truncate text-gray-100">{entity.name}</span>
                {!isDir && entity.size != null && (
                  <span className="text-[10px] text-gray-500 tabular-nums shrink-0">{formatSize(entity.size)}</span>
                )}
                {entity.modified != null && (
                  <span className="text-[10px] text-gray-600 shrink-0 hidden sm:inline">
                    {formatFsDate(new Date(entity.modified * 1000).toISOString())}
                  </span>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
