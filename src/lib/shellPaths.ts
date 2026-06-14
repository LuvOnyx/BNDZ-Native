import { isRecycleBinPath, normalizePanePath, RECYCLE_BIN_PATH, toWindowsPath } from './pathUtils';

/** Windows shell namespace CLSIDs for virtual locations */
export const SHELL_CLSID = {
  recycleBin: '::{645FF040-5081-101B-9F08-00AA002F954E}',
  thisPc: '::{20D04FE0-3AEA-1069-A2D8-08002B30309D}',
  network: '::{F02C1A0D-BE21-4350-88B0-7367FC96EF3C}',
  libraries: '::{031E4825-7B94-4DC3-B131-E946B44C8DD5}',
} as const;

/** Windows shell: known-folder names for native library icons */
export const KNOWN_FOLDER_SHELL: Record<string, string> = {
  Desktop: 'shell:Desktop',
  Documents: 'shell:Personal',
  Downloads: 'shell:Downloads',
  Pictures: 'shell:My Pictures',
  Music: 'shell:My Music',
  Videos: 'shell:My Video',
  Gallery: 'shell:PicturesLibrary',
  Home: 'shell:Profile',
};

/** Canonical pane path from backend shortcut or tree path */
export function toPanePath(path: string | null | undefined): string {
  if (!path) return '/';
  let p = path.replace(/\\/g, '/');
  if (isRecycleBinPath(p)) return RECYCLE_BIN_PATH;
  if (p.startsWith('shell:')) return `/${p}`;
  if (/^[A-Za-z]:\//.test(p) || /^[A-Za-z]:$/.test(p)) return normalizePanePath(`/${p}`);
  if (p.startsWith('//') || p.startsWith('\\\\')) {
    const unc = p.replace(/^\/+/, '').replace(/\//g, '/');
    return unc.startsWith('//') ? unc : `//${unc}`;
  }
  return normalizePanePath(p.startsWith('/') ? p : `/${p}`);
}

export function isDriveRootPanePath(path: string | null | undefined): boolean {
  const p = normalizePanePath(path);
  return /^\/[A-Za-z]:$/.test(p);
}

export function isNetworkPanePath(path: string | null | undefined): boolean {
  if (!path) return false;
  const p = path.replace(/\\/g, '/');
  return p === '\\\\' || p === '//' || p === '/' + '//' || p.startsWith('//') || p.startsWith('\\\\');
}

/** Resolve a pane/UI path to a Windows shell path suitable for icon fetch & properties */
export function resolveShellIconPath(path: string | null | undefined): string {
  if (!path) return '';
  if (path.startsWith('::{')) return path;
  if (path.toLowerCase().startsWith('shell:')) return path;
  if (isRecycleBinPath(path)) return SHELL_CLSID.recycleBin;
  const pane = normalizePanePath(path);
  if (pane === '/shell:Libraries' || pane.toLowerCase() === '/shell:libraries') return SHELL_CLSID.libraries;
  if (pane === '/') return SHELL_CLSID.thisPc;
  if (pane === '//' || pane === '\\\\') return SHELL_CLSID.network;
  if (isDriveRootPanePath(pane)) {
    const win = toWindowsPath(pane);
    return win.endsWith('\\') ? win : `${win}\\`;
  }
  const win = toWindowsPath(pane);
  if (win.startsWith('\\\\')) return win;
  if (win.toLowerCase().startsWith('shell:')) {
    if (win.toLowerCase() === 'shell:recyclebin') return SHELL_CLSID.recycleBin;
    return win;
  }
  const leaf = pane.split('/').filter(Boolean).pop() || '';
  const known = KNOWN_FOLDER_SHELL[leaf];
  if (known) return known;
  return win;
}

/** Path for shell properties verb — same resolver, ensures drive roots end with backslash */
export function resolveShellPropertiesPath(path: string | null | undefined): string {
  return resolveShellIconPath(path);
}

/** Whether an entity should request a directory shell glyph (drives/CLSID use file/volume icons). */
export function entityShellIsDirectory(entity: { driveInfo?: unknown; id?: string; type?: string } | null | undefined, path: string | null | undefined): boolean {
  if (entity?.driveInfo) return false;
  if (typeof entity?.id === 'string' && entity.id.startsWith('drive-')) return false;
  return shellIconIsDirectory(path);
}

export function shellIconIsDirectory(path: string | null | undefined): boolean {
  if (!path) return true;
  if (path.startsWith('::{')) return false;
  if (path.toLowerCase().startsWith('shell:')) return false;
  if (isRecycleBinPath(path)) return false;
  if (isDriveRootPanePath(path)) return false;
  const pane = normalizePanePath(path);
  if (pane === '/' || pane === '//' || pane === '\\\\') return false;
  if (pane.toLowerCase().startsWith('/shell:')) return false;
  const win = toWindowsPath(pane);
  if (/^[A-Za-z]:\\?$/.test(win)) return false;
  const name = win.split(/[/\\]/).pop() || '';
  if (name.includes('.')) return false;
  return true;
}
