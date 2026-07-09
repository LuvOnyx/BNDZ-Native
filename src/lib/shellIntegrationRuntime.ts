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

function shellFingerprint(config: AppConfig): string {
  return JSON.stringify({
    fm: !!(config.isDefaultFileManager ?? config.bndzIsDefaultFileManager),
    ctx: !!(config.inContextMenu ?? config.bndzInShellContextMenu),
    win11: !!config.overrideWin11MoreOptions,
    gcm: !!(config.injectGlobalContextMenu && config.globalContextMenuActions?.length),
    gcmLen: config.globalContextMenuActions?.length ?? 0,
  });
}

let lastAppliedFingerprint: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingConfig: AppConfig | null = null;
let applyChain: Promise<void> = Promise.resolve();

async function applyBackendSettingsInner(config: AppConfig): Promise<void> {
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

/** Debounced shell apply — skips when fingerprint unchanged to avoid IPC spam/timeouts. */
export function scheduleBackendSettings(config: AppConfig, force = false): void {
  pendingConfig = config;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const cfg = pendingConfig;
    pendingConfig = null;
    if (!cfg) return;

    const fp = shellFingerprint(cfg);
    if (!force && fp === lastAppliedFingerprint) return;

    applyChain = applyChain
      .then(() => applyBackendSettingsInner(cfg))
      .then(() => { lastAppliedFingerprint = fp; })
      .catch(err => {
        console.warn('[shell] applyBackendSettings failed:', err);
      });
  }, 450);
}

/** Immediate apply (e.g. after explicit user toggle in Settings). */
export async function applyBackendSettings(config: AppConfig): Promise<void> {
  lastAppliedFingerprint = null;
  scheduleBackendSettings(config, true);
  await applyChain;
}

/** Call after a successful direct shell IPC toggle so startup sync does not re-fire. */
export function markShellIntegrationApplied(config: AppConfig): void {
  lastAppliedFingerprint = shellFingerprint(config);
}
