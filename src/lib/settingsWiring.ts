import type { AppConfig } from '../data/configContext';
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

/** Keyboard shortcut map from config keys */
export function buildKeyboardMap(config: AppConfig): Record<string, string> {
  return {
    copy: readSettingString(config, 'copyShortcut', 'Ctrl+C'),
    cut: readSettingString(config, 'cutShortcut', 'Ctrl+X'),
    paste: readSettingString(config, 'pasteShortcut', 'Ctrl+V'),
    delete: readSettingString(config, 'deleteShortcut', 'Delete'),
    rename: readSettingString(config, 'renameShortcut', 'F2'),
    refresh: readSettingString(config, 'refreshShortcut', 'F5'),
    search: readSettingString(config, 'searchShortcut', 'Ctrl+F'),
    newFolder: readSettingString(config, 'newFolderShortcut', 'Ctrl+Shift+N'),
    preview: readSettingString(config, 'previewShortcut', 'Alt+P'),
    dualPane: readSettingString(config, 'dualPaneShortcut', 'Ctrl+\\'),
  };
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
    typeAhead: readSettingBool(config, 'enableTypeAheadFind'),
    typeAheadMatch: readSettingString(config, 'typeAheadFindMatch', 'Match at beginning'),
    instantFilter: readSettingBool(config, 'instantFilterOnTyping'),
    ignoreDiacritics: readSettingBool(config, 'ignoreDiacritics'),
    searchSubfolders: readSettingBool(config, 'searchSubfolders'),
    searchContent: readSettingBool(config, 'searchFileContent'),
  };
}

/** Shell integration */
export function buildShellRuntime(config: AppConfig) {
  const useNativeOs = readSettingBool(config, 'useNativeOSContextMenu');
  const useCustom = readSettingBool(config, 'useCustomContextMenu', true) && !useNativeOs;
  return {
    useCustomContextMenu: useCustom,
    enableSubmenus: readSettingBool(config, 'enableContextSubmenus'),
    injectGlobalMenu: readSettingBool(config, 'injectGlobalContextMenu'),
    isDefaultManager: readSettingBool(config, 'isDefaultFileManager') || readSettingBool(config, 'bndzIsDefaultFileManager'),
    inContextMenu: readSettingBool(config, 'inContextMenu') || readSettingBool(config, 'bndzInShellContextMenu'),
    overrideWin11More: readSettingBool(config, 'overrideWin11MoreOptions'),
    confirmDelete: readSettingBool(config, 'confirmDeleteOperations', true),
    confirmMove: readSettingBool(config, 'confirmCopyAndMoveOperations'),
    confirmDrag: readSettingBool(config, 'confirmDragAndDrop'),
    bypassRecycle: readSettingBool(config, 'bypassRecycleBin'),
    deleteToRecycle: readSettingBool(config, 'deleteToRecycleBin', true),
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

export const WIRED_KEY_COUNT = Object.keys(SETTINGS_DEFAULTS).length;
