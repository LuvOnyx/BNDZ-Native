import { normalizePanePath } from './pathUtils';

/**
 * Columns (Miller) root freeze: keep a fixed left edge while selectedPath deepens
 * so new columns cascade to the right.
 *
 * @param previousTabPath path before this navigation (used when freeze was never stored)
 */
export function resolveMillerRootOnNavigate(
  prevRoot: string | undefined,
  viewMode: string | undefined,
  nextPath: string,
  previousTabPath?: string,
): string | undefined {
  if (viewMode !== 'columns') return undefined;
  const next = normalizePanePath(nextPath) || '/';
  const prev = prevRoot != null && prevRoot !== '' ? normalizePanePath(prevRoot) : '';

  if (!prev) {
    // Session restore / first columns navigate without a stored freeze:
    // keep the shallow path as the cascade origin when drilling deeper.
    const from = previousTabPath ? normalizePanePath(previousTabPath) : '';
    if (from && from !== '/' && (next === from || next.startsWith(`${from}/`))) {
      return from;
    }
    return next;
  }

  // Still browsing under the frozen root → keep cascading.
  if (prev === '/') return '/';
  if (next === prev || next.startsWith(`${prev}/`)) return prev;

  // Climbed above the root (breadcrumb / Up) → re-root at the new location.
  if (next === '/' || prev.startsWith(`${next}/`)) return next;

  // Jump to an unrelated place (sidebar, drive switch) → new cascade root.
  return next;
}

export function millerRootForMount(
  millerRootPath: string | undefined,
  panePath: string,
  isThisPc: boolean,
): string {
  if (isThisPc) return '/';
  const frozen = millerRootPath ? normalizePanePath(millerRootPath) : '';
  const pane = normalizePanePath(panePath) || '/';
  if (!frozen) return pane;
  if (pane === frozen || pane.startsWith(`${frozen}/`)) return frozen;
  // User climbed above the freeze — mount at the shorter path.
  if (frozen.startsWith(`${pane}/`)) return pane;
  return pane;
}
