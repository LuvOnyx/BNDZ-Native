/**
 * Spacedrive SearchToolbar port — scope chips for `> ` indexed search.
 * Source: spacedrive/packages/interface/src/routes/explorer/SearchToolbar.tsx
 */
import React from 'react';
import { Icons8Icon } from '../../components/Icons8Icon';

export type SearchScope = 'folder' | 'location' | 'library';
export type SearchKindFilter = 'all' | 'files' | 'folders' | 'media';

type Props = {
  scope: SearchScope;
  onScopeChange: (scope: SearchScope) => void;
  onClear?: () => void;
  showFilters?: boolean;
  kindFilter?: SearchKindFilter;
  onKindFilterChange?: (filter: SearchKindFilter) => void;
};

const SCOPES: Array<{ id: SearchScope; label: string }> = [
  { id: 'folder', label: 'This folder' },
  { id: 'location', label: 'Location' },
  { id: 'library', label: 'Library' },
];

const KIND_FILTERS: Array<{ id: SearchKindFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'files', label: 'Files' },
  { id: 'folders', label: 'Folders' },
  { id: 'media', label: 'Media' },
];

export function SearchToolbar({ scope, onScopeChange, onClear, showFilters, kindFilter = 'all', onKindFilterChange }: Props) {
  return (
    <div className="sd-search-toolbar flex items-center gap-2 px-2 py-1 border-b border-[#454545] bg-[#2a2a2a] shrink-0 flex-wrap">
      <span className="text-[10px] uppercase tracking-wide text-gray-500">Search in:</span>
      <div className="flex items-center gap-0.5">
        {SCOPES.map(s => (
          <button
            key={s.id}
            type="button"
            onClick={() => onScopeChange(s.id)}
            className={`px-2 py-0.5 text-[11px] rounded-sm transition-colors ${
              scope === s.id
                ? 'bg-[#094771] text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-[#3a3a3a]'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {showFilters && onKindFilterChange && (
        <div className="flex items-center gap-0.5 ml-2 border-l border-[#454545] pl-2">
          <Icons8Icon id="filter_ui" size={12} className="text-gray-500 mr-0.5" />
          {KIND_FILTERS.map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => onKindFilterChange(f.id)}
              className={`px-2 py-0.5 text-[11px] rounded-sm transition-colors ${
                kindFilter === f.id
                  ? 'bg-[#094771] text-white'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-[#3a3a3a]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="ml-auto flex items-center gap-1 px-2 py-0.5 text-[11px] text-gray-400 hover:text-red-300"
        >
          <Icons8Icon id="close" size={12} />
          Clear search
        </button>
      )}
    </div>
  );
}

export default SearchToolbar;
