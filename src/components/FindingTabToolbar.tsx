import React from 'react';
import { Loader2, RefreshCw, Regex, FileText, Braces } from 'lucide-react';
import type { TabState } from './tabTypes';
import type { AppConfig } from '../data/configContext';
import type { IndexedSearchScope } from '../lib/globalSearchCall';
import { findingTabLabel } from '../lib/findingTab';

type Props = {
  tab: TabState;
  config: AppConfig;
  loading?: boolean;
  onChange: (patch: Partial<TabState>) => void;
  onRefresh: () => void;
};

export default function FindingTabToolbar({ tab, config, loading, onChange, onRefresh }: Props) {
  const scope = (tab.findingScope || 'library') as IndexedSearchScope;
  const useRegex = tab.findingUseRegex ?? config.enableExtendedPatternMatching === true;
  const searchContent = tab.findingSearchContent ?? config.searchFileContent === true;
  const booleanMode = tab.findingBooleanMode ?? config.enableSmartBooleanQueryParsing === true;

  const toggleClass = (on: boolean) =>
    `flex items-center gap-1 px-2 py-0.5 text-[10px] border rounded transition-colors ${
      on
        ? 'bg-[#094771] border-[#0a5a8c] text-white'
        : 'bg-[#2a2a2a] border-[#454545] text-gray-400 hover:text-gray-200'
    }`;

  return (
    <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 border-b border-[#333] bg-[#252526] shrink-0">
      <span className="text-[11px] text-amber-400/90 font-medium truncate max-w-[200px]" title={findingTabLabel(tab)}>
        {tab.findingQuery || 'Search'}
      </span>

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
        disabled={loading}
        className="ml-auto flex items-center gap-1 px-2 py-0.5 text-[10px] bg-[#333] hover:bg-[#3d3d3d] border border-[#454545] text-gray-200 disabled:opacity-50"
      >
        {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
        Refresh
      </button>
    </div>
  );
}
