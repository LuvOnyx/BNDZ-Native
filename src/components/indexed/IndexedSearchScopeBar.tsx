import React from 'react';

export type IndexedSearchScope = 'folder' | 'library';

type Props = {
  scope: IndexedSearchScope;
  onScopeChange: (scope: IndexedSearchScope) => void;
};

const SCOPES: Array<{ id: IndexedSearchScope; label: string }> = [
  { id: 'library', label: 'Library' },
  { id: 'folder', label: 'This folder' },
];

/** Scope strip for `> ` global search — adapted from Spacedrive SearchToolbar patterns, BNDZ-native. */
export default function IndexedSearchScopeBar({ scope, onScopeChange }: Props) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-[#454545] bg-[#2a2a2a] shrink-0">
      <span className="text-[10px] uppercase tracking-wide text-gray-500 mr-1">Search scope</span>
      {SCOPES.map(s => (
        <button
          key={s.id}
          type="button"
          onClick={() => onScopeChange(s.id)}
          className={`px-2 py-0.5 text-[11px] border ${
            scope === s.id
              ? 'bg-[#094771] border-[#094771] text-white'
              : 'bg-[#333] border-[#454545] text-gray-400 hover:text-gray-200 hover:bg-[#3a3a3a]'
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
