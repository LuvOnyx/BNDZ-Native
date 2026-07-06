import type { TabState } from '../components/tabTypes';
import type { AppConfig } from '../data/configContext';

export function isFindingTab(tab: TabState): boolean {
  return tab.kind === 'finding' && !!tab.findingQuery;
}

export function findingTabLabel(tab: TabState): string {
  if (!isFindingTab(tab)) return '';
  const q = tab.findingQuery || 'Search';
  const base = q.length > 22 ? `${q.slice(0, 20)}…` : q;
  const engine = tab.findingEngine === 'everything' ? ' · EV'
    : tab.findingEngine === 'indexed+everything' ? ' · IDX+EV'
    : tab.findingEngine === 'indexed' ? ' · IDX' : '';
  return `🔍 ${base}${engine}`;
}

export function createFindingTab(query: string, rootPath: string, config?: Partial<AppConfig>): TabState {
  return {
    id: `t-${Date.now()}`,
    path: rootPath,
    history: [rootPath],
    historyIndex: 0,
    selectedItems: [],
    viewMode: 'details',
    kind: 'finding',
    findingQuery: query.trim(),
    findingRoot: rootPath,
    findingLoading: true,
    findingResults: [],
    findingEngine: null,
    findingScope: 'library',
    findingUseRegex: config?.enableExtendedPatternMatching === true,
    findingSearchContent: config?.searchFileContent === true,
    findingBooleanMode: config?.enableSmartBooleanQueryParsing === true,
    color: '#f59e0b',
  };
}
