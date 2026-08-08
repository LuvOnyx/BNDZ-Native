import type { NavVisit } from './navigationHistory';

export type PathSuggestion = { path: string; label: string; source: 'recent' | 'favorite' | 'path' };

export type AutoCompleteFilterMode = 'Contains' | 'Starts with' | 'Ends with' | 'Exact match' | string;

function matchesAutoCompleteFilter(
  haystack: string,
  query: string,
  mode: AutoCompleteFilterMode | undefined,
): boolean {
  const h = haystack.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return true;
  switch (mode) {
    case 'Starts with':
      return h.startsWith(q);
    case 'Ends with':
      return h.endsWith(q);
    case 'Exact match':
      return h === q;
    case 'Contains':
    default:
      return h.includes(q);
  }
}

export function buildPathSuggestions(
  query: string,
  opts: {
    visits?: NavVisit[];
    favorites?: { path: string; name: string; label?: string }[];
    pathCandidates?: { path: string; label?: string }[];
    limit?: number;
    /** Settings → Auto-Complete Path Names → Filter */
    autoCompleteFilter?: AutoCompleteFilterMode;
    /** Settings → Drop-Down Lists → Move last used item to top */
    moveLastUsedItemToTop?: boolean;
  },
): PathSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q || q.startsWith('::')) return [];
  const limit = opts.limit ?? 12;
  const mode = opts.autoCompleteFilter || 'Contains';
  const favorites: PathSuggestion[] = [];
  const history: PathSuggestion[] = [];
  const pathMatches: PathSuggestion[] = [];
  const seen = new Set<string>();

  const norm = (path: string) => path.replace(/\\/g, '/');
  const seenKey = (path: string) => {
    const key = norm(path).toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    return key;
  };
  const hit = (path: string, label: string) =>
    matchesAutoCompleteFilter(path, q, mode) || matchesAutoCompleteFilter(label, q, mode);

  for (const f of opts.favorites ?? []) {
    const path = norm(f.path);
    const label = f.label || f.name || path.split('/').filter(Boolean).pop() || path;
    if (!hit(path, label)) continue;
    if (!seenKey(path)) continue;
    favorites.push({ path, label, source: 'favorite' });
  }

  const visits = [...(opts.visits ?? [])];
  if (opts.moveLastUsedItemToTop && visits.length > 1) {
    // Most recently recorded visit already heads the list when history is append-newest;
    // bump any exact query match to the front for clearer dropdown behavior.
    const idx = visits.findIndex(v => norm(v.path).toLowerCase() === q || v.label.toLowerCase() === q);
    if (idx > 0) {
      const [item] = visits.splice(idx, 1);
      visits.unshift(item);
    }
  }

  for (const v of visits) {
    const path = norm(v.path);
    if (!hit(path, v.label)) continue;
    if (!seenKey(path)) continue;
    history.push({ path, label: v.label, source: 'recent' });
  }

  for (const candidate of opts.pathCandidates ?? []) {
    const path = norm(candidate.path);
    if (!matchesAutoCompleteFilter(path, q, mode)) continue;
    if (!seenKey(path)) continue;
    const label = candidate.label || path.split('/').filter(Boolean).pop() || path;
    pathMatches.push({ path, label, source: 'path' });
  }

  return [...favorites, ...history, ...pathMatches].slice(0, limit);
}
