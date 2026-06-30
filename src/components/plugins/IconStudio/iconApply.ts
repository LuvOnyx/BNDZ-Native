import { IPC } from '../../../lib/ipcBridge';
import { toWindowsPath } from '../../../lib/pathUtils';
import { prepareIconForApply, resolveIconFilePath } from '../../../lib/iconPathUtils';
import { pushToast } from '../../ToastHost';
import type { IconItem, IconLibrary } from './IconStudioContext';

function resolveTargetType(fullPath: string, hinted?: string): string {
  if (hinted === 'folder' || hinted === 'file' || hinted === 'shortcut') return hinted;
  const normalized = toWindowsPath(fullPath);
  if (/\.lnk$/i.test(normalized)) return 'shortcut';
  const base = normalized.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot > 0 && dot < base.length - 1) {
    const ext = base.slice(dot + 1);
    if (/^[A-Za-z0-9]{1,10}$/.test(ext)) return 'file';
  }
  return 'folder';
}

function normalizeTarget(raw: string, focusedPath: string): string {
  if (raw.includes(':') || raw.startsWith('/') || raw.startsWith('\\')) {
    return toWindowsPath(raw);
  }
  const base = focusedPath.replace(/\/$/, '');
  return toWindowsPath(`${base}/${raw}`);
}

export async function applyIconToTargets(opts: {
  icon: IconItem;
  activeLibrary?: IconLibrary | null;
  selectedItems: string[];
  targetTypes?: string[];
  focusedPath: string;
  allowGlobalOverwrite: boolean;
}): Promise<boolean> {
  const { icon, activeLibrary, selectedItems, targetTypes, focusedPath, allowGlobalOverwrite } = opts;

  if (!selectedItems.length) {
    pushToast({ kind: 'warning', title: 'No targets', message: 'Select folders or files in the file list first.' });
    return false;
  }

  const iconPath = resolveIconFilePath(icon.icoStr, activeLibrary?.sourceFolder);
  if (!iconPath || iconPath.startsWith('data:')) {
    pushToast({ kind: 'error', title: 'Invalid icon', message: 'Could not resolve icon path.' });
    return false;
  }

  const icoPath = await prepareIconForApply(iconPath);
  if (!icoPath) {
    pushToast({ kind: 'error', title: 'Icon prepare failed', message: `Could not prepare "${icon.name}" for apply.` });
    return false;
  }

  let applied = 0;
  let failed = 0;
  let lastError = '';

  for (let i = 0; i < selectedItems.length; i++) {
    const target = normalizeTarget(selectedItems[i], focusedPath);
    try {
      const result = await IPC.setSystemIcon(
        target,
        resolveTargetType(target, targetTypes?.[i]),
        icoPath,
        allowGlobalOverwrite,
      );
      if (result.success) applied++;
      else {
        failed++;
        if (result.error) lastError = result.error;
      }
    } catch (err: any) {
      failed++;
      lastError = err?.message || lastError;
    }
  }

  await IPC.clearIconCache();

  if (failed === 0) {
    pushToast({ kind: 'success', title: 'Icon applied', message: `"${icon.name}" applied to ${applied} item(s).` });
    return true;
  }
  pushToast({
    kind: 'error',
    title: 'Apply incomplete',
    message: lastError || `Applied ${applied}, failed ${failed}.`,
  });
  return false;
}

export async function restoreTargets(opts: {
  selectedItems: string[];
  targetTypes?: string[];
  focusedPath: string;
}): Promise<void> {
  const { selectedItems, targetTypes, focusedPath } = opts;
  if (!selectedItems.length) return;

  let restored = 0;
  let failed = 0;
  for (let i = 0; i < selectedItems.length; i++) {
    const target = normalizeTarget(selectedItems[i], focusedPath);
    try {
      const ok = await IPC.restoreSystemIcon(target, resolveTargetType(target, targetTypes?.[i]));
      if (ok === false) failed++;
      else restored++;
    } catch {
      failed++;
    }
  }
  await IPC.clearIconCache();
  if (failed === 0) {
    pushToast({ kind: 'success', title: 'Icons restored', message: `Default icon restored on ${restored} item(s).` });
  } else {
    pushToast({ kind: 'warning', title: 'Partial restore', message: `Restored ${restored}, failed ${failed}.` });
  }
}
