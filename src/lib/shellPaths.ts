import { isRecycleBinPath, joinPanePath, normalizePanePath, RECYCLE_BIN_PATH, toWindowsPath } from './pathUtils';
import { isMeshPath } from './meshPaths';
import { isVirtualCatalogPath } from './virtualPaths';
import { isBndzVirtualPath, isBndzRamWritablePath } from './bndzVirtualViews';

/** Paths that must never hit Windows shell extract (fake local paths → white file glyph). */
export function isNonFsShellIconPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const n = path.replace(/\\/g, '/');
  if (isMeshPath(n)) return true;
  if (isVirtualCatalogPath(n)) return true;
  if (/^\/cloud(\/|$)/i.test(n)) return true;
  // Smart / BNDZ virtual views — but RAM zone mounts are real FS and should extract.
  if (isBndzVirtualPath(n) && !isBndzRamWritablePath(n)) return true;
  return false;
}

/** Windows shell namespace CLSIDs for virtual locations */
export const SHELL_CLSID = {
  recycleBin: '::{645FF040-5081-101B-9F08-00AA002F954E}',
  thisPc: '::{20D04FE0-3AEA-1069-A2D8-08002B30309D}',
  network: '::{F02C1A0D-BE21-4350-88B0-7367FC96EF3C}',
  libraries: '::{031E4825-7B94-4DC3-B131-E946B44C8DD5}',
  controlPanel: '::{26EE0668-A00A-44D7-9371-BEB064C98683}',
  portableDevices: '::{35786D3C-B076-497C-A057-7DCC04A3D85}',
  /** Personal OneDrive shell folder — FS path alone yields a generic yellow folder. */
  oneDrive: '::{018D5C66-4533-4307-9B53-224DE2ED1FE6}',
} as const;

/** Canonical virtual pane path for Control Panel */
export const CONTROL_PANEL_PATH = '/shell:ControlPanel';

export function isControlPanelPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const p = normalizePanePath(path);
  const lower = p.replace(/^\//, '').toLowerCase();
  return p.toLowerCase() === CONTROL_PANEL_PATH.toLowerCase()
    || lower === 'shell:controlpanel'
    || p === SHELL_CLSID.controlPanel
    || lower === SHELL_CLSID.controlPanel.toLowerCase();
}

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

/** Friendly name → canonical shell pane path (address bar / quick navigation). */
export const SPECIAL_FOLDER_PANE_PATHS: Record<string, string> = {
  desktop: '/shell:Desktop',
  documents: '/shell:Personal',
  downloads: '/shell:Downloads',
  pictures: '/shell:My Pictures',
  music: '/shell:My Music',
  videos: '/shell:My Video',
  home: '/bndz/home',
  continuum: '/bndz/home',
  'bndz home': '/bndz/home',
  start: '/bndz/home',
  profile: '/shell:Profile',
  gallery: '/shell:PicturesLibrary',
  libraries: '/shell:Libraries',
  'control panel': CONTROL_PANEL_PATH,
  controlpanel: CONTROL_PANEL_PATH,
  'this pc': '/',
  'recycle bin': RECYCLE_BIN_PATH,
  network: '//',
  recent: '/bndz/recent',
  recents: '/bndz/recent',
  'recent files': '/bndz/recent',
  media: '/bndz/media',
  'large files': '/bndz/large',
  'smart views': '/bndz',
};

/** Bare aliases → Windows env vars (expanded via host before navigation). */
export const ENV_PATH_ALIASES: Record<string, string> = {
  appdata: '%AppData%',
  localappdata: '%LocalAppData%',
  temp: '%TEMP%',
  tmp: '%TEMP%',
  windir: '%WINDIR%',
  systemroot: '%SystemRoot%',
  system32: '%WINDIR%\\System32',
  programfiles: '%ProgramFiles%',
  'program files': '%ProgramFiles%',
  'programfiles(x86)': '%ProgramFiles(x86)%',
  'program files (x86)': '%ProgramFiles(x86)%',
  commonprogramfiles: '%CommonProgramFiles%',
  userprofile: '%USERPROFILE%',
  public: '%PUBLIC%',
  homedrive: '%HOMEDRIVE%',
  homepath: '%HOMEPATH%',
};

/** shell: known-folder pane → GET_SYSTEM_SHORTCUTS name */
export const SHELL_PANE_TO_SHORTCUT_NAME: Record<string, string> = {
  '/shell:desktop': 'Desktop',
  '/shell:personal': 'Documents',
  '/shell:downloads': 'Downloads',
  '/shell:my pictures': 'Pictures',
  '/shell:my music': 'Music',
  '/shell:my video': 'Videos',
  '/shell:pictureslibrary': 'Gallery',
  '/shell:profile': 'Home',
  '/shell:home': 'Home',
};

/**
 * Map `/shell:Desktop` (etc.) to the real filesystem pane path from system shortcuts
 * so tabs/address bar show `C:\Users\…\Desktop` instead of `shell:Desktop`.
 */
export function resolveShellKnownFolderToFs(
  panePath: string,
  shortcuts: Array<{ name?: string; path?: string }> = [],
): string {
  const pane = normalizePanePath(panePath);
  const name = SHELL_PANE_TO_SHORTCUT_NAME[pane.toLowerCase()];
  if (!name) return pane;
  const sc = shortcuts.find(s => s.name === name && s.path);
  if (!sc?.path) return pane;
  const raw = String(sc.path);
  if (/^shell:/i.test(raw)) return pane;
  return toPanePath(raw);
}

/** True for canonical shell known-folder roots like /shell:Desktop (not compound paths). */
export function isShellKnownFolderRoot(path: string | null | undefined): boolean {
  if (!path) return false;
  const pane = normalizePanePath(path);
  if (isRecycleBinPath(pane)) return true;
  const lower = pane.toLowerCase();
  if (!lower.startsWith('/shell:')) return false;
  const rest = pane.slice('/shell:'.length);
  return !rest.includes('/');
}

/** Parent pane path when going up from a shell known-folder root. */
export function shellKnownFolderParent(path: string): string {
  const lower = normalizePanePath(path).toLowerCase();
  if (lower === '/shell:libraries') return '/';
  if (lower === '/shell:controlpanel') return '/';
  if (lower === '/shell:profile' || lower === '/shell:home') return '/';
  if (isShellKnownFolderRoot(path)) return '/shell:Profile';
  if (lower.startsWith('/shell:')) return '/';
  return '/';
}

/** Resolve navigation target for a list/tree entity (avoids /shell:Desktop/foo bugs). */
export function resolveEntityPanePath(
  panePath: string,
  entity: { name: string; path?: string; type?: string; isShellItem?: boolean } | null | undefined,
): string {
  if (!entity) return panePath;
  if (entity.path) return toPanePath(entity.path);
  const normPane = normalizePanePath(panePath);
  if (normPane === '/' || normPane === '/this-pc') {
    if (typeof entity.name === 'string' && entity.name.startsWith('/')) return toPanePath(entity.name);
    return toPanePath(`/${entity.name}`);
  }
  return joinPanePath(panePath, entity);
}

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
  if (isRecycleBinPath(path)) return SHELL_CLSID.recycleBin;
  const pane = normalizePanePath(path);

  // /shell:Desktop/file.png → expand known folder then join leaf (never pass shell:Desktop\file to host).
  if (pane.toLowerCase().startsWith('/shell:')) {
    const rest = pane.slice('/shell:'.length);
    const slash = rest.indexOf('/');
    if (slash < 0) {
      const token = `shell:${rest}`;
      if (token.toLowerCase() === 'shell:recyclebin') return SHELL_CLSID.recycleBin;
      if (token.toLowerCase() === 'shell:libraries') return SHELL_CLSID.libraries;
      if (token.toLowerCase() === 'shell:controlpanel') return SHELL_CLSID.controlPanel;
      if (token.toLowerCase() === 'shell:portabledevices') return SHELL_CLSID.portableDevices;
      return token;
    }
    const folderToken = `shell:${rest.slice(0, slash)}`;
    const leaf = rest.slice(slash + 1).replace(/\//g, '\\');
    // Prefer leaving compound shell paths as shell:Folder\leaf for host ResolveForShell.
    return leaf ? `${folderToken}\\${leaf}` : folderToken;
  }

  if (pane === '/shell:Libraries' || pane.toLowerCase() === '/shell:libraries') return SHELL_CLSID.libraries;
  if (isControlPanelPath(pane)) return SHELL_CLSID.controlPanel;
  if (pane === '/shell:PortableDevices' || pane.toLowerCase() === '/shell:portabledevices') return SHELL_CLSID.portableDevices;
  if (pane === '/') return SHELL_CLSID.thisPc;
  if (pane === '//' || pane === '\\\\') return SHELL_CLSID.network;
  if (isDriveRootPanePath(pane)) {
    const win = toWindowsPath(pane);
    return win.endsWith('\\') ? win : `${win}\\`;
  }
  if (path.toLowerCase().startsWith('shell:')) {
    if (path.toLowerCase() === 'shell:recyclebin') return SHELL_CLSID.recycleBin;
    return path;
  }
  const win = toWindowsPath(pane);
  if (win.startsWith('\\\\')) return win;
  if (win.toLowerCase().startsWith('shell:')) {
    if (win.toLowerCase() === 'shell:recyclebin') return SHELL_CLSID.recycleBin;
    return win;
  }
  // Keep real FS paths as-is for icon extract. Remapping leaf names like
  // Documents → shell:Personal produced generic white file glyphs.
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
  // Trust explicit directory typing even when the name contains dots (e.g. "foo.bar").
  const t = (entity?.type || '').toLowerCase();
  if (t === 'directory' || t === 'folder' || t === 'dir') return true;
  if (t === 'file') return false;
  return shellIconIsDirectory(path);
}

export function shellIconIsDirectory(path: string | null | undefined): boolean {
  if (!path) return true;
  if (path.startsWith('::{')) return false;
  if (isRecycleBinPath(path)) return false;
  if (isDriveRootPanePath(path)) return false;
  const lower = path.toLowerCase().replace(/^\//, '');
  // Mesh remote + virtual catalogs are folders unless the leaf looks like a file with ext.
  const pane = normalizePanePath(path);
  if (pane === '/mesh' || pane.startsWith('/mesh/')) {
    // /mesh and /mesh/{hostId} are containers; deeper leaves with an extension are files.
    const parts = pane.split('/').filter(Boolean);
    if (parts.length <= 2) return true;
    const leaf = parts[parts.length - 1] || '';
    return !leaf.includes('.');
  }
  if (pane === '/vf' || pane.startsWith('/vf/')) return true;
  // Known-folder shell tokens (Desktop, Downloads, …) are directories — query them as such
  // so the tree gets the real special-folder glyph instead of a white file placeholder.
  if (lower.startsWith('shell:')) {
    const token = `shell:${lower.slice(6).split(/[/\\]/)[0]}`;
    const known = Object.values(KNOWN_FOLDER_SHELL).some(v => v.toLowerCase() === token);
    if (known) return true;
    // Control Panel / other virtual shell names are not directories.
    return false;
  }
  if (pane === '/' || pane === '//' || pane === '\\\\') return false;
  if (pane.toLowerCase().startsWith('/shell:')) {
    const shellKey = pane.slice(1).toLowerCase();
    return Object.values(KNOWN_FOLDER_SHELL).some(v => v.toLowerCase() === shellKey);
  }
  const win = toWindowsPath(pane);
  if (/^[A-Za-z]:\\?$/.test(win)) return false;
  const name = win.split(/[/\\]/).pop() || '';
  if (name.includes('.')) return false;
  return true;
}
