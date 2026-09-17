/** Paste completion helpers — Explorer-parity dest optimism + select/tint. */

import { normalizePanePath } from './pathUtils';

export type PasteStartedDetail = {
  opId: string;
  op: 'copy' | 'move';
  label: string;
  destPanePath: string;
  sourceWinPaths: string[];
  sourceNames: string[];
};

export type PasteCompletedDetail = {
  opId: string;
  destPanePath: string;
  sourceNames: string[];
};

export type PasteFailedDetail = {
  opId: string;
  destPanePath: string;
};

export function basenameFromWinPath(p: string): string {
  const s = String(p || '').replace(/\//g, '\\');
  const leaf = s.split('\\').filter(Boolean).pop() || '';
  return leaf;
}

export function buildPasteProvisionalRows(
  destPanePath: string,
  sourceWinPaths: string[],
  sourceMeta?: Array<{ name?: string; type?: string; isDirectory?: boolean } | null>,
): Array<{
  id: string;
  name: string;
  path: string;
  type: string;
  isDirectory: boolean;
  size: number;
  modified: string;
  dateModified: number;
  __optimisticDrop: true;
  __recentPaste: true;
}> {
  const dest = normalizePanePath(destPanePath).replace(/\/$/, '');
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  return sourceWinPaths.map((win, i) => {
    const name = basenameFromWinPath(win) || sourceMeta?.[i]?.name || 'item';
    const paneChild = normalizePanePath(`${dest}/${name}`);
    const meta = sourceMeta?.[i];
    const looksDir = !!(
      meta?.isDirectory
      || meta?.type === 'directory'
      || (!/\.[^./\\]+$/.test(name) && !meta)
    );
    return {
      id: paneChild,
      name,
      path: paneChild,
      type: looksDir ? 'directory' : 'file',
      isDirectory: looksDir,
      size: 0,
      // Color filters (`ageM:`) read `modified` — must be ISO for green "recent" tint.
      modified: nowIso,
      dateModified: nowMs,
      __optimisticDrop: true as const,
      __recentPaste: true as const,
    };
  });
}

/** Resolve pasted row ids from a listing by basename (case-insensitive). */
export function resolvePasteSelectionIds(
  listing: Array<{ id?: string; name?: string; path?: string } | null | undefined>,
  names: string[],
  destPanePath: string,
): string[] {
  if (!listing?.length || !names?.length) return [];
  const want = new Set(names.map(n => String(n || '').toLowerCase()).filter(Boolean));
  if (!want.size) return [];
  const dest = normalizePanePath(destPanePath).replace(/\/$/, '');
  const ids: string[] = [];
  for (const e of listing) {
    if (!e) continue;
    const name = String(e.name || '').toLowerCase();
    if (!want.has(name)) continue;
    ids.push(String(e.id || e.path || normalizePanePath(`${dest}/${e.name}`)));
  }
  return ids;
}

/**
 * Fire dest optimism for paste / Copy To / Move To / drop / host inbound.
 * BNDZUI listens on `bndz-paste-started` and injects rows + select + green tint.
 */
export function dispatchTransferDestStarted(detail: PasteStartedDetail): void {
  try {
    window.dispatchEvent(new CustomEvent('bndz-paste-started', { detail }));
  } catch { /* ignore */ }
}

export function scrollListRowIntoView(entityId: string): void {
  if (!entityId) return;
  requestAnimationFrame(() => {
    try {
      document.getElementById(`fs-item-${entityId}`)?.scrollIntoView({ block: 'nearest' });
    } catch { /* ignore */ }
  });
}
