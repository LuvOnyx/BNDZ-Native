import { isRecycleBinPath, normalizePanePath, RECYCLE_BIN_PATH, toWindowsPath } from './pathUtils';
import { getPaneTabLabel } from './paneLabels';
import { parseUserCatalogPath } from './virtualPaths';
import { BNDZ_HOME, BNDZ_VIEWS_ROOT, parseBndzVirtualView, bndzVirtualLabel, parseBndzWorkspaceView, bndzWorkspaceLabel } from './bndzVirtualViews';
import { ENV_PATH_ALIASES, SPECIAL_FOLDER_PANE_PATHS } from './shellPaths';

/** `C:` from `/C:` or `//C:` */
export function formatDriveLetter(pathOrName: string): string {
  let p = pathOrName.replace(/\\/g, '/').replace(/^\//, '');
  if (p.startsWith('//') && /^\/\/[A-Za-z]:/.test(pathOrName.replace(/\\/g, '/'))) {
    p = p.replace(/^\/+/, '');
  }
  if (/^[A-Za-z]:$/.test(p)) return p;
  if (/^[A-Za-z]:\/$/.test(p)) return p.slice(0, 2);
  return p;
}

/** Drive root label for lists / size map — always `C:\`, never `/C:`. */
export function formatDriveRootLabel(pathOrName: string): string {
  const letter = formatDriveLetter(pathOrName);
  if (/^[A-Za-z]:$/.test(letter)) return `${letter}\\`;
  return formatPropertiesPath(pathOrName) || letter;
}

/** Windows-style path for properties / copy — never `\\C:` for drive roots */
export function formatPropertiesPath(path: string | null | undefined): string {
  if (!path) return '';
  const p = normalizePanePath(path.replace(/\\/g, '/'));
  if (/^\/[A-Za-z]:$/.test(p)) return p.slice(1) + '\\';
  return toWindowsPath(p);
}

/** Windows-style path for the address bar (`C:\Users\...`) */
export function formatAddressBarPath(panePath: string): string {
  const p = normalizePanePath(panePath);
  if (p.startsWith('/vf/')) return `vf://${p.slice(4)}`;
  if (p === '/vf') return 'vf://';
  if (p === BNDZ_HOME) return 'Home';
  if (p === BNDZ_VIEWS_ROOT) return 'Smart views';
  const bndzView = parseBndzVirtualView(p);
  if (bndzView) return bndzVirtualLabel(bndzView);
  const workspace = parseBndzWorkspaceView(p);
  if (workspace) return bndzWorkspaceLabel(workspace);
  if (p === '/') return 'This PC';
  if (isRecycleBinPath(p)) return 'Recycle Bin';
  if (p === '//' || p === '\\\\') return 'Network';
  if (p === '/shell:PortableDevices' || p.toLowerCase() === '/shell:portabledevices') return 'Portable Devices';
  // Prefer friendly labels if a known-folder shell path is still open.
  if (/^\/shell:/i.test(p)) {
    const label = getPaneTabLabel(p);
    if (label && label !== p && !/^shell:/i.test(label)) return label;
  }
  const win = toWindowsPath(p);
  return win.replace(/^\\+([A-Za-z]:)/, '$1');
}

export interface BreadcrumbSegment {
  label: string;
  path: string;
}

/** Breadcrumb segments with human-readable labels (no raw `/C:` or `\\C:`). */
export function getBreadcrumbSegments(panePath: string, catalogNames?: Record<string, string>): BreadcrumbSegment[] {
  const p = normalizePanePath(panePath);
  if (p === '/vf' || p === 'vf://') return [{ label: 'Catalog', path: '/vf' }];
  if (p.startsWith('/vf/')) {
    const id = p.slice(4).split('/')[0];
    const name = catalogNames?.[id] || id;
    return [
      { label: 'Catalog', path: '/vf' },
      { label: name, path: `/vf/${id}` },
    ];
  }
  if (p === '/' || p === '/this-pc') return [{ label: 'This PC', path: '/' }];
  if (p === BNDZ_HOME) return [{ label: 'Home', path: BNDZ_HOME }];
  if (p === BNDZ_VIEWS_ROOT) return [{ label: 'Smart views', path: BNDZ_VIEWS_ROOT }];
  const bndzView = parseBndzVirtualView(p);
  if (bndzView) {
    return [
      { label: 'Smart views', path: BNDZ_VIEWS_ROOT },
      { label: bndzVirtualLabel(bndzView), path: p },
    ];
  }
  const workspace = parseBndzWorkspaceView(p);
  if (workspace) {
    return [
      { label: 'Smart views', path: BNDZ_VIEWS_ROOT },
      { label: bndzWorkspaceLabel(workspace), path: p },
    ];
  }
  if (isRecycleBinPath(p)) return [{ label: 'Recycle Bin', path: RECYCLE_BIN_PATH }];
  if (p === '//' || p === '\\\\') return [{ label: 'Network', path: '//' }];
  if (p === '/shell:PortableDevices' || p.toLowerCase() === '/shell:portabledevices') {
    return [{ label: 'Portable Devices', path: '/shell:PortableDevices' }];
  }

  const segments: BreadcrumbSegment[] = [];

  if (/^\/[A-Za-z]:/.test(p)) {
    const drive = p.slice(1, 3);
    segments.push({ label: `${drive}\\`, path: `/${drive}` });
    const rest = p.slice(3).replace(/^\//, '');
    if (rest) {
      const parts = rest.split('/').filter(Boolean);
      parts.forEach((part, i) => {
        segments.push({
          label: part,
          path: `/${drive}/${parts.slice(0, i + 1).join('/')}`,
        });
      });
    }
    return segments;
  }

  if (p.startsWith('//')) {
    const parts = p.replace(/^\/+/, '').split('/').filter(Boolean);
    let acc = '//';
    parts.forEach((part, i) => {
      acc = i === 0 ? `//${part}` : `${acc}/${part}`;
      segments.push({ label: part, path: acc });
    });
    return segments.length ? segments : [{ label: 'Network', path: '//' }];
  }

  const parts = p.split('/').filter(Boolean);
  let acc = '';
  parts.forEach((part, i) => {
    acc = i === 0 ? `/${part}` : `${acc}/${part}`;
    segments.push({ label: getPaneTabLabel(acc) || part, path: acc });
  });
  return segments.length ? segments : [{ label: getPaneTabLabel(p), path: p }];
}

/** List / tree display name — strips paths for recycle bin items. */
export function getEntityDisplayName(
  entity: { name?: string; path?: string; extension?: string; type?: string; isRecycleItem?: boolean },
  config: { showFileExtensions?: boolean; hideShortcutExtensions?: boolean },
  panePath?: string,
): string {
  const isDir = entity.type === 'directory';
  let name = entity.name || '';

  if (entity.isRecycleItem || (panePath && isRecycleBinPath(panePath))) {
    name = name.split(/[/\\]/).pop() || name;
    const inMatch = name.match(/^(.+?)\s+\(in\s+.+\)$/i);
    if (inMatch) name = inMatch[1].trim();
  }

  const ext = entity.extension;
  const hideShortcutExtension = !isDir
    && String(ext || '').toLowerCase() === 'lnk'
    && config.hideShortcutExtensions !== false;
  if (!isDir && ext && (config.showFileExtensions === false || hideShortcutExtension)) {
    return name.replace(new RegExp(`\\.${ext}$`, 'i'), '');
  }
  return name;
}

/** Rewrite bare aliases (`appdata`, `temp\foo`) to `%VAR%` forms before host expansion. */
export function rewriteEnvPathAliases(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  const lower = trimmed.toLowerCase();
  const exact = ENV_PATH_ALIASES[lower];
  if (exact) return exact;

  for (const [alias, env] of Object.entries(ENV_PATH_ALIASES)) {
    const slash = alias + '/';
    const back = alias + '\\';
    if (lower.startsWith(slash) || lower.startsWith(back)) {
      return env + trimmed.slice(alias.length);
    }
  }
  return trimmed;
}

export function pathNeedsEnvironmentExpand(input: string): boolean {
  const raw = rewriteEnvPathAliases(input).trim();
  if (!raw) return false;
  if (/%[A-Za-z][A-Za-z0-9_()]*%/i.test(raw)) return true;
  if (/^shell:/i.test(raw) || /^\/shell:/i.test(raw)) return true;
  return false;
}

/** Parse user-typed or pasted Windows path into a pane path for navigation. */
export function parseUserPathToPane(input: string): string | null {
  const raw = rewriteEnvPathAliases(input).trim();
  if (!raw) return '/';
  if (/^this\s*pc$/i.test(raw)) return '/';
  if (/^recycle\s*bin$/i.test(raw)) return RECYCLE_BIN_PATH;
  if (/^network$/i.test(raw)) return '//';
  if (/^home$/i.test(raw) || /^continuum$/i.test(raw) || /^bndz\s*home$/i.test(raw) || /^start$/i.test(raw)) return BNDZ_HOME;
  if (/^recent\s*files?$/i.test(raw)) return '/bndz/recent';
  if (/^photos?\s*&?\s*videos?$/i.test(raw) || /^media$/i.test(raw)) return '/bndz/media';
  if (/^large\s*files?$/i.test(raw)) return '/bndz/large';
  if (/^smart\s*views?$/i.test(raw)) return BNDZ_VIEWS_ROOT;
  if (/^profile$/i.test(raw)) return '/shell:Profile';
  const special = SPECIAL_FOLDER_PANE_PATHS[raw.toLowerCase()];
  if (special) return special;
  const catalogPath = parseUserCatalogPath(raw);
  if (catalogPath) return catalogPath;

  let normalized = raw.replace(/\//g, '\\');
  // Leave %VAR% for async expand — caller should expand first when needed.
  if (/%[A-Za-z][A-Za-z0-9_()]*%/i.test(normalized)) {
    return null;
  }
  if (/^[A-Za-z]:\\?/.test(normalized)) {
    const drive = normalized.slice(0, 2).toUpperCase();
    const rest = normalized.slice(2).replace(/^\\+/, '').replace(/\\/g, '/');
    return rest ? `/${drive}/${rest}` : `/${drive}`;
  }
  if (normalized.startsWith('\\\\')) {
    const unc = normalized.slice(2).replace(/\\/g, '/').replace(/\/+$/, '');
    return unc ? `//${unc}` : '//';
  }

  try {
    const p = normalizePanePath(raw);
    if (p === '/' || /^\/[A-Za-z]:/.test(p) || p.startsWith('//') || p.startsWith('/shell:')) return p;
    return p.startsWith('/') ? p : `/${p}`;
  } catch {
    return null;
  }
}

/**
 * Resolve a typed address-bar path: expand %AppData% / shell: / aliases, then parse to pane path.
 * `expand` should call the native host (`IPC.expandEnvironmentPath`).
 */
export async function resolveUserPathToPane(
  input: string,
  expand: (path: string) => Promise<string>,
): Promise<string | null> {
  let raw = rewriteEnvPathAliases(input).trim();
  if (!raw) return '/';
  if (pathNeedsEnvironmentExpand(raw)) {
    try {
      raw = await expand(raw);
    } catch {
      /* fall through and try sync parse */
    }
  }
  let parsed = parseUserPathToPane(raw);
  // Friendly names like "Desktop" parse to /shell:Desktop — resolve to the real FS path.
  if (parsed && /^\/shell:/i.test(parsed)) {
    try {
      const expanded = await expand(parsed);
      const reparsed = parseUserPathToPane(expanded);
      if (reparsed && !/^\/shell:/i.test(reparsed)) return reparsed;
    } catch {
      /* keep shell pane path */
    }
  }
  return parsed;
}

/** Friendly path for destination picker UI (`C:\Users\...` or `This PC`). */
export function formatPickerPath(panePath: string): string {
  if (!panePath || panePath === '/') return 'This PC';
  return formatAddressBarPath(panePath);
}
