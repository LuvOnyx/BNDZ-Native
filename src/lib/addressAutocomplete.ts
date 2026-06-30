import type { NavVisit } from './navigationHistory';

export type PathSuggestion = { path: string; label: string; source: 'recent' | 'favorite' };

export function buildPathSuggestions(
  query: string,
  opts: { visits?: NavVisit[]; favorites?: { path: string; name: string }[]; limit?: number },
): PathSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q || q.startsWith('::')) return [];
  const limit = opts.limit ?? 12;
  const out: PathSuggestion[] = [];
  const seen = new Set<string>();

  const push = (path: string, label: string, source: PathSuggestion['source']) => {
    const norm = path.replace(/\\/g, '/');
    if (seen.has(norm)) return;
    seen.add(norm);
    out.push({ path: norm, label, source });
  };

  for (const f of opts.favorites ?? []) {
    const norm = f.path.replace(/\\/g, '/');
    const label = f.name || norm.split('/').pop() || norm;
    if (norm.toLowerCase().includes(q) || label.toLowerCase().includes(q)) {
      push(norm, label, 'favorite');
    }
  }
  for (const v of opts.visits ?? []) {
    if (v.path.toLowerCase().includes(q) || v.label.toLowerCase().includes(q)) {
      push(v.path, v.label, 'recent');
    }
  }
  return out.slice(0, limit);
}
