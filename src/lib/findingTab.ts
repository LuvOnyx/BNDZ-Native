import type { TabState } from '../components/tabTypes';

export function isFindingTab(tab: TabState): boolean {
  return tab.kind === 'finding' && !!tab.findingQuery;
}

export function findingTabLabel(tab: TabState): string {
  if (!isFindingTab(tab)) return '';
  const q = tab.findingQuery || 'Search';
  return q.length > 22 ? `🔍 ${q.slice(0, 20)}…` : `🔍 ${q}`;
}

export function createFindingTab(query: string, rootPath: string): TabState {
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
    color: '#f59e0b',
  };
}
