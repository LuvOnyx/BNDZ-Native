import { BNDZ_HOME, BNDZ_VIEWS_ROOT, BNDZ_RAM_ROOT, parseBndzVirtualView, bndzVirtualLabel, parseBndzWorkspaceView, bndzWorkspaceLabel, isBndzRamPath, parseBndzRamZoneId } from './bndzVirtualViews';
import { isRecycleBinPath, normalizePanePath, RECYCLE_BIN_PATH } from './pathUtils';

/** Human-readable tab / breadcrumb label for a pane path */
export function getPaneTabLabel(path: string): string {
  const p = normalizePanePath(path);
  if (p === '/') return 'This PC';
  if (p === '//' || p === '\\\\') return 'Network';
  if (isRecycleBinPath(p)) return 'Recycle Bin';
  if (p === BNDZ_HOME) return 'Home';
  if (p === BNDZ_VIEWS_ROOT) return 'Smart views';
  const bndzView = parseBndzVirtualView(p);
  if (bndzView) return bndzVirtualLabel(bndzView);
  const workspace = parseBndzWorkspaceView(p);
  if (workspace) return bndzWorkspaceLabel(workspace);
  if (isBndzRamPath(p)) {
    const zoneId = parseBndzRamZoneId(p);
    if (!zoneId) return 'RAM Staging';
    const tail = p.slice(BNDZ_RAM_ROOT.length + zoneId.length + 1);
    if (tail) return tail.split('/').filter(Boolean).pop() || zoneId;
    return zoneId;
  }
  if (/^\/[A-Za-z]:$/.test(p)) return p.slice(1);
  const lower = p.toLowerCase();
  if (lower === '/shell:desktop') return 'Desktop';
  if (lower === '/shell:personal') return 'Documents';
  if (lower === '/shell:downloads') return 'Downloads';
  if (lower === '/shell:my pictures') return 'Pictures';
  if (lower === '/shell:my music') return 'Music';
  if (lower === '/shell:my video') return 'Videos';
  if (lower === '/shell:profile' || lower === '/shell:home') return 'Profile';
  if (lower === '/shell:pictureslibrary') return 'Gallery';
  if (lower === '/shell:libraries') return 'Libraries';
  const leaf = p.split('/').filter(Boolean).pop() || p;
  if (leaf.toLowerCase() === 'workspace') return 'Workspace';
  if (/^shell:/i.test(leaf)) return leaf.slice('shell:'.length);
  return leaf;
}
