import { promptElevationIfNeeded } from './nativeDialog';
import type { AppConfig } from '../data/configContext';
import type { ShellIntegrationResult } from './ipcBridge';

const SHELL_CALL_MS = 45_000;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`IPC timeout: ${label}`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function applyShellSetting(
  label: string,
  apply: () => Promise<ShellIntegrationResult>,
): Promise<ShellIntegrationResult & { elevationCancelled?: boolean }> {
  try {
    const result = await withTimeout(apply(), SHELL_CALL_MS, 'SHELL_INTEGRATION_RESULT');
    if (!result.success && result.needsElevation) {
      // Pass --apply-shell so the elevated instance force-applies ALL pending shell
      // settings from config before the WebView / fingerprint system initialises.
      const elevated = await promptElevationIfNeeded(result, {
        title: 'Administrator approval required',
        message: `${result.message}\n\nRestart BNDZ as administrator to ${label}?\n\nAll Shell Integration settings will be applied on restart.`,
      }, '--apply-shell --elevated');
      if (!elevated) {
        // UAC Cancel -- do not pretend the setting applied; caller must not stamp fingerprint.
        return {
          ...result,
          success: false,
          elevationCancelled: true,
          message: result.message || 'Administrator approval was cancelled.',
        };
      }
    }
    return result;
  } catch (err) {
    // Soft-fail -- never block navigation / settings UI on hung registry writes.
    console.warn(`[shell] ${label} skipped:`, err);
    return { success: false, message: err instanceof Error ? err.message : String(err) };
  }
}

function shellFingerprint(config: AppConfig): string {
  return JSON.stringify({
    fm: !!(config.isDefaultFileManager ?? config.bndzIsDefaultFileManager),
    ctx: !!(config.inContextMenu ?? config.bndzInShellContextMenu),
    scope: String(config.shellIntegrationScope || 'Only for the current user'),
    win11: !!config.overrideWin11MoreOptions,
    gcm: !!(config.injectGlobalContextMenu && config.globalContextMenuActions?.length),
    gcmLen: config.globalContextMenuActions?.length ?? 0,
    iconStudioShell: config.enableIconContextSubmenu !== false,
  });
}

function shellAllUsers(config: AppConfig): boolean {
  const scope = String(config.shellIntegrationScope || '');
  return /all users/i.test(scope);
}

let lastAppliedFingerprint: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingConfig: AppConfig | null = null;
let applyChain: Promise<void> = Promise.resolve();
let _applyInProgress = false;

async function applyBackendSettingsInner(config: AppConfig): Promise<boolean> {
  if (_applyInProgress) return false; // already running -- skip to avoid IPC queue saturation
  _applyInProgress = true;
  let elevationCancelled = false;
  const track = async (
    label: string,
    apply: () => Promise<ShellIntegrationResult>,
  ): Promise<ShellIntegrationResult> => {
    const result = await applyShellSetting(label, apply);
    if (result.elevationCancelled) elevationCancelled = true;
    return result;
  };
  try {
  const { IPC } = await import('./ipcBridge');
  if (!IPC.isNative) { _applyInProgress = false; return false; }

  if (config.clearThumbnailCacheOnExit) {
    const handler = () => {
      void IPC.clearThumbnailCache();
      void IPC.clearIconCache();
    };
    window.removeEventListener('beforeunload', handler);
    window.addEventListener('beforeunload', handler);
  }

  const inContextMenu = !!(config.inContextMenu ?? config.bndzInShellContextMenu);
  const isDefaultFm = !!(config.isDefaultFileManager ?? config.bndzIsDefaultFileManager);
  const allUsers = shellAllUsers(config);

  // Prefer status probe so we skip redundant registry writes that hang the IPC queue.
  let alreadyDefault = false;
  try {
    const status = await withTimeout(IPC.getDefaultFileManagerStatus(), 8_000, 'SHELL_INTEGRATION_RESULT');
    alreadyDefault = !!status?.active;
  } catch {
    /* continue -- apply best-effort */
  }

  if (isDefaultFm && !inContextMenu) {
    await track('enable shell context menu integration', () => IPC.setInContextMenu(true, allUsers));
  }

  if (isDefaultFm !== alreadyDefault) {
    await track(
      isDefaultFm ? 'make BNDZ the default file manager' : 'restore Windows Explorer as default',
      () => IPC.setAsDefaultManager(isDefaultFm),
    );
  }

  await track(
    inContextMenu ? 'add BNDZ to the shell context menu' : 'remove BNDZ from the Windows shell context menu',
    () => IPC.setInContextMenu(inContextMenu, allUsers),
  );
  await track(
    config.overrideWin11MoreOptions ? 'enable classic context menu' : 'disable classic context menu override',
    () => IPC.setWin11MoreOptions(!!config.overrideWin11MoreOptions),
  );

  const iconStudioShell = config.enableIconContextSubmenu !== false;
  await track(
    iconStudioShell ? 'add Icon Studio to the shell context menu' : 'remove Icon Studio from the shell context menu',
    () => IPC.setIconStudioShellMenu(iconStudioShell),
  );

  // Always call deploy -- empty / disabled undeploys lingering HKCU shell\BNDZ keys.
  try {
    const actions = (config.injectGlobalContextMenu && config.globalContextMenuActions?.length)
      ? config.globalContextMenuActions.map((a: any) => ({
          id: a.id,
          label: a.name || a.label,
          command: a.command || '',
          icon: a.icon || '',
          targetMode: a.targetMode || 'all',
        }))
      : [];
    await withTimeout(
      IPC.updateGlobalContextMenu(actions),
      8_000,
      'UPDATE_GLOBAL_CONTEXT_MENU_RESULT',
    );
  } catch { /* best effort */ }
    return !elevationCancelled;
  } finally {
    _applyInProgress = false;
  }
}

/** Debounced shell apply -- skips when fingerprint unchanged to avoid IPC spam/timeouts. */
export function scheduleBackendSettings(config: AppConfig, force = false): void {
  pendingConfig = config;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const cfg = pendingConfig;
    pendingConfig = null;
    if (!cfg) return;

    const fp = shellFingerprint(cfg);
    // `force` clears the fingerprint gate so elevated relaunch / explicit Settings toggles
    // always rewrite HKLM/HKCU even when the in-memory fingerprint matches.
    if (force) lastAppliedFingerprint = null;
    if (fp === lastAppliedFingerprint) return;

    applyChain = applyChain
      .then(() => applyBackendSettingsInner(cfg))
      .then((ok) => {
        // Only stamp fingerprint when elevation was not cancelled -- otherwise Settings
        // would skip re-apply and leave HKCU/HKLM out of sync with the toggled UI.
        if (ok) lastAppliedFingerprint = fp;
      })
      .catch(err => {
        console.warn('[shell] applyBackendSettings failed:', err);
      });
  }, force ? 0 : 650);
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
