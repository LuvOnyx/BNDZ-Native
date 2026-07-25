/** Session-only navigation Ghost Trail for Continuum Home (not a history dashboard). */

export type GhostTrailEntry = {
  path: string;
  name: string;
  at: number;
};

const KEY = 'bndz-ghost-trail-v1';
const MAX = 8;
const listeners = new Set<() => void>();

function read(): GhostTrailEntry[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function write(entries: GhostTrailEntry[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX)));
  } catch { /* ignore */ }
  listeners.forEach(cb => {
    try { cb(); } catch { /* ignore */ }
  });
}

export function getGhostTrail(): GhostTrailEntry[] {
  return read();
}

export function pushGhostTrail(path: string, name?: string) {
  const p = (path || '').replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  if (!p || p === '/bndz/home') return;
  const leaf = name || p.split('/').filter(Boolean).pop() || p;
  const next: GhostTrailEntry[] = [
    { path: p, name: leaf, at: Date.now() },
    ...read().filter(e => e.path !== p),
  ].slice(0, MAX);
  write(next);
}

export function subscribeGhostTrail(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
