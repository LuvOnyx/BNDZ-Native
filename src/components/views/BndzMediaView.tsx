/**
 * BNDZ media grid — virtualized photo/video grid with date sections.
 */
import React, { useMemo } from 'react';
import { ThumbnailIcon } from '../ThumbnailIcon';
import { FSEntity } from '../../types';
import { VirtualizedFileList } from '../VirtualizedFileList';
import BndzIndexEmptyState from './BndzIndexEmptyState';
import { useAppConfig } from '../../data/configContext';
import { weekdayHeadersShort } from '../../lib/weekCalendarSettings';

export type BndzMediaEntity = FSEntity & { path?: string; modified?: number | string };

type Props = {
  items: BndzMediaEntity[];
  fetchError?: string;
  selectedIds: string[];
  buildPath: (entity: BndzMediaEntity) => string;
  onItemClick: (e: React.MouseEvent, entity: BndzMediaEntity) => void;
  onItemDoubleClick: (entity: BndzMediaEntity) => void;
  onContextMenu: (e: React.MouseEvent, entity: BndzMediaEntity) => void;
  onIndexBuilt?: () => void;
};

function dateLabel(ts?: number | string): string {
  if (ts == null || ts === '') return 'Unknown date';
  let d: Date;
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    d = new Date(ts < 1e12 ? ts * 1000 : ts);
  } else if (typeof ts === 'string' && /^\d+$/.test(ts.trim())) {
    const n = Number(ts);
    d = new Date(n < 1e12 ? n * 1000 : n);
  } else {
    d = new Date(ts);
  }
  if (Number.isNaN(d.getTime())) return 'Unknown date';
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

function MediaTile({
  entity,
  path,
  isSelected,
  dateHint,
  onItemClick,
  onItemDoubleClick,
  onContextMenu,
}: {
  entity: BndzMediaEntity;
  path: string;
  isSelected: boolean;
  dateHint?: string;
  onItemClick: (e: React.MouseEvent, entity: BndzMediaEntity) => void;
  onItemDoubleClick: (entity: BndzMediaEntity) => void;
  onContextMenu: (e: React.MouseEvent, entity: BndzMediaEntity) => void;
}) {
  return (
    <div
      data-id={entity.id}
      className={`fs-item-wrapper relative aspect-square overflow-hidden cursor-default outline-none ${
        isSelected ? 'ring-2 ring-[#0078d4] ring-inset' : ''
      }`}
      onClick={e => onItemClick(e, entity)}
      onDoubleClick={() => onItemDoubleClick(entity)}
      onContextMenu={e => onContextMenu(e, entity)}
    >
      {/* size drives native extract px — keep under 72 so we stay in medium band (≤256), not jumbo 384+. */}
      <ThumbnailIcon entity={entity} isDir={false} path={path} size={64} />
      <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/75 to-transparent opacity-0 hover:opacity-100 transition-opacity pointer-events-none">
        <span className="text-[10px] text-white truncate block">{entity.name}</span>
        {dateHint && <span className="text-[9px] text-white/70 truncate block">{dateHint}</span>}
      </div>
    </div>
  );
}

export default function BndzMediaView({
  items,
  fetchError,
  selectedIds,
  buildPath,
  onItemClick,
  onItemDoubleClick,
  onContextMenu,
  onIndexBuilt,
}: Props) {
  const { config } = useAppConfig();
  // Settings → Sunday is the first day of the week
  const weekHeaders = weekdayHeadersShort({ sundayIsTheFirstDayOfTheWeek: config.sundayIsTheFirstDayOfTheWeek });
  const groups = useMemo(() => groupByDate(items), [items]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const useVirtualGrid = items.length >= 80;

  if (fetchError) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[220px] text-gray-500 gap-2 px-6 text-center">
        <span className="text-[13px] text-red-300/90">{fetchError}</span>
        <span className="text-[10px] text-gray-600">Check that the search index is built and try refreshing.</span>
      </div>
    );
  }

  if (!items.length) {
    return (
      <BndzIndexEmptyState
        title="No photos or videos in the index yet"
        hint="BNDZ indexes Desktop, Documents, Downloads, Pictures, Music, and Videos."
        onIndexed={onIndexBuilt}
      />
    );
  }

  const weekStrip = (
    <div
      className="grid grid-cols-7 gap-0.5 px-2 py-1 mb-1 text-[9px] uppercase tracking-wider text-white/35"
      aria-hidden
      title={config.sundayIsTheFirstDayOfTheWeek ? 'Week starts Sunday' : 'Week starts Monday'}
    >
      {weekHeaders.map(d => (
        <span key={d} className="text-center">{d}</span>
      ))}
    </div>
  );

  if (useVirtualGrid) {
    return (
      <div className="p-2">
        {weekStrip}
        <VirtualizedFileList
          items={items}
          threshold={1}
          mode="grid"
          gridMinItemWidth={108}
          gridRowHeight={108}
          className="w-full"
          renderItem={(entity) => (
            <MediaTile
              entity={entity}
              path={buildPath(entity)}
              isSelected={selected.has(entity.id)}
              dateHint={dateLabel(entity.modified)}
              onItemClick={onItemClick}
              onItemDoubleClick={onItemDoubleClick}
              onContextMenu={onContextMenu}
            />
          )}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-2">
      {weekStrip}
      {groups.map(group => (
        <section key={group.label}>
          <div className="sticky top-0 z-10 px-2 py-1.5 text-[11px] font-semibold tracking-wide text-[#c5cdd6] bndz-smart-section-header">
            {group.label}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(108px,1fr))] gap-0.5 mt-1">
            {group.items.map(entity => (
              <MediaTile
                key={entity.id}
                entity={entity}
                path={buildPath(entity)}
                isSelected={selected.has(entity.id)}
                onItemClick={onItemClick}
                onItemDoubleClick={onItemDoubleClick}
                onContextMenu={onContextMenu}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
