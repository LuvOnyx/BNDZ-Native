/**
 * Maps ConfigurationDialog keys to runtime consumer categories + wiring status.
 * Unknown keys are DEFERRED (never auto-wired). Only explicit WIRED_KEYS count as wired.
 */
export type SettingsConsumer =
  | 'list' | 'sort' | 'tree' | 'preview' | 'thumbnail' | 'tabs' | 'pane'
  | 'operations' | 'search' | 'shell' | 'colors' | 'tags' | 'rename'
  | 'keyboard' | 'toolbar' | 'persisted' | 'backend' | 'spatial' | 'automation' | 'ui';

import { SETTINGS_DEFAULTS } from './settingsDefaults';
import { SETTINGS_KEY_ALIASES } from './settingsKeyAliases';

const LIST_KEYS = new Set([
  'showFileExtensions', 'autoSelectFirstItem', 'selectLastUsedSubfolder',
  'selectNextItemAfterDeleteAndMove', 'addNewItemsAtTheEndOfTheList',
  'alwaysShowFolderSizes', 'autoSyncFolderSizes', 'cacheFolderSizes', 'showCachedFolderSizesOnly',
  'enableIconifyFileIcons', 'showCachedIconsOnly', 'listColumnVisibility', 'listColumnWidths',
  'listColumnWidthsByPath',
  'tutorialCompleted', 'tutorialNeverShow',
  'showItemCountWithFolderSizes', 'wrapAroundList', 'showTagsInFileList',
  'showRelativePathInPathColumn', 'underlineSelectedRows', 'verticalGridLinesInDetailsView',
  'showSortHeadersInAllViews', 'applyColorFiltersToTheList', 'enableColorFilters',
  'highlightHoveredItems', 'selectListItemsOnMouseHover', 'fullNameColumnSelect',
  'alsoOnFullRowSelect', 'drawHiddenIconsGhosted', 'showMessageWhenListIsEmpty',
  'useGenericIconsForSuperFastBrowsing', 'ignoreDiacritics', 'showHiddenSystemFoldersInTree',
  'showImplicitSecondarySortOrderArrow', 'listShowSelectionHighlight', 'listShowSelectionCheckboxes',
  'stickyGroupHeaders', 'listZebraStyle', 'listSelectionBorderStyle', 'listSelectionChromeStyle',
  'listSelectionFillStyle', 'listHoverFadeSteps', 'listHoverFadeMs', 'listSelectionOpacity',
  'listHoverOpacity', 'listInactiveOpacity', 'listGridLineWidth', 'listSortArrowSize',
  'columnAutosizeMinWidth', 'columnAutosizeMaxWidth', 'columnAutosizeNameMaxWidth',
  'columnAutosizeNameMinWidth', 'columnAutosizeRightMargin', 'columnAutosizeExtraPadding',
  'highlightMatches', 'matchCase', 'delayBeforeFilterIsApplied', 'typeAheadFindMatch',
  'enableSurroundSelection', 'truncateFilenamesInTheMiddle',
]);

const SORT_KEYS = new Set([
  'sortMethod', 'sortFoldersApart', 'keepFoldersOnTop', 'sortFoldersFirst',
  'sortFoldersAlwaysAscending', 'mixedSortOnDateColumns', 'mixedSortOnTagColumns',
  'mixedSortOnPathColumns', 'sortFilenamesByBase', 'treatHyphensAndApostrophesLikeNormalCharacters',
  'sortSizeColumnsDescendingByDefault', 'sortDateColumnsDescendingByDefault',
  'keepCurrentItemInViewAfterResorting', 'scrollToTopAfterResorting',
  'onSortingKeepTaggedItemsOnTop', 'defaultToTreeLikeSortOrder', 'useSortedColumn',
]);

const TREE_KEYS = new Set([
  'showHiddenSystemFoldersInTree', 'autoOptimizeTree', 'expandTreeNodesOnBrowse',
  'expandTreeNodesOnDragOver', 'expandTreeNodesOnSingleClick', 'checkExistenceOfSubfoldersInTree',
  'inNetworkLocationsAsWell', 'rememberStateOfTree', 'showLocalizedFolderNames',
  'selectParentOfMovedFolder', 'selectParentOfDeletedFolder', 'scrollSelectedFolderToTheTop',
  'scrollSubfoldersIntoView', 'lockTreeState', 'skipInvisibleSubfolders', 'applyColorFiltersToTheTree',
  'disallowDeleteByKeyInFolderTree', 'disallowLeftDraggingFromFolderTree', 'expandInTree',
  'allowZombiesInTheMiniTree', 'showMiniTree',
]);

const PREVIEW_KEYS = new Set([
  'previewCategories', 'previewFormats', 'previewAsThumbnail', 'previewDelay',
  'richTransitionAnimations', 'limitOriginalPreviewSize', 'limitOriginalPreviewSizeValue',
  'useNativeHandlingInThePreviewPane', 'audioPreview', 'audioVideoPreview', 'autoplay',
  'folderContentsPreview', 'folderContentsPreviewSortedBy', 'skipVideoPreview',
  'highQualityImageResampling', 'autoRotatePreview', 'previewZoomPercent',
  'compressionPreviewBgColor', 'compressionPreviewFgColor', 'webPathMapSource', 'webPathMapTarget',
  'enableServerMappings', 'modelessDialog',
  // Blow-up / magnifier
  'allowPanning', 'fitWidthOnly', 'fitPopupToScreen', 'fitPopupWidthOnly', 'useWholeScreen',
  'applyZoom', 'applyZoomBlowUpValue', 'onLeftMouseDown', 'onRightMouseDown', 'stayUp',
  'loop', 'forVideosAsWell', 'enableBlowUpsOnFileIconsAsWell',
]);

const THUMBNAIL_KEYS = new Set([
  'enableNativeThumbnails', 'highResNativeWindowsThumbnails', 'showFolderThumbnails',
  'showThumbnailsForRawFiles', 'showThumbnailsForNonImages', 'showThumbnailsInTitlesViews',
  'autoRotateThumbnails', 'showFileIconOnThumbnail', 'cacheThumbnailsOnDisk',
  'showCachedThumbnailsOnly', 'clearThumbnailCacheOnExit', 'thumbnailQuality',
  'thumbnailStyle', 'thumbnailPadding', 'thumbnailCaptionLines', 'thumbnailTransparency',
  'createAllThumbnailsAtOnce', 'thumbnailCachePath', 'thumbnailSizePreset1',
  'thumbnailSizePreset2', 'thumbnailChromeColor', 'alignToBottom',
]);

const TAB_KEYS = new Set([
  'dualPane', 'dualPaneFeature', 'shadeInactivePane', 'alwaysKeep1stPaneVisible',
  'autoSelectMatchingItems', 'autoCreateAnyMissingFolders', 'alsoAutoSelectTabsInTheInactivePane',
  'maximumNumberOfTabs', 'cycleTabsInRecentlyUsedOrder', 'addTabsViaDragAndDropOnTabBar',
  'showTabListButton', 'showXCloseButtonsOnTabs', 'permanentHomeTab',
]);

const OPS_KEYS = new Set([
  'bypassRecycleBin', 'deleteToRecycleBin', 'confirmDeleteOperations', 'confirmCopyAndMoveOperations',
  'autoRefresh', 'respondToFileSystemNotifications', 'refreshDuringFileOperations',
  'dragDropSameVolumeAction', 'dragDropCrossVolumeAction',
  'copyPathsToTheClipboardWithATrailingSlash', 'convertOverlongPathsTo83FormatWhenOpeningFiles',
  'csvFieldSeparator', 'csvOtherSeparator', 'lineFeedOnOversizedFilenames',
  'includeFiles', 'includeBasicItemData', 'appendToExistingFile',
  'addressBar', 'autoCompleteFilter', 'findFilesLocation',
]);

const SEARCH_KEYS = new Set([
  'enableGlobalSearchPrefix', 'globalSearchLimit', 'cacheSearchResults',
  'levelIndent', 'useLocalizedSearchAndFilterPatterns',
]);

const SHELL_KEYS = new Set([
  'shellIntegrationScope', 'inContextMenu', 'isDefaultFileManager', 'bndzInShellContextMenu',
  'bndzIsDefaultFileManager', 'customShellInterpreter', 'customShellArgsTemplate',
  'useCustomCommandLineInterpreterElseDefaultToCmdExe',
]);

const RENAME_KEYS = new Set([
  'preselectName', 'hideExtensionsFromRenameEditBox', 'excludeFileExtensionFromInitialSelection',
  'showNameLengthWhileRenaming', 'serialRenameWithUpAndDownKeys', 'useDialogToRenameSingleItems',
  'allowMoveOnRename', 'resortListImmediatelyAfterRename', 'autoReplaceInvalidCharacters',
  'copyNameSuffixTemplate', 'datedCopyNameTemplate', 'messageSaveNameTemplate',
  'messageSaveNameMaxLen', 'messageSaveNamePad',
]);

const UI_KEYS = new Set([
  'windowTitleTemplate', 'statusBarTemplate', 'useStatusBarTemplate',
  'uiFontFamily', 'uiFontWeight', 'uiFontFamilyMono', 'fontSize', 'rowHeight',
  'listFontLcdAa',
  'uiCornerRadius', 'compactToolbar', 'denseMenubar', 'showPanelAccentBorders',
  'animatePanelTransitions', 'interfaceScale', 'lockBrowserZoom', 'applyColors', 'theme',
  'richTransitionAnimations', 'showFolderSizeOnPropertiesTab',
]);

const SPATIAL_KEYS = new Set([
  'spatialCanvasAutoSave', 'spatialCanvasAutoSaveDelayMs', 'spatialCanvasWheelZoom',
  'spatialCanvasMinZoom', 'spatialCanvasMaxZoom', 'spatialCanvasV2',
]);

const AUTOMATION_KEYS = new Set([
  'automationAutoSave', 'automationAutoSaveDelayMs', 'automationPanOnScroll', 'automationZoomOnScroll',
]);

const TAG_KEYS = new Set([
  'toggleTagsByColumnClick', 'popupByTagColumnsRightClick', 'applyTaggingToAllSelectedItems',
  'confirmCopyingTags', 'autoRefreshTags', 'tagsStorage', 'fileTaggingFeature', 'fileTagging',
]);

const MESH_KEYS = new Set([
  'meshShowInNavTree', 'meshAutoConnectOnBrowse', 'meshDropStunServers', 'meshDropLanDiscovery',
  'meshDropTurnUrl', 'meshDropTurnUsername', 'meshDropTurnCredential',
  'meshDropWebLinkBase', 'meshDropSignalingRelayUrl',
]);

/** Explicit set of keys with non-settings consumers. Unknown ⇒ deferred. */
export const WIRED_KEYS = new Set<string>([
  ...LIST_KEYS, ...SORT_KEYS, ...TREE_KEYS, ...PREVIEW_KEYS, ...THUMBNAIL_KEYS,
  ...TAB_KEYS, ...OPS_KEYS, ...SEARCH_KEYS, ...SHELL_KEYS, ...RENAME_KEYS,
  ...UI_KEYS, ...SPATIAL_KEYS, ...AUTOMATION_KEYS, ...TAG_KEYS, ...MESH_KEYS,
  'catalog', 'userDefinedCommands', 'fileTagging', 'scripting', 'tabsets',
  'customEventActions', 'customColumns', 'customKeyboardShortcuts', 'mouseBindings',
  'commandDeck', 'showQuickActionsBar', 'fluidDragStacks', 'gpuInspection', 'inspectionShaderMode',
  'previewDockedInWorkspace', 'liveShareCursorEnabled', 'rightSidebarEnabled', 'showLensStage',
  'ghostLinkColdStorageRoot', 'ramStagingPreferImDisk',
  // legacy keys still referenced until UI fully migrated (alias targets also wired)
  ...Object.keys(SETTINGS_KEY_ALIASES),
  ...Object.values(SETTINGS_KEY_ALIASES),
]);

// colorConfig* are wired via colors runtime
for (let i = 1; i <= 50; i++) WIRED_KEYS.add(`colorConfig${i}`);

/** Keys still awaiting a dedicated consumer — must shrink toward empty as waves complete. */
export const DEFERRED_KEYS = new Set(
  Object.keys(SETTINGS_DEFAULTS).filter((k) => !WIRED_KEYS.has(k)),
);

export function getSettingsConsumer(key: string): SettingsConsumer {
  if (LIST_KEYS.has(key)) return 'list';
  if (SORT_KEYS.has(key)) return 'sort';
  if (TREE_KEYS.has(key)) return 'tree';
  if (PREVIEW_KEYS.has(key)) return 'preview';
  if (THUMBNAIL_KEYS.has(key)) return 'thumbnail';
  if (TAB_KEYS.has(key)) return 'tabs';
  if (OPS_KEYS.has(key)) return 'operations';
  if (SEARCH_KEYS.has(key)) return 'search';
  if (SHELL_KEYS.has(key)) return 'shell';
  if (RENAME_KEYS.has(key)) return 'rename';
  if (UI_KEYS.has(key) || key.startsWith('colorConfig') || key === 'theme' || key === 'applyColors') return 'colors';
  if (SPATIAL_KEYS.has(key)) return 'spatial';
  if (AUTOMATION_KEYS.has(key)) return 'automation';
  if (TAG_KEYS.has(key)) return 'tags';
  if (MESH_KEYS.has(key)) return 'shell';
  if (key.includes('Tab') || key === 'dualPane' || key === 'dualPaneFeature') return 'tabs';
  if (key.includes('Search')) return 'search';
  if (key.includes('Rename')) return 'rename';
  if (key.includes('ContextMenu') || key.includes('Shell') || key.startsWith('bndz')) return 'shell';
  return 'persisted';
}

export function getSettingWiringStatus(key: string): 'wired' | 'deferred' | 'hidden' {
  if (WIRED_KEYS.has(key)) return 'wired';
  if (key.startsWith('colorConfig')) return 'wired';
  if (DEFERRED_KEYS.has(key)) return 'deferred';
  // Unknown keys are deferred — never auto-wired.
  return 'deferred';
}

export const WIRED_SETTING_COUNT = WIRED_KEYS.size;
export const DEFERRED_SETTING_COUNT = DEFERRED_KEYS.size;
export const SETTINGS_DEFAULT_KEY_COUNT = Object.keys(SETTINGS_DEFAULTS).length;
