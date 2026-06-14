import { isRecycleBinPath, normalizePanePath, RECYCLE_BIN_PATH } from './pathUtils';

/** Human-readable tab / breadcrumb label for a pane path */
export function getPaneTabLabel(path: string): string {
  const p = normalizePanePath(path);
  if (p === '/') return 'This PC';
  if (p === '//' || p === '\\\\') return 'Network';
  if (isRecycleBinPath(p)) return 'Recycle Bin';
  if (/^\/[A-Za-z]:$/.test(p)) return p.slice(1);
  const leaf = p.split('/').filter(Boolean).pop() || p;
  if (leaf.toLowerCase() === 'workspace') return 'Workspace';
  return leaf;
}
