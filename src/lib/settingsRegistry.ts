/**
 * Maps ConfigurationDialog keys to runtime consumer categories.
 * Every key in SETTINGS_DEFAULTS is registered here for traceability.
 */
export type SettingsConsumer =
  | 'list' | 'sort' | 'tree' | 'preview' | 'thumbnail' | 'tabs' | 'pane'
  | 'operations' | 'search' | 'shell' | 'colors' | 'tags' | 'rename'
  | 'keyboard' | 'toolbar' | 'persisted' | 'backend';

const LIST_KEYS = new Set([
  'showFileExtensions', 'autoSelectFirstItem', 'selectLastUsedSubfolder',
  'selectNextItemAfterDeleteAndMove', 'addNewItemsAtTheEndOfTheList',
  'alwaysShowFolderSizes', 'autoSyncFolderSizes', 'cacheFolderSizes', 'showCachedFolderSizesOnly',
  'enableIconifyFileIcons', 'showCachedIconsOnly', 'listColumnVisibility', 'listColumnWidths',
  'tutorialCompleted', 'tutorialNeverShow',
  'showItemCountWithFolderSizes', 'wrapAroundList', 'showTagsInFileList',
  'showRelativePathInPathColumn', 'underlineSelectedRows', 'verticalGridLinesInDetailsView',
  'showSortHeadersInAllViews', 'applyColorFiltersToTheList', 'enableColorFilters',
  'highlightHoveredItems', 'selectListItemsOnMouseHover', 'fullNameColumnSelect',
  'alsoOnFullRowSelect', 'drawHiddenIconsGhosted', 'showMessageWhenListIsEmpty',
  'useGenericIconsForSuperFastBrowsing', 'ignoreDiacritics', 'showHiddenSystemFoldersInTree',
]);

const SORT_KEYS = new Set([
  'sortMethod', 'sortFoldersApart', 'keepFoldersOnTop', 'sortFoldersFirst',
  'sortFoldersAlwaysAscending', 'mixedSortOnDateColumns', 'mixedSortOnTagColumns',
  'mixedSortOnPathColumns', 'sortFilenamesByBase', 'treatHyphensAndApostrophesLikeNormalCharacters',
  'sortSizeColumnsDescendingByDefault', 'sortDateColumnsDescendingByDefault',
  'keepCurrentItemInViewAfterResorting', 'scrollToTopAfterResorting',
  'showImplicitSecondarySortOrderArrow', 'onSortingKeepTaggedItemsOnTop',
  'defaultToTreeLikeSortOrder', 'useSortedColumn',
]);

const TREE_KEYS = new Set([
  'showHiddenSystemFoldersInTree', 'autoOptimizeTree', 'expandTreeNodesOnBrowse',
  'expandTreeNodesOnDragOver', 'expandTreeNodesOnSingleClick', 'checkExistenceOfSubfoldersInTree',
  'inNetworkLocationsAsWell', 'rememberStateOfTree', 'showLocalizedFolderNames',
  'selectParentOfMovedFolder', 'selectParentOfDeletedFolder', 'scrollSelectedFolderToTheTop',
  'scrollSubfoldersIntoView', 'lockTreeState', 'skipInvisibleSubfolders', 'applyColorFiltersToTheTree',
  'disallowDeleteByKeyInFolderTree', 'disallowLeftDraggingFromFolderTree', 'expandInTree',
]);

const PREVIEW_KEYS = new Set([
  'previewCategories', 'previewFormats', 'previewAsThumbnail', 'previewDelay',
  'richTransitionAnimations', 'limitOriginalPreviewSize', 'limitOriginalPreviewSizeValue',
  'useNativeHandlingInThePreviewPane', 'audioPreview', 'audioVideoPreview', 'autoplay',
  'folderContentsPreview', 'folderContentsPreviewSortedBy', 'skipVideoPreview',
  'highQualityImageResampling', 'autoRotatePreview',
]);

const THUMBNAIL_KEYS = new Set([
  'enableNativeThumbnails', 'highResNativeWindowsThumbnails', 'showFolderThumbnails',
  'showThumbnailsForRawFiles', 'showThumbnailsForNonImages', 'showThumbnailsInTitlesViews',
  'autoRotateThumbnails', 'showFileIconOnThumbnail', 'cacheThumbnailsOnDisk',
  'showCachedThumbnailsOnly', 'clearThumbnailCacheOnExit', 'thumbnailQuality',
  'thumbnailStyle', 'thumbnailPadding', 'thumbnailCaptionLines', 'thumbnailTransparency',
  'createAllThumbnailsAtOnce', 'enableBlowUpsOnFileIconsAsWell',
]);

export function getSettingsConsumer(key: string): SettingsConsumer {
  if (key === 'catalog' || key === 'customEventActions' || key === 'userDefinedCommands') return 'persisted';
  if (LIST_KEYS.has(key)) return 'list';
  if (SORT_KEYS.has(key)) return 'sort';
  if (TREE_KEYS.has(key)) return 'tree';
  if (PREVIEW_KEYS.has(key)) return 'preview';
  if (THUMBNAIL_KEYS.has(key)) return 'thumbnail';
  if (key.startsWith('colorConfig') || key === 'applyColors' || key === 'theme') return 'colors';
  if (['bypassRecycleBin', 'deleteToRecycleBin', 'confirmDeleteOperations', 'confirmCopyAndMoveOperations',
    'autoRefresh', 'respondToFileSystemNotifications', 'refreshDuringFileOperations'].includes(key)) return 'operations';
  if (key.includes('Search') || key === 'enableGlobalSearchPrefix' || key === 'globalSearchLimit') return 'search';
  if (key.includes('ContextMenu') || key.includes('Shell') || key.startsWith('bndz')) return 'shell';
  if (key.includes('Tab') || key === 'dualPane' || key === 'dualPaneFeature' || key === 'shadeInactivePane') return 'tabs';
  if (key.includes('Rename') || key === 'preselectName' || key === 'hideExtensionsFromRenameEditBox') return 'rename';
  return 'persisted';
}

const WIRED_FEATURE_KEYS = new Set(['catalog', 'userDefinedCommands', 'fileTagging', 'scripting', 'tabsets']);

export function getSettingWiringStatus(key: string): 'wired' | 'deferred' | 'hidden' {
  if (key.startsWith('unwired')) return 'deferred';
  if (WIRED_FEATURE_KEYS.has(key)) return 'wired';
  if (key === 'ceaGroup1') return 'deferred';
  return 'wired';
}

import { WIRED_KEY_COUNT } from './settingsWiring';

export const WIRED_SETTING_COUNT = WIRED_KEY_COUNT;
