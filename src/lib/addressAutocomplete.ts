import type { NavVisit } from './navigationHistory';

export type PathSuggestion = { path: string; label: string; source: 'recent' | 'favorite' | 'path' };

export function buildPathSuggestions(
  query: string,
  opts: {
    visits?: NavVisit[];
    favorites?: { path: string; name: string; label?: string }[];
    pathCandidates?: { path: string; label?: string }[];
    limit?: number;
  },
): PathSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q || q.startsWith('::')) return [];
  const limit = opts.limit ?? 12;
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

  for (const f of opts.favorites ?? []) {
    const path = norm(f.path);
    const label = f.label || f.name || path.split('/').filter(Boolean).pop() || path;
    if (!path.toLowerCase().includes(q) && !label.toLowerCase().includes(q)) continue;
    if (!seenKey(path)) continue;
    favorites.push({ path, label, source: 'favorite' });
  }

  for (const v of opts.visits ?? []) {
    const path = norm(v.path);
    if (!path.toLowerCase().includes(q) && !v.label.toLowerCase().includes(q)) continue;
    if (!seenKey(path)) continue;
    history.push({ path, label: v.label, source: 'recent' });
  }

  for (const candidate of opts.pathCandidates ?? []) {
    const path = norm(candidate.path);
    if (!path.toLowerCase().includes(q)) continue;
    if (!seenKey(path)) continue;
    const label = candidate.label || path.split('/').filter(Boolean).pop() || path;
    pathMatches.push({ path, label, source: 'path' });
  }

  return [...favorites, ...history, ...pathMatches].slice(0, limit);
}
