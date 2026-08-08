import { normalizePanePath } from './pathUtils';
import { normalizeDirEntries } from './normalizeDirEntry';
import { buildSettingsRuntime } from './settingsRuntime';

export type IndexedSearchScope = 'library' | 'folder' | 'location';

export function resolveSearchRoot(scope: IndexedSearchScope, tabPath: string): string {
  if (scope === 'folder') return tabPath;
  if (scope === 'location') {
    const norm = normalizePanePath(tabPath);
    const drive = norm.match(/^\/([A-Za-z]:)/);
    return drive ? `/${drive[1]}` : norm;
  }
  return '';
}

/** Build performGlobalSearch args from app config + scope. */
export function buildGlobalSearchArgs(
  config: Record<string, unknown>,
  query: string,
  scope: IndexedSearchScope,
  tabPath: string,
  overrides?: { useRegex?: boolean; searchContent?: boolean; booleanMode?: boolean },
) {
  const rt = buildSettingsRuntime(config as any);
  return {
    query,
    limit: (config.globalSearchLimit as number) || 1000,
    useRegex: overrides?.useRegex ?? config.enableExtendedPatternMatching === true,
    rootPath: resolveSearchRoot(scope, tabPath),
    useEverything: config.enableEverythingSearch !== false,
    searchContent: overrides?.searchContent ?? rt.search.searchContent,
    opts: {
      booleanMode: overrides?.booleanMode
        ?? (config.enableSmartBooleanQueryParsing === true || config.useSpaceCharacterForBooleanAnd === true),
      spaceIsAnd: config.useSpaceCharacterForBooleanAnd === true,
      preferBndzIndex: config.enableBndzIndexedSearch !== false,
    },
  };
}

/** Normalize heterogeneous search hits (Everything vs index) for list filters. */
export function normalizeSearchResults(items: any[] | null | undefined): any[] {
  return normalizeDirEntries(items).map((item: any) => {
    const isDir = item.type === 'directory' || item.isDirectory === true;
    return {
      ...item,
      type: isDir ? 'directory' : (item.type || 'file'),
      isDirectory: isDir,
    };
  });
}
