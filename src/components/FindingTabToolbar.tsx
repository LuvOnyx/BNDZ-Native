import React, { useEffect, useState } from 'react';
import { Loader2, RefreshCw, Regex, FileText, Braces } from 'lucide-react';
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
    `flex items-center gap-1 px-2 py-0.5 text-[10px] border rounded transition-colors ${
      on
        ? 'bg-[#094771] border-[#0a5a8c] text-white'
        : 'bg-[#2a2a2a] border-[#454545] text-gray-400 hover:text-gray-200'
    }`;

  const rootIndexed = isPathUnderIndexedRoot(tab.findingRoot || tab.path, indexedRoots || []);

  return (
    <div className="flex flex-col gap-1 px-2 py-1.5 border-b border-[#333] bg-[#252526] shrink-0">
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
          className="min-w-[140px] flex-1 max-w-xs text-[11px] bg-[#1e1e1e] border border-[#454545] text-amber-100 px-2 py-0.5 rounded outline-none focus:border-amber-500/50 font-medium"
          placeholder="Search query…"
          spellCheck={false}
        />

        {rootIndexed && (
          <span className="px-1.5 py-px text-[9px] bg-sky-900/60 text-sky-300 rounded" title="Scope is indexed">IDX</span>
        )}

        <select
          value={scope}
          onChange={e => onChange({ findingScope: e.target.value as IndexedSearchScope })}
          className="text-[10px] bg-[#1e1e1e] border border-[#454545] text-gray-300 px-1.5 py-0.5 rounded outline-none focus:border-sky-500/50"
          title="Search scope"
        >
          <option value="library">Whole library</option>
          <option value="folder">Current folder</option>
          <option value="location">Drive / location</option>
        </select>

        <button type="button" className={toggleClass(useRegex)} onClick={() => onChange({ findingUseRegex: !useRegex })} title="Regex patterns">
          <Regex size={11} /> Regex
        </button>
        <button type="button" className={toggleClass(searchContent)} onClick={() => onChange({ findingSearchContent: !searchContent })} title="Search file contents">
          <FileText size={11} /> Content
        </button>
        <button type="button" className={toggleClass(booleanMode)} onClick={() => onChange({ findingBooleanMode: !booleanMode })} title="Boolean query (AND/OR/NOT)">
          <Braces size={11} /> Boolean
        </button>

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading || !tab.findingQuery?.trim()}
          className="ml-auto flex items-center gap-1 px-2 py-0.5 text-[10px] bg-[#333] hover:bg-[#3d3d3d] border border-[#454545] text-gray-200 disabled:opacity-50"
        >
          {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          Refresh
        </button>
      </div>
      {tab.findingError && (
        <p className="text-[10px] text-red-300/90 px-0.5">{tab.findingError}</p>
      )}
    </div>
  );
}
