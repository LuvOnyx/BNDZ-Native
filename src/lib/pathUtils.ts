/** Virtual path for the Windows Recycle Bin folder */
export const RECYCLE_BIN_PATH = '/shell:RecycleBin';

export function isRecycleBinPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const p = normalizePanePath(path);
  return p === RECYCLE_BIN_PATH || p.replace(/^\//, '').toLowerCase() === 'shell:recyclebin';
}

/** Canonical virtual pane path: `/C:`, `/C:/Users/foo`, never `drive-/C:` or `C:/foo` without leading slash */
export function normalizePanePath(path: string | null | undefined): string {
  if (path == null || path === '/') return path || '/';
  if (typeof path !== 'string') return '/';
  let p = path.replace(/\\/g, '/');
  if (p.startsWith('drive-')) p = '/' + p.slice(6);
  if (/^[A-Za-z]:/.test(p) && !p.startsWith('/')) p = '/' + p;
  if (/^\/[A-Za-z]:$/.test(p)) return p;
  // Network root (`//`) and UNC paths (`//server/share`) — but `//C:` is a drive root, not UNC
  if (/^\/\/[A-Za-z]:/.test(p)) return '/' + p.slice(2);
  if (p.startsWith('//')) return '/' + p.replace(/\/+/g, '/');
  return p.replace(/\/+/g, '/');
}

/** Compare pane paths that may use different drive-root conventions */
export function panePathsEqual(a: string, b: string): boolean {
  return normalizePanePath(a) === normalizePanePath(b);
}

/** Map a watcher directory (`C:/` or `C:\`) to pane path `/C:` */
export function watcherDirToPanePath(winDir: string): string {
  const p = winDir.replace(/\\/g, '/').replace(/\/$/, '');
  if (/^[A-Za-z]:$/.test(p)) return `/${p}`;
  if (/^\/[A-Za-z]:/.test(p)) return normalizePanePath(p);
  if (/^[A-Za-z]:\//.test(p)) return normalizePanePath('/' + p);
  return normalizePanePath(p);
}

/** Build a Windows path for create/link operations from pane path + name */
export function joinPanePathForFs(panePath: string, name: string): string {
  const base = normalizePanePath(panePath).replace(/\/$/, '');
  return toWindowsPath(`${base}/${name}`);
}

/** Stream/file URI junk — not literal % in a real Windows path segment (e.g. folder `file%3A`). */
export function isUriJunkPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const raw = path.trim();
  if (/^bndz-stream:/i.test(raw)) return true;
  if (/^file:/i.test(raw)) return true;
  if (/^file%3A/i.test(raw) && !/^\/[A-Za-z]:/.test(raw) && !/^[A-Za-z]:[/\\]/.test(raw)) return true;
  return false;
}

function decodeBndzStreamPath(url: string): string {
  const m = url.match(/^bndz-stream:\/\/local\/(.+)$/i);
  if (!m) return url;
  const segments = m[1].split('/').map((seg, i) => {
    if (i === 0 && /^[A-Za-z]%3A$/i.test(seg)) return `${seg[0]}:`;
    try { return decodeURIComponent(seg); } catch { return seg; }
  });
  return segments.join('\\');
}

/** Normalize UI path (/C:/foo/bar) to Windows path (C:\foo\bar) */
export function toWindowsPath(path: string | null | undefined): string {
  if (!path) return '';
  let p = path.trim();
  // Never whole-path decodeURIComponent — breaks real folders named file%3A on disk.
  if (/^bndz-stream:/i.test(p)) {
    p = decodeBndzStreamPath(p);
  } else if (/^file:/i.test(p)) {
    try {
      const u = new URL(p);
      if (u.protocol === 'file:') p = decodeURIComponent(u.pathname);
    } catch { /* keep */ }
  }
  // UNC / network paths: preserve the leading double separator
  const slashed = p.replace(/\\/g, '/');
  // Mis-parsed drive root (`//C:`) — not a UNC path
  if (/^\/\/[A-Za-z]:/.test(slashed)) {
    const drive = slashed.slice(2);
    return drive.endsWith('/') || drive.endsWith('\\') ? drive.replace(/\//g, '\\') : drive.replace(/\//g, '\\') + '\\';
  }
  if (slashed.startsWith('//')) {
    const body = slashed.replace(/^\/+/, '').replace(/\/+/g, '/');
    return body ? '\\\\' + body.replace(/\//g, '\\') : '\\\\';
  }
  if (p.startsWith('/')) p = p.substring(1);
  p = p.replace(/\//g, '\\');
  while (p.includes('\\\\')) p = p.replace(/\\\\/g, '\\');
  // Fix mistaken leading backslash on drive paths: \C:\foo → C:\foo (not UNC)
  if (/^\\[A-Za-z]:/.test(p) && !p.startsWith('\\\\')) p = p.slice(1);
  if (/^[A-Za-z]:$/.test(p)) p += '\\';
  return p;
}

/** True when path is usable for shell verbs (file, folder, drive root, or virtual shell location) */
export function isValidShellTarget(path: string | null | undefined): boolean {
  if (isRecycleBinPath(path)) return true;
  const pane = normalizePanePath(path);
  if (pane === '/' || pane === '//' || pane === '\\\\') return true;
  if (pane.toLowerCase() === '/shell:libraries') return true;
  const win = toWindowsPath(path);
  if (!win) return false;
  if (win.startsWith('::{')) return true;
  if (/^shell:/i.test(win)) return true;
  if (pane.toLowerCase().startsWith('/shell:')) return true;
  if (/^[A-Za-z]:\\?$/.test(win)) return true;
  if (win.startsWith('\\\\')) return win.length > 3;
  return win.length > 2;
}

/** Paths safe for native CF_HDROP outbound drag — rejects file: URI junk and virtual pane paths. */
export function isValidOutboundDragPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const raw = path.trim();
  if (isUriJunkPath(raw)) return false;
  const win = toWindowsPath(path);
  if (!win || /^file:/i.test(win)) return false;
  const pane = normalizePanePath(path);
  if (pane.toLowerCase().startsWith('/bndz/')) return false;
  const leaf = win.split(/[/\\]/).pop() ?? '';
  // Reject decoded URI junk leaf (file:) — allow literal folder names like file%3A.
  if (!leaf || leaf === 'file:' || (leaf.includes(':') && !/^[A-Za-z]:$/.test(leaf))) return false;
  if (!/^[A-Za-z]:\\/.test(win) && !win.startsWith('\\\\')) return false;
  return true;
}

/** Encode a Windows path for safe use in WebView2 stream URLs (colon-safe) */
export function encodeLocalStreamPath(winPath: string): string {
  const normalized = winPath.replace(/\\/g, '/');
  return normalized.split('/').map((segment, i) => {
    if (i === 0 && /^[A-Za-z]:$/.test(segment)) return `${segment[0]}%3A`;
    return encodeURIComponent(segment);
  }).join('/');
}

/**
 * Build URL for local file streaming in WebView2.
 * Uses custom scheme `bndz-stream://` — WebResourceRequested does not fire under
 * SetVirtualHostNameToFolderMapping hosts like http://bndz.local/...
 */
export function toVirtualStreamUrl(path: string | null | undefined): string {
  const win = toWindowsPath(path)?.split('#')[0]?.split('?')[0];
  if (!win) return '';
  // Never stream directories — custom scheme 404s and poisons preview.
  if (win.endsWith('\\') || win.endsWith('/')) return '';
  const encoded = encodeLocalStreamPath(win);
  const isNative =
    typeof window !== 'undefined' && !!(window as any).chrome?.webview;
  if (isNative) return `bndz-stream://local/${encoded}`;
  return `/local-stream/${encoded}`;
}

/** Join pane directory path with entity name when backend path is missing */
export function joinPanePath(panePath: string, entity: { name: string; path?: string; id?: string }): string {
  if (entity.path) {
    let p = entity.path.replace(/\\/g, '/');
    if (p.startsWith('drive-')) p = '/' + p.slice(6);
    const normalized = normalizePanePath(p);
    if (!isUriJunkPath(normalized)) return normalized;
  }
  if (entity.id?.startsWith('drive-')) {
    return normalizePanePath('/' + entity.id.slice(6));
  }
  const base = normalizePanePath(panePath).replace(/\/$/, '');
  return `${base}/${entity.name}`;
}

/** Find entity by GUID id across all cached directory listings */
export function findEntityInCache(
  cache: Record<string, any[]>,
  id: string | null
): any | null {
  if (!id) return null;
  for (const items of Object.values(cache)) {
    const found = items?.find((i: any) => i.id === id);
    if (found) return found;
  }
  return null;
}

/** Safe locale date formatting — avoids "Invalid Date" in preview panel */
export function formatFsDate(value: string | number | Date | null | undefined): string {
  if (!value) return '--';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '--' : d.toLocaleString();
}
