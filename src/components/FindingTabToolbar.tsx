import React, { useEffect, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import type { TabState } from './tabTypes';
import type { AppConfig } from '../data/configContext';
import type { IndexedSearchScope } from '../lib/globalSearchCall';
import { isPathUnderIndexedRoot } from '../lib/indexedRoots';

type Props = {
  tab: TabState;
  config: AppConfig;
  loading?: boolean;
  indexedRoots?: string[];
  onChange: (patch: Partial<TabState>) => void;
  onRefresh: () => void;
};

export default function FindingTabToolbar({ tab, config, loading, indexedRoots, onChange, onRefresh }: Props) {
  const scope = (tab.findingScope || 'library') as IndexedSearchScope;
  const useRegex = tab.findingUseRegex ?? config.enableExtendedPatternMatching === true;
  const searchContent = tab.findingSearchContent ?? config.searchFileContent === true;
  const booleanMode = tab.findingBooleanMode ?? config.enableSmartBooleanQueryParsing === true;
  const [draftQuery, setDraftQuery] = useState(tab.findingQuery || '');

  useEffect(() => {
    setDraftQuery(tab.findingQuery || '');
  }, [tab.findingQuery]);

  const commitQuery = () => {
    const q = draftQuery.trim();
    if (q && q !== tab.findingQuery) onChange({ findingQuery: q });
    else if (!q) setDraftQuery(tab.findingQuery || '');
  };

  const toggleClass = (on: boolean) =>
    `bndz-hub-chip inline-flex items-center gap-1 px-2 py-0.5 text-[10px] ${
      on ? 'bndz-hub-chip--active' : ''
    }`;

  const rootIndexed = isPathUnderIndexedRoot(tab.findingRoot || tab.path, indexedRoots || []);

  return (
    <div className="flex flex-col gap-1.5 px-2.5 py-2 border-b border-white/[0.06] bg-black/20 shrink-0">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={draftQuery}
          onChange={e => setDraftQuery(e.target.value)}
          onBlur={commitQuery}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitQuery();
            } else if (e.key === 'Escape') {
              setDraftQuery(tab.findingQuery || '');
              e.currentTarget.blur();
            }
          }}
          className="bndz-plugin-input min-w-[140px] flex-1 max-w-xs text-[11px] text-amber-100/95 font-medium"
          placeholder="Search query…"
          spellCheck={false}
        />

        {rootIndexed && (
          <span className="bndz-plugin-kind-pill text-[9px]" title="Scope is indexed">IDX</span>
        )}

        <select
          value={scope}
          onChange={e => onChange({ findingScope: e.target.value as IndexedSearchScope })}
          className="bndz-plugin-input bndz-plugin-select text-[10px] w-auto min-w-[8rem]"
          title="Search scope"
        >
          <option value="library">Whole library</option>
          <option value="folder">Current folder</option>
          <option value="location">Drive / location</option>
        </select>

        <button type="button" className={toggleClass(useRegex)} onClick={() => onChange({ findingUseRegex: !useRegex })} title="Regex patterns">
          <Icons8Icon id="regex_ui" size={11} /> Regex
        </button>
        <button type="button" className={toggleClass(searchContent)} onClick={() => onChange({ findingSearchContent: !searchContent })} title="Search file contents">
          <Icons8Icon id="file_ui" size={11} /> Content
        </button>
        <button type="button" className={toggleClass(booleanMode)} onClick={() => onChange({ findingBooleanMode: !booleanMode })} title="Boolean query (AND/OR/NOT)">
          <Icons8Icon id="braces_ui" size={11} /> Boolean
        </button>

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading || !tab.findingQuery?.trim()}
          className="ml-auto bndz-plugin-btn inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium disabled:opacity-50"
        >
          {loading ? <Icons8Icon id="loading" size={11} spin /> : <Icons8Icon id="refresh" size={11} />}
          Refresh
        </button>
      </div>
      {tab.findingError && (
        <p className="text-[10px] text-red-300/90 px-0.5">{tab.findingError}</p>
      )}
    </div>
  );
}
