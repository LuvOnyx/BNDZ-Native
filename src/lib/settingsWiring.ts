import type { AppConfig } from '../data/configContext';
import { KEYBINDING_ACTIONS, resolveShortcut } from './keybindings';
import { SETTINGS_DEFAULTS } from './settingsDefaults';

/** CamelCase → kebab-case for data-bndz-* attributes */
export function configKeyToDataset(key: string): string {
  return key.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
}

/** Mirror every settings key to documentElement dataset for CSS + runtime readers */
export function syncAllSettingsToDocument(config: AppConfig): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const merged = { ...SETTINGS_DEFAULTS, ...config };

  for (const key of Object.keys(SETTINGS_DEFAULTS)) {
    const val = merged[key as keyof typeof merged];
    const attr = `bndz${configKeyToDataset(key).replace(/-/g, '')}`;
    if (val === undefined || val === null) {
      delete root.dataset[attr];
    } else if (typeof val === 'boolean') {
      root.dataset[attr] = val ? 'true' : 'false';
    } else if (typeof val === 'object') {
      root.dataset[attr] = JSON.stringify(val);
    } else {
      root.dataset[attr] = String(val);
    }
  }
}

export function readSettingBool(config: AppConfig, key: string, fallback = false): boolean {
  const v = config[key as keyof AppConfig];
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  const def = SETTINGS_DEFAULTS[key];
  return typeof def === 'boolean' ? def : fallback;
}

export function readSettingNumber(config: AppConfig, key: string, fallback = 0): number {
  const v = config[key as keyof AppConfig];
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  const n = parseFloat(String(v ?? ''));
  if (!Number.isNaN(n)) return n;
  const def = SETTINGS_DEFAULTS[key];
  return typeof def === 'number' ? def : fallback;
}

export function readSettingString(config: AppConfig, key: string, fallback = ''): string {
  const v = config[key as keyof AppConfig];
  if (typeof v === 'string') return v;
  if (v != null) return String(v);
  const def = SETTINGS_DEFAULTS[key];
  return typeof def === 'string' ? def : fallback;
}

/** Keyboard shortcut map from config keys — respects customKeyboardShortcuts toggle. */
export function buildKeyboardMap(config: AppConfig): Record<string, string> {
  const useCustom = readSettingBool(config, 'customKeyboardShortcuts', true);
  const map: Record<string, string> = {};
  for (const action of KEYBINDING_ACTIONS) {
    map[action.id] = useCustom
      ? resolveShortcut(config as Record<string, unknown>, action)
      : action.default;
  }
  map.preview = useCustom
    ? readSettingString(config, 'previewShortcut', 'Alt+P')
    : 'Alt+P';
  return map;
}

/** Mouse / usability flags */
export function buildMouseRuntime(config: AppConfig) {
  return {
    singleClickOpen: readSettingBool(config, 'openItemsOnSingleClick')
      || readSettingBool(config, 'singleClickToOpenAnItem'),
    doubleClickOpen: readSettingBool(config, 'openItemsOnDoubleClick', true),
    activateOnMiddleClick: readSettingBool(config, 'activateTabOnMiddleClick'),
    hoverSelect: readSettingBool(config, 'selectListItemsOnMouseHover'),
    highlightHovered: readSettingBool(config, 'highlightHoveredItems'),
    fullRowSelect: readSettingBool(config, 'fullNameColumnSelect'),
    alsoFullRow: readSettingBool(config, 'alsoOnFullRowSelect'),
    dragByThumbnail: readSettingBool(config, 'allowDraggingItemsByTheThumbnail'),
    disallowDragFromList: readSettingBool(config, 'disallowLeftDraggingFromFileList'),
    disallowDragFromTree: readSettingBool(config, 'disallowLeftDraggingFromFolderTree'),
    bindings: config.mouseBindings,
  };
}

/** Search / find runtime */
export function buildSearchRuntime(config: AppConfig) {
  return {
    globalPrefix: readSettingBool(config, 'enableGlobalSearchPrefix', true),
    limit: readSettingNumber(config, 'globalSearchLimit', 200),
    typeAhead: readSettingBool(config, 'enableTypeAheadFind', true),
    typeAheadMatch: readSettingString(config, 'typeAheadFindMatch', 'Match at beginning'),
    allowRepeatedCharacters: readSettingBool(config, 'allowRepeatedCharacters', true),
    useSortedColumn: readSettingBool(config, 'useSortedColumn', false),
    redirectTypingToFilter: readSettingBool(config, 'redirectTypingToLiveFilterBox', false),
    instantFilter: readSettingBool(config, 'instantFilterOnTyping'),
    ignoreDiacritics: readSettingBool(config, 'ignoreDiacritics'),
    searchSubfolders: readSettingBool(config, 'searchSubfolders'),
    searchContent: readSettingBool(config, 'searchFileContent'),
  };
}

/** Shell integration */
export function buildShellRuntime(config: AppConfig) {
  return {
    useCustomContextMenu: true,
    mergeNativeShellVerbs: readSettingBool(config, 'useNativeOSContextMenu') || readSettingBool(config, 'nativeContextMenu'),
    enableSubmenus: readSettingBool(config, 'enableContextSubmenus'),
    injectGlobalMenu: readSettingBool(config, 'injectGlobalContextMenu'),
    isDefaultManager: readSettingBool(config, 'isDefaultFileManager') || readSettingBool(config, 'bndzIsDefaultFileManager'),
    inContextMenu: readSettingBool(config, 'inContextMenu') || readSettingBool(config, 'bndzInShellContextMenu'),
    overrideWin11More: readSettingBool(config, 'overrideWin11MoreOptions'),
    confirmDelete: readSettingBool(config, 'confirmDeleteOperations', true),
    confirmMove: readSettingBool(config, 'confirmCopyAndMoveOperations'),
    confirmDrag: readSettingBool(config, 'confirmDragAndDrop'),
    suppressDeleteConfirm: readSettingBool(config, 'suppressDeleteConfirmationDialog'),
    bypassRecycle: readSettingBool(config, 'bypassRecycleBin'),
    deleteToRecycle: readSettingBool(config, 'deleteToRecycleBin', true),
  };
}

/** File transfer / undo engine */
export function buildFileOpsRuntime(config: AppConfig) {
  const engine = readSettingString(config, 'fileOperationEngine', 'native');
  const useNative = engine === 'native' || engine === 'windows';
  const singleStepRaw = config.allowOnlySingleStepUndoRedo;
  const singleStepUndo = singleStepRaw === true
    || (typeof singleStepRaw === 'string' && singleStepRaw.toLowerCase().includes('single step'));
  const promptRaw = config.promptBeforeUndoRedo;
  let promptUndoRedo: 'never' | 'always' | 'if_old' = 'if_old';
  if (promptRaw === true || promptRaw === 'Always') promptUndoRedo = 'always';
  else if (promptRaw === false || promptRaw === 'Never') promptUndoRedo = 'never';
  return {
    engine: useNative ? 'native' as const : 'bndz' as const,
    useNativeEngine: useNative,
    queueOperations: readSettingBool(config, 'queueFileOperations', true),
    backgroundProcessing: readSettingBool(config, 'enableBackgroundProcessing', true),
    logActions: readSettingBool(config, 'logActionsAndEnableUndoRedo', true),
    singleStepUndo,
    promptUndoRedo,
    maxActionLogEntries: readSettingNumber(config, 'allowedNumberOfEntriesInTheActionLog', 100),
    rememberActionLog: readSettingBool(config, 'rememberTheLoggedActionsBetweenSessions', false),
    persistActionLogOnExit: readSettingBool(config, 'evenOnExitWithoutSaving', false),
    showTransferPanel: readSettingBool(config, 'showTransferQueuePanel', true),
    showTransferSpeedEta: readSettingBool(config, 'showTransferSpeedEta', true),
  };
}

/** UI chrome / layout */
export function buildUiRuntime(config: AppConfig) {
  return {
    fontSize: readSettingNumber(config, 'fontSize', 12),
    fontFamily: readSettingString(config, 'uiFontFamily', 'Segoe UI, system-ui, sans-serif'),
    fontFamilyMono: readSettingString(config, 'uiFontFamilyMono', 'Cascadia Code, Consolas, monospace'),
    tabFontSize: readSettingNumber(config, 'tabFontSize', 11),
    tabBarHeight: readSettingNumber(config, 'tabBarHeight', 28),
    rowHeight: readSettingNumber(config, 'rowHeight', 22),
    showMenubar: readSettingBool(config, 'showTopMenubar'),
    showToolbar: readSettingBool(config, 'showToolbar', true),
    showStatusBar: readSettingBool(config, 'showStatusBar', true),
    rightSidebar: readSettingBool(config, 'rightSidebarEnabled', true),
    previewPanel: readSettingBool(config, 'previewPanelEnabled', true),
    bottomPanel: readSettingBool(config, 'bottomPanelEnabled', true),
    treePanel: readSettingBool(config, 'treePanelEnabled', true),
    compactMode: readSettingBool(config, 'compactMode'),
    adaptiveColors: readSettingBool(config, 'adaptiveColors'),
    theme: readSettingString(config, 'theme', 'Dark'),
    applyColors: readSettingBool(config, 'applyColors'),
    applyListStylesGlobally: readSettingBool(config, 'applyListStylesGlobally'),
    applyTextColorsNameOnly: readSettingBool(config, 'applyTextColorsToTheNameColumnOnly'),
  };
}

/** Keys that only exist for dataset dump / future work — not product behavior. */
export const DATASET_ONLY_KEY_HINT =
  'Many Configuration keys sync to document.dataset for diagnostics; only keys consumed by settingsRuntime / feature code affect behavior.';

/** Count of keys that have defaults — NOT proof they are behavior-wired. */
export const SETTINGS_DEFAULT_KEY_COUNT = Object.keys(SETTINGS_DEFAULTS).length;

/** @deprecated Misnamed — use SETTINGS_DEFAULT_KEY_COUNT. Dataset sync ≠ wired. */
export const WIRED_KEY_COUNT = SETTINGS_DEFAULT_KEY_COUNT;
