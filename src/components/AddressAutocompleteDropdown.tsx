import React from 'react';
import { Icons8Icon } from './Icons8Icon';
import type { PathSuggestion } from '../lib/addressAutocomplete';

type Props = {
  suggestions: PathSuggestion[];
  selectedIndex: number;
  onSelect: (path: string) => void;
  onHover: (index: number) => void;
};

/** FilePilot / XYplorer GoTo address autocomplete dropdown */
export default function AddressAutocompleteDropdown({ suggestions, selectedIndex, onSelect, onHover }: Props) {
  if (!suggestions.length) return null;

  return (
    <div className="absolute left-0 right-0 top-full z-50 mt-0.5 bg-[#1a1a1a] border border-[#444] rounded shadow-2xl max-h-[240px] overflow-y-auto bndz-scrollbar">
      {suggestions.map((s, i) => (
        <button
          key={s.path}
          type="button"
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] ${
            i === selectedIndex ? 'bg-sky-900/50 text-sky-100' : 'text-gray-300 hover:bg-[#252525]'
          }`}
          onMouseEnter={() => onHover(i)}
          onMouseDown={e => { e.preventDefault(); onSelect(s.path); }}
        >
          <Icons8Icon
            id={s.source === 'favorite' ? 'star_ui' : s.source === 'path' ? 'folder_open_ui' : 'clock_ui'}
            size={11}
            className="shrink-0"
          />
          <span className="font-medium truncate">{s.label}</span>
          <span className="text-gray-500 truncate ml-auto font-mono text-[10px]">{s.path}</span>
        </button>
      ))}
    </div>
  );
}
