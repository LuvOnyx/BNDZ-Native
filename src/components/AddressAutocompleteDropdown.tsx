import React from 'react';
import { Icons8Icon } from './Icons8Icon';
import type { PathSuggestion } from '../lib/addressAutocomplete';
import type { OmnibarCommandSuggestion } from '../lib/omnibarCommands';
import { formatUiPath } from '../lib/displayPath';

export type OmniSuggestItem =
  | (PathSuggestion & { kind?: 'path' })
  | OmnibarCommandSuggestion;

type Props = {
  suggestions: OmniSuggestItem[];
  selectedIndex: number;
  onSelect: (item: OmniSuggestItem) => void;
  onHover: (index: number) => void;
};

/** Address / omnibar autocomplete -- paths + `>` commands */
export default function AddressAutocompleteDropdown({ suggestions, selectedIndex, onSelect, onHover }: Props) {
  if (!suggestions.length) return null;

  return (
    <div className="bndz-omni-suggest absolute left-0 right-0 top-full z-50 mt-0.5 max-h-[280px] overflow-y-auto bndz-scrollbar">
      {suggestions.map((s, i) => {
        const isCmd = s.kind === 'command';
        const label = isCmd ? s.label : s.label;
        const sub = isCmd ? s.hint : formatUiPath(s.path);
        const icon = isCmd
          ? (s.icon || 'command')
          : s.source === 'favorite' ? 'zap_ui' : s.source === 'path' ? 'folder_open_ui' : 'clock_ui';
        return (
          <button
            key={isCmd ? `cmd:${s.id}` : s.path}
            type="button"
            className={`bndz-omni-suggest-row ${i === selectedIndex ? 'is-active' : ''}`}
            onMouseEnter={() => onHover(i)}
            onMouseDown={e => { e.preventDefault(); onSelect(s); }}
          >
            <Icons8Icon id={icon} size={11} className="shrink-0 opacity-80" />
            <span className="font-medium truncate">{label}</span>
            <span className="text-white/35 truncate ml-auto font-mono text-[10px]">{sub}</span>
            {isCmd && <span className="bndz-omni-suggest-badge">Cmd</span>}
          </button>
        );
      })}
    </div>
  );
}
