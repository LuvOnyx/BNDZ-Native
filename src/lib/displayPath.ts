import { isRecycleBinPath, normalizePanePath, RECYCLE_BIN_PATH, toWindowsPath } from './pathUtils';
import { getPaneTabLabel } from './paneLabels';

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
  if (p === '/') return 'This PC';
  if (isRecycleBinPath(p)) return 'Recycle Bin';
  if (p === '//' || p === '\\\\') return 'Network';
  const win = toWindowsPath(p);
  return win.replace(/^\\+([A-Za-z]:)/, '$1');
}

export interface BreadcrumbSegment {
  label: string;
  path: string;
}

/** Breadcrumb segments with human-readable labels (no raw `/C:` or `\\C:`). */
export function getBreadcrumbSegments(panePath: string): BreadcrumbSegment[] {
  const p = normalizePanePath(panePath);
  if (p === '/' || p === '/this-pc') return [{ label: 'This PC', path: '/' }];
  if (isRecycleBinPath(p)) return [{ label: 'Recycle Bin', path: RECYCLE_BIN_PATH }];
  if (p === '//' || p === '\\\\') return [{ label: 'Network', path: '//' }];

  const segments: BreadcrumbSegment[] = [];

  if (/^\/[A-Za-z]:/.test(p)) {
    const drive = p.slice(1, 3);
    segments.push({ label: drive, path: `/${drive}` });
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
  config: { showFileExtensions?: boolean },
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
  if (!isDir && ext && config.showFileExtensions === false) {
    return name.replace(new RegExp(`\\.${ext}$`, 'i'), '');
  }
  return name;
}

/** Parse user-typed or pasted Windows path into a pane path for navigation. */
export function parseUserPathToPane(input: string): string | null {
  const raw = input.trim();
  if (!raw) return '/';
  if (/^this\s*pc$/i.test(raw)) return '/';
  if (/^recycle\s*bin$/i.test(raw)) return RECYCLE_BIN_PATH;
  if (/^network$/i.test(raw)) return '//';

  let normalized = raw.replace(/\//g, '\\');
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

/** Friendly path for destination picker UI (`C:\Users\...` or `This PC`). */
export function formatPickerPath(panePath: string): string {
  if (!panePath || panePath === '/') return 'This PC';
  return formatAddressBarPath(panePath);
}
