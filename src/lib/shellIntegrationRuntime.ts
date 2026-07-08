import { promptElevationIfNeeded } from './nativeDialog';
import type { AppConfig } from '../data/configContext';
import type { ShellIntegrationResult } from './ipcBridge';

async function applyShellSetting(
  label: string,
  apply: () => Promise<ShellIntegrationResult>,
): Promise<ShellIntegrationResult> {
  const result = await apply();
  if (!result.success && result.needsElevation) {
    await promptElevationIfNeeded(result, {
      title: 'Administrator approval required',
      message: `${result.message}\n\nRestart BNDZ as administrator to ${label}?`,
    });
  }
  return result;
}

export async function applyBackendSettings(config: AppConfig): Promise<void> {
  const { IPC } = await import('./ipcBridge');
  if (!IPC.isNative) return;

  if (config.clearThumbnailCacheOnExit) {
    const handler = () => { IPC.clearIconCache(); };
    window.removeEventListener('beforeunload', handler);
    window.addEventListener('beforeunload', handler);
  }

  const inContextMenu = !!(config.inContextMenu ?? config.bndzInShellContextMenu);
  const isDefaultFm = !!(config.isDefaultFileManager ?? config.bndzIsDefaultFileManager);

  if (isDefaultFm && !inContextMenu) {
    await applyShellSetting('enable shell context menu integration', () => IPC.setInContextMenu(true));
  }

  await applyShellSetting(
    isDefaultFm ? 'make BNDZ the default file manager' : 'restore Windows Explorer as default',
    () => IPC.setAsDefaultManager(isDefaultFm),
  );
  await applyShellSetting(
    inContextMenu ? 'add BNDZ to the shell context menu' : 'remove BNDZ from the shell context menu',
    () => IPC.setInContextMenu(inContextMenu),
  );
  await applyShellSetting(
    config.overrideWin11MoreOptions ? 'enable classic context menu' : 'disable classic context menu override',
    () => IPC.setWin11MoreOptions(!!config.overrideWin11MoreOptions),
  );

  if (config.injectGlobalContextMenu && config.globalContextMenuActions?.length) {
    IPC.updateGlobalContextMenu(config.globalContextMenuActions.map((a: any) => ({
      id: a.id,
      label: a.name || a.label,
      command: a.command || '',
      icon: a.icon || '',
      targetMode: a.targetMode || 'all',
    })));
  }
}
