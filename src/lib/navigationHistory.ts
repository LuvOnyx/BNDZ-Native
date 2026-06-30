/** XYplorer Mini Tree + GoTo autocomplete — visited path store */

export type NavVisit = { path: string; at: number; label: string };

export function recordNavVisit(history: NavVisit[] | undefined, rawPath: string, max = 250): NavVisit[] {
  const path = rawPath.replace(/\\/g, '/');
  if (!path || path === '/' || path === '/this-pc' || path === '//') return history ?? [];
  const parts = path.split('/').filter(Boolean);
  const label = parts[parts.length - 1] || path;
  const next = [{ path, at: Date.now(), label }, ...(history ?? []).filter(h => h.path !== path)];
  return next.slice(0, max);
}

export type MiniTreeNode = { path: string; label: string; depth: number; at: number };

/** Unique folder segments from visit history, newest leaves first (XYplorer Mini Tree). */
export function buildMiniTreeFromVisits(visits: NavVisit[]): MiniTreeNode[] {
  const byPath = new Map<string, MiniTreeNode>();
  for (const v of visits) {
    const path = v.path.replace(/\\/g, '/');
    const parts = path.split('/').filter(Boolean);
    let acc = '';
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      acc = i === 0 && /^[A-Za-z]:$/.test(seg) ? `/${seg}` : `${acc}/${seg}`.replace(/\/\//g, '/');
      const depth = acc.split('/').filter(Boolean).length - (acc.match(/^\/[A-Za-z]:/) ? 0 : 0);
      const prev = byPath.get(acc);
      if (!prev || v.at > prev.at) {
        byPath.set(acc, { path: acc, label: seg, depth: Math.max(0, depth - 1), at: v.at });
      }
    }
  }
  return [...byPath.values()].sort((a, b) => b.at - a.at);
}
