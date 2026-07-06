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

export default function ListFilterChips({ value, onChange }: Props) {
  return (
    <div className="bndz-list-filter-bar flex items-center gap-1.5 px-2 py-1 border-b border-[#333] bg-[#252525] shrink-0 flex-wrap">
      <div className="flex items-center gap-0.5 mr-1">
        {CHIPS.map(c => (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(c.id)}
            className={`px-2 py-0.5 text-[11px] rounded-sm ${
              value === c.id
                ? 'bg-[#094771] text-white'
                : 'text-gray-500 hover:text-gray-200 hover:bg-[#333]'
            }`}
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
