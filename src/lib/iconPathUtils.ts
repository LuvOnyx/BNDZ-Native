import { toWindowsPath } from './pathUtils';
import { ICONIFY_PATH_PREFIX } from './fileTypeIcons';

export function isIconifyLibraryPath(p: string): boolean {
  return !!p && p.startsWith(ICONIFY_PATH_PREFIX);
}

/** Resolve icon library path — always returns absolute Windows path when possible */
export function resolveIconFilePath(icoStr: string, libraryFolder?: string): string {
  if (!icoStr) return '';
  if (isIconifyLibraryPath(icoStr)) return icoStr;
  if (icoStr.startsWith('data:')) return icoStr;
  if (icoStr.includes('[ASSETS]')) return icoStr;

  const normalized = icoStr.replace(/\//g, '\\');
  if (/^[A-Za-z]:\\/.test(normalized) || normalized.startsWith('\\\\')) {
    return normalized;
  }

  if (libraryFolder) {
    const base = toWindowsPath(libraryFolder).replace(/\\$/, '');
    return `${base}\\${normalized.replace(/^\\+/, '')}`;
  }

  return toWindowsPath(icoStr);
}

export function isAbsoluteFsPath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/');
}

/**
 * Pre-apply pipeline shared by Icon Studio grid and the Change Icon context menu:
 * iconify: virtual paths are downloaded + converted to .ico on the backend; raster
 * images (.png/.jpg/...) are converted to .ico. Returns a Windows path ready for
 * SET_SYSTEM_ICON, or null when preparation failed.
 */
export async function prepareIconForApply(iconPath: string): Promise<string | null> {
  if (!iconPath || iconPath.startsWith('data:')) return null;
  const { IPC } = await import('./ipcBridge');
  const { parseIconifyLibraryPath } = await import('./fileTypeIcons');

  if (isIconifyLibraryPath(iconPath)) {
    const iconId = parseIconifyLibraryPath(iconPath);
    if (!iconId) return null;
    const materialized = await IPC.materializeIconifyIcon(iconId);
    return materialized ? materialized.replace(/\//g, '\\') : null;
  }

  // Backend SET_SYSTEM_ICON converts raster images — avoid a separate CONVERT_TO_ICO round-trip
  return iconPath.replace(/\//g, '\\');
}
