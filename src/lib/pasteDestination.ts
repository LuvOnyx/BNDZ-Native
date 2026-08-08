import type { AppConfig } from '../data/configContext';
import { getListIxBehavior } from './settingsBehavior';
import { joinPanePath, normalizePanePath, toWindowsPath } from './pathUtils';

/**
 * Resolve paste destination: when "Paste to selected list folder" is on and a single
 * selected item is a directory, paste into that folder instead of the pane path.
 */
export function resolvePasteDestination(
  config: AppConfig,
  panePath: string,
  selectedEntities: Array<{ id?: string; type?: string; name?: string; path?: string; isDirectory?: boolean }>,
): string {
  const listIx = getListIxBehavior(config);
  if (!listIx.pasteToSelectedListFolder) return panePath;
  if (!selectedEntities || selectedEntities.length !== 1) return panePath;
  const ent = selectedEntities[0];
  const isDir = ent?.type === 'directory' || ent?.isDirectory === true;
  if (!isDir) return panePath;
  const raw = ent.path || joinPanePath(panePath, { name: ent.name || '' });
  return normalizePanePath(raw) || panePath;
}

export function resolvePasteDestinationWin(
  config: AppConfig,
  panePath: string,
  selectedEntities: Array<{ id?: string; type?: string; name?: string; path?: string; isDirectory?: boolean }>,
): string {
  return toWindowsPath(resolvePasteDestination(config, panePath, selectedEntities));
}
