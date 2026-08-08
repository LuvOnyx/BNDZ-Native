import { BNDZ_HOME, BNDZ_VIEWS_ROOT, BNDZ_RAM_ROOT, parseBndzVirtualView, bndzVirtualLabel, parseBndzWorkspaceView, bndzWorkspaceLabel, isBndzRamPath, parseBndzRamZoneId } from './bndzVirtualViews';
import { isRecycleBinPath, normalizePanePath, RECYCLE_BIN_PATH } from './pathUtils';

/** Canonical `/shell:…` roots → Explorer-style labels (never expose raw shell: tokens in UI). */
const SHELL_ROOT_LABELS: Record<string, string> = {
  '/shell:desktop': 'Desktop',
  '/shell:personal': 'Documents',
  '/shell:downloads': 'Downloads',
  '/shell:my pictures': 'Pictures',
  '/shell:mypictures': 'Pictures',
  '/shell:my music': 'Music',
  '/shell:mymusic': 'Music',
  '/shell:my video': 'Videos',
  '/shell:myvideo': 'Videos',
  '/shell:pictureslibrary': 'Gallery',
  '/shell:profile': 'Home',
  '/shell:home': 'Home',
  '/shell:libraries': 'Libraries',
  '/shell:controlpanel': 'Control Panel',
  '/shell:portabledevices': 'Portable Devices',
  '/shell:recyclebin': 'Recycle Bin',
};

/** Bare shell tokens (no path) → friendly label. */
const SHELL_TOKEN_LABELS: Record<string, string> = {
  desktop: 'Desktop',
  personal: 'Documents',
  downloads: 'Downloads',
  'my pictures': 'Pictures',
  mypictures: 'Pictures',
  'my music': 'Music',
  mymusic: 'Music',
  'my video': 'Videos',
  myvideo: 'Videos',
  pictureslibrary: 'Gallery',
  profile: 'Home',
  home: 'Home',
  libraries: 'Libraries',
  controlpanel: 'Control Panel',
  portabledevices: 'Portable Devices',
  recyclebin: 'Recycle Bin',
};

/** Insert spaces into CamelCase shell tokens: ControlPanel → Control Panel. */
export function prettifyShellToken(token: string): string {
  const trimmed = (token || '').trim();
  if (!trimmed) return '';
  const known = SHELL_TOKEN_LABELS[trimmed.toLowerCase()];
  if (known) return known;
  return trimmed
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize any shell:/CLSID/pane form to `/shell:Token` when possible.
 * Returns null when the path is not a shell known-folder style path.
 */
export function toShellPanePath(path: string | null | undefined): string | null {
  if (!path) return null;
  const raw = path.trim();
  if (!raw) return null;
  const slashed = raw.replace(/\\/g, '/');
  if (/^shell:/i.test(slashed)) return normalizePanePath(`/${slashed}`);
  const pane = normalizePanePath(slashed);
  if (/^\/shell:/i.test(pane)) return pane;
  return null;
}

/** True when UI should treat this as a shell: display path (not a normal FS path). */
export function isShellDisplayPath(path: string | null | undefined): boolean {
  if (!path) return false;
  if (isRecycleBinPath(path)) return true;
  return !!toShellPanePath(path);
}

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

  const shellPane = toShellPanePath(path) || (/^\/shell:/i.test(p) ? p : null);
  if (shellPane) {
    const lower = shellPane.toLowerCase();
    const rootKey = lower.includes('/') && lower.indexOf('/', 1) > 0
      ? null
      : lower;
    // Exact root: /shell:Downloads
    if (rootKey && SHELL_ROOT_LABELS[rootKey]) return SHELL_ROOT_LABELS[rootKey];

    const rest = shellPane.slice('/shell:'.length);
    const slash = rest.indexOf('/');
    if (slash < 0) {
      return prettifyShellToken(rest);
    }
    const folder = prettifyShellToken(rest.slice(0, slash));
    const leaf = rest.slice(slash + 1).split('/').filter(Boolean).pop() || '';
    return leaf ? `${folder}\\${leaf.replace(/\//g, '\\')}` : folder;
  }

  const leaf = p.split('/').filter(Boolean).pop() || p;
  if (leaf.toLowerCase() === 'workspace') return 'Workspace';
  if (/^shell:/i.test(leaf)) return prettifyShellToken(leaf.slice('shell:'.length));
  if (p === RECYCLE_BIN_PATH) return 'Recycle Bin';
  return leaf;
}
