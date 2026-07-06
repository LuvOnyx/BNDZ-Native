import { normalizePanePath } from './pathUtils';

/** True when pane path equals or is nested under an indexed search root. */
export function isPathUnderIndexedRoot(path: string | undefined, roots: string[]): boolean {
  if (!path || !roots.length) return false;
  const norm = normalizePanePath(path).toLowerCase().replace(/\/$/, '');
  return roots.some(r => {
    const root = normalizePanePath(r).toLowerCase().replace(/\/$/, '');
    if (!root) return false;
    return norm === root || norm.startsWith(`${root}/`);
  });
}

export function mapFindingEngine(engine?: string | null): 'everything' | 'indexed' | 'indexed+everything' | null {
  if (!engine) return null;
  if (engine === 'indexed+everything') return 'indexed+everything';
  if (engine === 'everything') return 'everything';
  return 'indexed';
}
