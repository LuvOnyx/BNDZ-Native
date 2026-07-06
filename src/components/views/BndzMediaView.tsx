/**
 * BNDZ media grid — adapted from Spacedrive MediaView (photo/video grid + date headers).
 */
import React, { useMemo } from 'react';
import { ThumbnailIcon } from '../ThumbnailIcon';
import { FSEntity } from '../../types';

export type BndzMediaEntity = FSEntity & { path?: string; modified?: number };

import BndzIndexEmptyState from './BndzIndexEmptyState';

type Props = {
  items: BndzMediaEntity[];
  selectedIds: string[];
  buildPath: (entity: BndzMediaEntity) => string;
  onItemClick: (e: React.MouseEvent, entity: BndzMediaEntity) => void;
  onItemDoubleClick: (entity: BndzMediaEntity) => void;
  onContextMenu: (e: React.MouseEvent, entity: BndzMediaEntity) => void;
  onIndexBuilt?: () => void;
};

function dateLabel(ts?: number): string {
  if (!ts) return 'Unknown date';
  const d = new Date(ts * 1000);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diff = startOf(today).getTime() - startOf(d).getTime();
  if (diff === 0) return 'Today';
  if (diff === 86400000) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
}

function groupByDate(items: BndzMediaEntity[]) {
  const groups: Array<{ label: string; items: BndzMediaEntity[] }> = [];
  let current = '';
  for (const item of items) {
    const label = dateLabel(item.modified);
    if (label !== current) {
      current = label;
      groups.push({ label, items: [] });
    }
    groups[groups.length - 1].items.push(item);
  }
  return groups;
}

export default function BndzMediaView({
  items,
  selectedIds,
  buildPath,
  onItemClick,
  onItemDoubleClick,
  onContextMenu,
  onIndexBuilt,
}: Props) {
  const groups = useMemo(() => groupByDate(items), [items]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  if (!items.length) {
    return (
      <BndzIndexEmptyState
        title="No photos or videos in the index yet"
        hint="BNDZ indexes Desktop, Documents, Downloads, Pictures, Music, and Videos."
        onIndexed={onIndexBuilt}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 p-2">
      {groups.map(group => (
        <section key={group.label}>
          <div className="sticky top-0 z-10 px-1 py-2 text-[13px] font-semibold text-gray-200 bg-[#1e1e1e]/95 backdrop-blur-sm border-b border-white/[0.06]">
            {group.label}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(108px,1fr))] gap-0.5 mt-1">
            {group.items.map(entity => {
              const path = buildPath(entity);
              const isSelected = selected.has(entity.id);
              return (
                <div
                  key={entity.id}
                  data-id={entity.id}
                  className={`fs-item-wrapper relative aspect-square overflow-hidden cursor-default outline-none ${
                    isSelected ? 'ring-2 ring-sky-500 ring-inset' : ''
                  }`}
                  onClick={e => onItemClick(e, entity)}
                  onDoubleClick={() => onItemDoubleClick(entity)}
                  onContextMenu={e => onContextMenu(e, entity)}
                >
                  <ThumbnailIcon entity={entity} isDir={false} path={path} size={108} />
                  <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/75 to-transparent opacity-0 hover:opacity-100 transition-opacity pointer-events-none">
                    <span className="text-[10px] text-white truncate block">{entity.name}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
