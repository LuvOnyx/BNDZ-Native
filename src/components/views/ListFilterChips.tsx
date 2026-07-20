import React from 'react';
import { entityHasTag } from '../../lib/tagUtils';
import { isImageExt, isVideoExt } from '../../lib/mediaTypes';

export type ListKindFilter = 'all' | 'folders' | 'images' | 'videos' | 'documents' | 'large';

const LARGE_BYTES = 50 * 1024 * 1024;
const DOC_EXT = /\.(docx?|pdf|txt|rtf|odt|xlsx?|pptx?|csv|md)$/i;

const CHIPS: Array<{ id: ListKindFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'folders', label: 'Folders' },
  { id: 'images', label: 'Images' },
  { id: 'videos', label: 'Videos' },
  { id: 'documents', label: 'Docs' },
  { id: 'large', label: 'Large' },
];

type Props = {
  value: ListKindFilter;
  onChange: (v: ListKindFilter) => void;
};

/** Secondary kind filters — macOS-style slight radius, not pills. */
export default function ListFilterChips({ value, onChange }: Props) {
  return (
    <div className="bndz-list-filter-bar flex items-center gap-1.5 px-2 py-1.5 border-b border-white/[0.06] bg-black/20 shrink-0 flex-wrap">
      <div className="flex items-center gap-1 mr-1">
        {CHIPS.map(c => (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(c.id)}
            className={`bndz-list-filter-chip ${value === c.id ? 'bndz-list-filter-chip--active' : ''}`}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function matchesListKindFilter(item: { type?: string; name?: string; size?: number; extension?: string }, filter: ListKindFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'folders') return item.type === 'directory';
  const ext = (item.extension || item.name?.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
  if (filter === 'images') return item.type !== 'directory' && isImageExt(ext);
  if (filter === 'videos') return item.type !== 'directory' && isVideoExt(ext);
  if (filter === 'documents') return item.type !== 'directory' && DOC_EXT.test(item.name || '');
  if (filter === 'large') return (item.size || 0) >= LARGE_BYTES;
  return true;
}

export function matchesTagFilter(item: { tags?: string[] }, tagId: string | null): boolean {
  if (!tagId) return true;
  return entityHasTag(item.tags, tagId);
}
