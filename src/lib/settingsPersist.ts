import type { AppConfig, Tabset } from '../data/configContext';

/**
 * Prepare config JSON for disk writes.
 * Honors Settings → Include most-recently-used lists on save.
 * Settings → Backup settings on save is applied by SettingsManager on the host.
 */
export function prepareSettingsForDisk(config: AppConfig): AppConfig {
  const payload = { ...config } as AppConfig;
  // Settings → Include most-recently-used lists on save
  if (!config.includeMostRecentlyUsedListsOnSave) {
    payload.recentFiles = [];
  }
  // Settings → Remember permanent variables
  if (!config.rememberPermanentVariables) {
    payload.permanentVariables = {};
  }
  // Keep the flag on the payload so the native SaveSettings path can honor
  // Settings → Backup settings on save.
  payload.backupSettingsOnSave = !!config.backupSettingsOnSave;
  return payload;
}

/** Settings → Save changes to disk immediately (skip debounce). */
export function settingsFlushDelayMs(config: AppConfig): number {
  return config.saveChangesToDiskImmediately ? 0 : 250;
}

export type TabsetRevertSnapshot = {
  savedTabsets: Tabset[];
  lastActiveTabsetId?: string;
  capturedAt: number;
};

let tabsetPreSaveSnapshot: TabsetRevertSnapshot | null = null;

/**
 * Settings → Tabsets can revert after saving settings.
 * First save after enable captures a restore point; later saves keep that point
 * until the user reverts or clears it. When the option is off, clear any snapshot.
 */
export function noteTabsetsBeforeSettingsSave(config: AppConfig): void {
  if (!config.tabsetsCanRevertAfterSavingSettings) {
    tabsetPreSaveSnapshot = null;
    return;
  }
  if (tabsetPreSaveSnapshot) return;
  tabsetPreSaveSnapshot = {
    savedTabsets: JSON.parse(JSON.stringify(config.savedTabsets || [])) as Tabset[],
    lastActiveTabsetId: config.lastActiveTabsetId,
    capturedAt: Date.now(),
  };
}

export function getTabsetRevertSnapshot(): TabsetRevertSnapshot | null {
  return tabsetPreSaveSnapshot;
}

export function clearTabsetRevertSnapshot(): void {
  tabsetPreSaveSnapshot = null;
}
