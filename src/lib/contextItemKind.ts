import { normalizePanePath } from './pathUtils';

/** Primary kind for list/item context menus — drives Open / Open file location / Run as admin. */
export type ContextItemKind = 'folder' | 'file' | 'shortcut' | 'app';

const APP_EXTS = new Set([
  'exe', 'msi', 'bat', 'cmd', 'com', 'ps1', 'msc', 'scr', 'cpl', 'application',
]);

const SHORTCUT_EXTS = new Set(['lnk', 'url']);

export function extensionOfName(name: string | null | undefined): string {
  if (!name) return '';
  const base = name.split(/[/\\]/).pop() || name;
  const i = base.lastIndexOf('.');
  if (i <= 0 || i === base.length - 1) return '';
  return base.slice(i + 1).toLowerCase();
}

export function classifyContextItemKind(opts: {
  isDirectory?: boolean;
  name?: string | null;
  extension?: string | null;
  path?: string | null;
}): ContextItemKind {
  if (opts.isDirectory) return 'folder';
  const ext = (opts.extension || extensionOfName(opts.name) || extensionOfName(opts.path) || '').toLowerCase().replace(/^\./, '');
  if (SHORTCUT_EXTS.has(ext)) return 'shortcut';
  if (APP_EXTS.has(ext)) return 'app';
  return 'file';
}

export function windowsParentFolder(winPath: string): string | null {
  if (!winPath) return null;
  const trimmed = winPath.replace(/[/\\]+$/, '');
  const parent = trimmed.replace(/[/\\][^/\\]+$/, '').replace(/[/\\]+$/, '');
  if (!parent || parent.length < 2) return null;
  return parent;
}

/** Pane path for a Windows folder (used after resolving shortcut targets). */
export function windowsFolderToPanePath(winFolder: string): string {
  const n = winFolder.replace(/\//g, '\\');
  if (n.startsWith('\\\\')) return normalizePanePath(n.replace(/\\/g, '/'));
  return normalizePanePath(`/${n.replace(/\\/g, '/')}`);
}

export type OpenLocationTarget = {
  /** Folder to navigate to inside BNDZ */
  folderPane: string;
  folderWin: string;
  /** Optional file/folder to highlight via Explorer select / future list select */
  selectWin?: string;
  label: string;
};

/** Cross-folder item location (search / virtual) — parent of the item itself. */
export function openLocationForItemParent(itemWin: string, cwdWin: string): OpenLocationTarget | null {
  const parentWin = windowsParentFolder(itemWin);
  if (!parentWin) return null;
  const cwd = (cwdWin || '').replace(/[/\\]+$/, '');
  if (parentWin.toLowerCase() === cwd.toLowerCase()) return null;
  return {
    folderWin: parentWin,
    folderPane: windowsFolderToPanePath(parentWin),
    selectWin: itemWin,
    label: 'Open file location',
  };
}

export type ResolvedShortcutInfo = {
  success: boolean;
  error?: string;
  targetPath?: string;
  locationPath?: string;
  targetExists?: boolean;
  targetIsDirectory?: boolean;
  isUrl?: boolean;
};

/** Shortcut → target's folder (Explorer "Open file location"). */
export function openLocationForShortcut(resolved: ResolvedShortcutInfo | null | undefined): OpenLocationTarget | null {
  if (!resolved?.success) return null;
  if (resolved.isUrl) return null;
  const loc = resolved.locationPath || (resolved.targetPath ? windowsParentFolder(resolved.targetPath) : null);
  if (!loc) return null;
  return {
    folderWin: loc,
    folderPane: windowsFolderToPanePath(loc),
    selectWin: resolved.targetExists && resolved.targetPath && !resolved.targetIsDirectory
      ? resolved.targetPath
      : undefined,
    label: 'Open file location',
  };
}

/** Apps: show location when not already browsing the app's folder (or always prefer select). */
export function openLocationForApp(itemWin: string, _cwdWin: string): OpenLocationTarget | null {
  const parentWin = windowsParentFolder(itemWin);
  if (!parentWin) return null;
  return {
    folderWin: parentWin,
    folderPane: windowsFolderToPanePath(parentWin),
    selectWin: itemWin,
    label: 'Open file location',
  };
}
