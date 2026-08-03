import type { AppConfig } from '../../data/configContext';
import { getWorkIntentPack, type ConfirmStrictness, type WorkIntentId, type WorkIntentPack } from './packs';

export type WorkIntentApplyResult = {
  patch: Partial<AppConfig>;
  pack: WorkIntentPack;
  toast: string;
};

/** Session overlay keys — intent recompiles chrome without permanently wiping user column prefs baseline. */
export function applyWorkIntentPack(
  intentId: WorkIntentId,
  options?: { fromContract?: boolean; installedPluginIds?: ReadonlySet<string> | readonly string[] | null },
): WorkIntentApplyResult {
  const pack = getWorkIntentPack(intentId);
  const patch: Partial<AppConfig> = {
    workIntentId: pack.id,
    workIntentConfirmStrictness: pack.confirmStrictness,
    workIntentPreviewMode: pack.previewMode,
    workIntentPreferredPlugins: pack.preferredPlugins,
    workIntentAutomationGraphId: pack.defaultAutomationGraphId || '',
    listColumnVisibility: {
      ...(pack.columns as Record<string, boolean>),
      name: true,
    },
  };
  if (pack.sortColumn) patch.listSortColumn = pack.sortColumn;
  if (pack.sortDirection) patch.listSortDirection = pack.sortDirection;

  // Only set bottom-panel defaults to a plugin that is actually installed — never toast-spam.
  const installed = !options?.installedPluginIds
    ? null
    : options.installedPluginIds instanceof Set
      ? options.installedPluginIds
      : new Set(options.installedPluginIds);
  const firstInstalled = installed
    ? pack.preferredPlugins.find(id => installed.has(id))
    : undefined;
  if (firstInstalled) {
    patch.bottomPanelDefaultPlugin = firstInstalled;
    patch.bottomPanelLastTab = firstInstalled;
  }

  const src = options?.fromContract ? 'folder contract' : 'menu';
  return {
    patch,
    pack,
    toast: `Intent · ${pack.label} (${src})`,
  };
}

export function intentRequiresStrictConfirm(config: AppConfig): boolean {
  const s = (config.workIntentConfirmStrictness || 'normal') as ConfirmStrictness;
  return s === 'strict';
}

export function intentConfirmStrictness(config: AppConfig): ConfirmStrictness {
  const s = config.workIntentConfirmStrictness;
  if (s === 'relaxed' || s === 'normal' || s === 'strict') return s;
  return 'normal';
}
