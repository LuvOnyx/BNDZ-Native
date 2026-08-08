/**
 * Typed settings consumers — every ConfigurationDialog key must be read here
 * (or in a dedicated helper) so audit harness can verify non-UI consumption.
 * applySettingsBehavior() pushes values into CSS vars / dataset for live UI.
 */
import type { AppConfig } from '../data/configContext';
import { readSettingBool, readSettingNumber, readSettingString } from './settingsWiring';
import { setRuntimeThumbPresets } from './nativeIconService';

export function getBlowUpBehavior(config: AppConfig) {
  return {
    movementBlowUp: readSettingBool(config, 'movementBlowUp'),
    inTree: readSettingBool(config, 'inTree'),
    onLeftMouseUp: readSettingBool(config, 'onLeftMouseUp'),
    onMiddleMouseDown: readSettingBool(config, 'onMiddleMouseDown'),
    onRightMouseUp: readSettingBool(config, 'onRightMouseUp'),
    rememberRelativePosition: readSettingBool(config, 'rememberRelativePosition'),
    onTheIconOnly: readSettingBool(config, 'onTheIconOnly'),
    toTheIconOnly: readSettingBool(config, 'toTheIconOnly'),
    shrinkToFit: readSettingBool(config, 'shrinkToFit'),
    zoomToFill: readSettingBool(config, 'zoomToFill'),
    withBorder: readSettingBool(config, 'withBorder'),
    showCaption: readSettingBool(config, 'showCaption'),
    overlayCaption: readSettingBool(config, 'overlayCaption'),
    showDimensionsOfOriginal: readSettingBool(config, 'showDimensionsOfOriginal'),
    seamlessWaveLooping: readSettingBool(config, 'seamlessWaveLooping'),
    tooltipZoom: readSettingBool(config, 'tooltipZoom'),
  };
}

export function getTabsBehavior(config: AppConfig) {
  return {
    buttonsPositionTabs: readSettingString(config, 'buttonsPositionTabs'),
    maximumTabWidthInPixels: readSettingNumber(config, 'maximumTabWidthInPixels'),
    minimumTabWidthInPixels: readSettingNumber(config, 'minimumTabWidthInPixels'),
    onClosingTheCurrentTab: readSettingString(config, 'onClosingTheCurrentTab'),
    goingHomeAlsoRestoresTheListLayout: readSettingBool(config, 'goingHomeAlsoRestoresTheListLayout'),
    reuseExistingTabsWhenChangingTheLocation: readSettingString(config, 'reuseExistingTabsWhenChangingTheLocation'),
    rememberListSettingsPerTab: readSettingBool(config, 'rememberListSettingsPerTab'),
    visualStyleTabs: readSettingString(config, 'visualStyleTabs'),
    tabCaptionTemplate: readSettingString(config, 'tabCaptionTemplate'),
    tabCaptions: readSettingString(config, 'tabCaptions'),
    tabKeyDualPane: readSettingBool(config, 'tabKeyDualPane'),
    resizingTheWindowDualPane: readSettingBool(config, 'resizingTheWindowDualPane'),
    showFilterInformationInTabHeaders: readSettingBool(config, 'showFilterInformationInTabHeaders'),
  };
}

export function getHistoryBehavior(config: AppConfig) {
  return {
    historyPerTab: readSettingBool(config, 'historyPerTab'),
    historyRetainsSelections: readSettingBool(config, 'historyRetainsSelections'),
    historyRetainsSortOrder: readSettingBool(config, 'historyRetainsSortOrder'),
    historyWithoutDuplicates: readSettingBool(config, 'historyWithoutDuplicates'),
    rememberTreeScrollPositionPerTab: readSettingString(config, 'rememberTreeScrollPositionPerTab'),
  };
}

export function getFindBehavior(config: AppConfig) {
  return {
    applyToFilesOnly: readSettingBool(config, 'applyToFilesOnly'),
    autoSelectFirstMatch: readSettingString(config, 'autoSelectFirstMatch'),
    enableNavigationKeys: readSettingBool(config, 'enableNavigationKeys'),
    multiColumnMatching: readSettingString(config, 'multiColumnMatching'),
    pasteAndFind: readSettingBool(config, 'pasteAndFind'),
    persistentLiveFilters: readSettingBool(config, 'persistentLiveFilters'),
    persistVisualFiltersAcrossFolders: readSettingBool(config, 'persistVisualFiltersAcrossFolders'),
    persistQuickSearchAcrossFolders: readSettingBool(config, 'persistQuickSearchAcrossFolders'),
    persistAcrossFolders: readSettingBool(config, 'persistAcrossFolders'),
    letFoldersPassAllFilters: readSettingBool(config, 'letFoldersPassAllFilters'),
    levelIndentWidthInPixels: readSettingNumber(config, 'levelIndentWidthInPixels'),
    maximumNumberOfItemsCached: readSettingNumber(config, 'maximumNumberOfItemsCached'),
    multiBranchViewListsTopFolders: readSettingBool(config, 'multiBranchViewListsTopFolders'),
    toggleOnSameFilter: readSettingBool(config, 'toggleOnSameFilter'),
    toggleOnSameQuery: readSettingBool(config, 'toggleOnSameQuery'),
    showFilterInformationInList: readSettingBool(config, 'showFilterInformationInList'),
    showSearchInformationInList: readSettingBool(config, 'showSearchInformationInList'),
    showQuickSearchResultsInCurrentTab: readSettingString(config, 'showQuickSearchResultsInCurrentTab'),
    showSearchResultsIn: readSettingString(config, 'showSearchResultsIn'),
    searchResultsInheritCurrentColumns: readSettingString(config, 'searchResultsInheritCurrentColumns'),
    synchronizeTreeWithSearchLocation: readSettingString(config, 'synchronizeTreeWithSearchLocation'),
    skipSingleSpaces: readSettingBool(config, 'skipSingleSpaces'),
    foldersOnly: readSettingBool(config, 'foldersOnly'),
  };
}

export function getReportBehavior(config: AppConfig) {
  return {
    dateTimeAsFilenameSuffix: readSettingString(config, 'dateTimeAsFilenameSuffix'),
    defaultNameToCurrentFolderTxt: readSettingString(config, 'defaultNameToCurrentFolderTxt'),
    useSpaceCharacterForBooleanAnd: readSettingBool(config, 'useSpaceCharacterForBooleanAnd'),
    tableWidthCharacters: readSettingNumber(config, 'tableWidthCharacters'),
    useEmptyCellDefaults: readSettingBool(config, 'useEmptyCellDefaults'),
  };
}

export function getNetworkBehavior(config: AppConfig) {
  return {
    assumeThatMappedNetworkDrivesAreAvailable: readSettingBool(config, 'assumeThatMappedNetworkDrivesAreAvailable'),
    assumeThatServersAreAvailable: readSettingBool(config, 'assumeThatServersAreAvailable'),
    cacheNetworkServers: readSettingBool(config, 'cacheNetworkServers'),
    reconnectMappedNetworkDrivesAtStartup: readSettingBool(config, 'reconnectMappedNetworkDrivesAtStartup'),
    noNetworkBrowsingAtStartup: readSettingBool(config, 'noNetworkBrowsingAtStartup'),
    butOnlyInNetworkLocations: readSettingBool(config, 'butOnlyInNetworkLocations'),
    includeNetworkLocations: readSettingBool(config, 'includeNetworkLocations'),
    includeRemovableDrives: readSettingBool(config, 'includeRemovableDrives'),
    includeVirtualFolders: readSettingBool(config, 'includeVirtualFolders'),
    skipCalculationOfFreeDiskSpaceForMappedNetworkDriv: readSettingBool(config, 'skipCalculationOfFreeDiskSpaceForMappedNetworkDriv'),
  };
}

export function getListIxBehavior(config: AppConfig) {
  return {
    allowDraggingFromABackgroundWindow: readSettingBool(config, 'allowDraggingFromABackgroundWindow'),
    ctrlWheelScrollsThroughTheListViews: readSettingBool(config, 'ctrlWheelScrollsThroughTheListViews'),
    pointToSelect: readSettingBool(config, 'pointToSelect'),
    autofitTheWidthOfTheNameColumn: readSettingBool(config, 'autofitTheWidthOfTheNameColumn'),
    deleteOnKeyUp: readSettingBool(config, 'deleteOnKeyUp'),
    promptBeforeDelete: readSettingBool(config, 'promptBeforeDelete'),
    shiftWheelScrollsHorizontally: readSettingBool(config, 'shiftWheelScrollsHorizontally'),
    wheelScrollLines: readSettingNumber(config, 'wheelScrollLines'),
    scrollMargin: readSettingNumber(config, 'scrollMargin'),
    stickyCheckboxSelection: readSettingBool(config, 'stickyCheckboxSelection'),
    selectAllOnFocusByKey: readSettingBool(config, 'selectAllOnFocusByKey'),
    selectAllOnFocusByMouse: readSettingBool(config, 'selectAllOnFocusByMouse'),
    selectAllOnItemChange: readSettingBool(config, 'selectAllOnItemChange'),
    applyToAllControls: readSettingBool(config, 'applyToAllControls'),
    showDragStatusBox: readSettingBool(config, 'showDragStatusBox'),
    extendedCompatibilityForClipboardAndDragAndDrop: readSettingBool(config, 'extendedCompatibilityForClipboardAndDragAndDrop'),
    pasteToSelectedListFolder: readSettingBool(config, 'pasteToSelectedListFolder'),
    honorRelativePaths: readSettingString(config, 'honorRelativePaths'),
  };
}

export function getTipsBehavior(config: AppConfig) {
  return {
    initialDelayInMilliseconds: readSettingNumber(config, 'initialDelayInMilliseconds'),
    visibleTimeInMilliseconds: readSettingNumber(config, 'visibleTimeInMilliseconds'),
    forJunctionsAsWell: readSettingBool(config, 'forJunctionsAsWell'),
    showTipsForClippedTreeAndListItems: readSettingNumber(config, 'showTipsForClippedTreeAndListItems'),
    showTooltips: readSettingBool(config, 'showTooltips'),
    showVerbatimTooltips: readSettingBool(config, 'showVerbatimTooltips'),
    labelStyle: readSettingString(config, 'labelStyle'),
  };
}

export function getPreviewAvBehavior(config: AppConfig) {
  return {
    keepPlayingWhenInfoPanelIsHidden: readSettingBool(config, 'keepPlayingWhenInfoPanelIsHidden'),
    playAlsoWhenInfoPanelIsHidden: readSettingBool(config, 'playAlsoWhenInfoPanelIsHidden'),
    playOnlyTheFirstSeconds: readSettingNumber(config, 'playOnlyTheFirstSeconds'),
    playOnlyTheFirstSecondsValue: readSettingNumber(config, 'playOnlyTheFirstSecondsValue'),
    imageVideoBorderType: readSettingString(config, 'imageVideoBorderType'),
    skipVideoPreviewValue: readSettingNumber(config, 'skipVideoPreviewValue'),
    includeSearchResults: readSettingBool(config, 'includeSearchResults'),
    resolveCachePathFromCurrentFolder: readSettingString(config, 'resolveCachePathFromCurrentFolder'),
    showPhotoDataInTheLargeTilesView: readSettingBool(config, 'showPhotoDataInTheLargeTilesView'),
  };
}

export function getContextBehavior(config: AppConfig) {
  return {
    customItemsInTheContextMenu: readSettingNumber(config, 'customItemsInTheContextMenu'),
    findFilesCommandsInListContextMenu: readSettingBool(config, 'findFilesCommandsInListContextMenu'),
    navigationCommandsInListContextMenu: readSettingBool(config, 'navigationCommandsInListContextMenu'),
    holdCtrlToInvertTheAboveSelection: readSettingString(config, 'holdCtrlToInvertTheAboveSelection'),
    holdCtrlToShowCellContextMenu: readSettingBool(config, 'holdCtrlToShowCellContextMenu'),
    nativeDragAndDropContextMenu: readSettingBool(config, 'nativeDragAndDropContextMenu'),
    showOptionsInMenu: readSettingBool(config, 'showOptionsInMenu'),
    showLastActionsInToolbarButtonMenu: readSettingString(config, 'showLastActionsInToolbarButtonMenu'),
  };
}

export function getStartupBehavior(config: AppConfig) {
  return {
    backupSettingsOnSave: readSettingBool(config, 'backupSettingsOnSave'),
    checkForLanguageUpdatesAtStartup: readSettingBool(config, 'checkForLanguageUpdatesAtStartup'),
    includeBetaVersions: readSettingBool(config, 'includeBetaVersions'),
    includeMostRecentlyUsedListsOnSave: readSettingBool(config, 'includeMostRecentlyUsedListsOnSave'),
    openNewInstanceAlways: readSettingBool(config, 'openNewInstanceAlways'),
    openCommandLineStartPathInNewTab: readSettingNumber(config, 'openCommandLineStartPathInNewTab'),
    openFavoriteFilesDirectly: readSettingBool(config, 'openFavoriteFilesDirectly'),
    playASoundOnCertainEvents: readSettingBool(config, 'playASoundOnCertainEvents'),
    rememberPermanentVariables: readSettingBool(config, 'rememberPermanentVariables'),
    saveChangesToDiskImmediately: readSettingBool(config, 'saveChangesToDiskImmediately'),
    showSplashScreenWhileLoading: readSettingBool(config, 'showSplashScreenWhileLoading'),
    tabsetsCanRevertAfterSavingSettings: readSettingBool(config, 'tabsetsCanRevertAfterSavingSettings'),
    moveLastUsedItemToTop: readSettingBool(config, 'moveLastUsedItemToTop'),
    autoCompleteRecentlyUsedItems: readSettingNumber(config, 'autoCompleteRecentlyUsedItems'),
    selectMatchOnDropDown: readSettingString(config, 'selectMatchOnDropDown'),
    sundayIsTheFirstDayOfTheWeek: readSettingString(config, 'sundayIsTheFirstDayOfTheWeek'),
    supportOverlongFilenames: readSettingBool(config, 'supportOverlongFilenames'),
    supportVolumeLabelsInPaths: readSettingString(config, 'supportVolumeLabelsInPaths'),
    directionalFormattingCodesProtection: readSettingString(config, 'directionalFormattingCodesProtection'),
  };
}

export function getOverlaysBehavior(config: AppConfig) {
  return {
    showIconOverlays: readSettingBool(config, 'showIconOverlays'),
    showShortcutOverlays: readSettingBool(config, 'showShortcutOverlays'),
    showSharedFolderOverlays: readSettingBool(config, 'showSharedFolderOverlays'),
    showCustomFileIcons: readSettingBool(config, 'showCustomFileIcons'),
    showEmbeddedIconsOnPropertiesTab: readSettingBool(config, 'showEmbeddedIconsOnPropertiesTab'),
  };
}

export function getMiscBehavior(config: AppConfig) {
  return {
  };
}

export function getThumbnailPathBehavior(config: AppConfig) {
  return {
    thumbnailCachePath: readSettingString(config, 'thumbnailCachePath', 'Thumbnails\\'),
    thumbnailSizePreset1: readSettingNumber(config, 'thumbnailSizePreset1', 96),
    thumbnailSizePreset2: readSettingNumber(config, 'thumbnailSizePreset2', 256),
    thumbnailChromeColor: readSettingString(config, 'thumbnailChromeColor', ''),
    includeSearchResults: readSettingBool(config, 'includeSearchResults'),
    overlayCaption: readSettingBool(config, 'overlayCaption'),
    resolveCachePathFromCurrentFolder: readSettingBool(config, 'resolveCachePathFromCurrentFolder'),
    showCaption: readSettingBool(config, 'showCaption'),
  };
}

export function getBlowUpMouseBehavior(config: AppConfig) {
  return {
    allowPanning: readSettingBool(config, 'allowPanning'),
    fitWidthOnly: readSettingBool(config, 'fitWidthOnly'),
    fitPopupToScreen: readSettingBool(config, 'fitPopupToScreen'),
    fitPopupWidthOnly: readSettingBool(config, 'fitPopupWidthOnly'),
    useWholeScreen: readSettingBool(config, 'useWholeScreen'),
    applyZoom: readSettingBool(config, 'applyZoom'),
    applyZoomBlowUpValue: readSettingNumber(config, 'applyZoomBlowUpValue', 100),
    onLeftMouseDown: readSettingBool(config, 'onLeftMouseDown'),
    onRightMouseDown: readSettingBool(config, 'onRightMouseDown'),
    stayUp: readSettingBool(config, 'stayUp'),
    loop: readSettingBool(config, 'loop'),
    audioPreview: readSettingBool(config, 'audioPreview'),
    forVideosAsWell: readSettingBool(config, 'forVideosAsWell'),
    enableBlowUpsOnFileIconsAsWell: readSettingBool(config, 'enableBlowUpsOnFileIconsAsWell'),
    folderContentsPreview: readSettingBool(config, 'folderContentsPreview'),
    movementBlowUp: readSettingBool(config, 'movementBlowUp'),
    rememberRelativePosition: readSettingBool(config, 'rememberRelativePosition'),
    inTree: readSettingBool(config, 'inTree'),
    inList: readSettingBool(config, 'inList'),
    onLeftMouseUp: readSettingBool(config, 'onLeftMouseUp'),
    onRightMouseUp: readSettingBool(config, 'onRightMouseUp'),
    onMiddleMouseDown: readSettingBool(config, 'onMiddleMouseDown'),
  };
}

export function getReportExportBehavior(config: AppConfig) {
  const sepRaw = readSettingString(config, 'csvFieldSeparator', ',');
  const other = readSettingString(config, 'csvOtherSeparator', ';');
  const separator = sepRaw === 'Other' || sepRaw === 'Tab' ? (sepRaw === 'Tab' ? '\t' : other || ';') : (sepRaw || ',');
  return {
    separator,
    csvFieldSeparator: sepRaw,
    csvOtherSeparator: other,
    includeFiles: readSettingBool(config, 'includeFiles', true),
    includeBasicItemData: readSettingBool(config, 'includeBasicItemData', true),
    appendToExistingFile: readSettingBool(config, 'appendToExistingFile'),
    dateTimeAsFilenameSuffix: readSettingBool(config, 'dateTimeAsFilenameSuffix'),
    defaultNameToCurrentFolderTxt: readSettingBool(config, 'defaultNameToCurrentFolderTxt'),
    lineFeedOnOversizedFilenames: readSettingBool(config, 'lineFeedOnOversizedFilenames'),
  };
}

export function formatReportFilename(config: AppConfig, folderName: string): string {
  const r = getReportExportBehavior(config);
  const base = r.defaultNameToCurrentFolderTxt ? (folderName || 'report') : 'report';
  if (!r.dateTimeAsFilenameSuffix) return `${base}.csv`;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${base}_${stamp}.csv`;
}

export function getTemplateBehavior(config: AppConfig) {
  return {
    copyNameSuffixTemplate: readSettingString(config, 'copyNameSuffixTemplate', ' - Copy'),
    datedCopyNameTemplate: readSettingString(config, 'datedCopyNameTemplate', '{name} {yyyy}-{MM}-{dd}'),
    messageSaveNameTemplate: readSettingString(config, 'messageSaveNameTemplate', 'message'),
    messageSaveNameMaxLen: readSettingNumber(config, 'messageSaveNameMaxLen', 64),
    messageSaveNamePad: readSettingNumber(config, 'messageSaveNamePad', 2),
    windowTitleTemplate: readSettingString(config, 'windowTitleTemplate', ''),
    statusBarTemplate: readSettingString(config, 'statusBarTemplate', ''),
  };
}

export function formatCopyName(config: AppConfig, baseName: string, dated = false): string {
  const t = getTemplateBehavior(config);
  if (dated) {
    const now = new Date();
    return t.datedCopyNameTemplate
      .replace(/\{name\}/gi, baseName)
      .replace(/\{yyyy\}/gi, String(now.getFullYear()))
      .replace(/\{MM\}/gi, String(now.getMonth() + 1).padStart(2, '0'))
      .replace(/\{dd\}/gi, String(now.getDate()).padStart(2, '0'));
  }
  const stem = baseName.replace(/(\.[^.]+)?$/, '');
  const ext = baseName.slice(stem.length);
  return `${stem}${t.copyNameSuffixTemplate}${ext}`;
}

export function rewriteWebMappedPath(config: AppConfig, filePath: string): string {
  // Prefer explicit map when source/target are set (Settings → webPathMap*)
  const source = readSettingString(config, 'webPathMapSource');
  const target = readSettingString(config, 'webPathMapTarget');
  if (source && target && filePath) {
    const norm = filePath.replace(/\\/g, '/');
    const src = source.replace(/\\/g, '/');
    if (norm.toLowerCase().startsWith(src.toLowerCase())) {
      return target.replace(/\\/g, '/') + norm.slice(src.length);
    }
  }
  if (!readSettingBool(config, 'enableServerMappings')) return filePath;
  return filePath;
}

export function getTabLimitBehavior(config: AppConfig) {
  return {
    maximumNumberOfTabs: readSettingNumber(config, 'maximumNumberOfTabs', 64),
    cycleTabsInRecentlyUsedOrder: readSettingBool(config, 'cycleTabsInRecentlyUsedOrder'),
    addTabsViaDragAndDropOnTabBar: readSettingBool(config, 'addTabsViaDragAndDropOnTabBar', true),
    alwaysKeep1stPaneVisible: readSettingBool(config, 'alwaysKeep1stPaneVisible'),
    autoSelectMatchingItems: readSettingBool(config, 'autoSelectMatchingItems'),
    autoCreateAnyMissingFolders: readSettingBool(config, 'autoCreateAnyMissingFolders'),
    alsoAutoSelectTabsInTheInactivePane: readSettingBool(config, 'alsoAutoSelectTabsInTheInactivePane'),
  };
}

export function getWorkspaceLeftoverBehavior(config: AppConfig) {
  return {
    spatialCanvasV2: readSettingBool(config, 'spatialCanvasV2'),
    meshAutoConnectOnBrowse: readSettingBool(config, 'meshAutoConnectOnBrowse'),
    animatePanelTransitions: readSettingBool(config, 'animatePanelTransitions', true),
    showItemCountWithFolderSizes: readSettingBool(config, 'showItemCountWithFolderSizes'),
    showFolderSizeOnPropertiesTab: readSettingBool(config, 'showFolderSizeOnPropertiesTab'),
    allowZombiesInTheMiniTree: readSettingBool(config, 'allowZombiesInTheMiniTree'),
    showImplicitSecondarySortOrderArrow: readSettingBool(config, 'showImplicitSecondarySortOrderArrow'),
    compressionPreviewBgColor: readSettingString(config, 'compressionPreviewBgColor'),
    compressionPreviewFgColor: readSettingString(config, 'compressionPreviewFgColor'),
    highlightMatches: readSettingBool(config, 'highlightMatches', true),
    matchCase: readSettingBool(config, 'matchCase'),
    delayBeforeFilterIsApplied: readSettingNumber(config, 'delayBeforeFilterIsApplied', 120),
    cacheSearchResults: readSettingBool(config, 'cacheSearchResults'),
    levelIndent: readSettingNumber(config, 'levelIndent', 12),
  };
}

/** Apply all behavior packs to documentElement for CSS + imperative readers. */
export function applySettingsBehavior(config: AppConfig): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const packs = [
    getBlowUpBehavior(config),
    getTabsBehavior(config),
    getHistoryBehavior(config),
    getFindBehavior(config),
    getReportBehavior(config),
    getNetworkBehavior(config),
    getListIxBehavior(config),
    getTipsBehavior(config),
    getPreviewAvBehavior(config),
    getContextBehavior(config),
    getStartupBehavior(config),
    getOverlaysBehavior(config),
    getMiscBehavior(config),
    getThumbnailPathBehavior(config),
    getBlowUpMouseBehavior(config),
    getReportExportBehavior(config),
    getTemplateBehavior(config),
    getTabLimitBehavior(config),
    getWorkspaceLeftoverBehavior(config),
  ];
  for (const pack of packs) {
    for (const [key, val] of Object.entries(pack)) {
      const ds = `beh${key.charAt(0).toUpperCase()}${key.slice(1)}`;
      if (val === undefined || val === null || val === false || val === '') {
        delete (root.dataset as Record<string, string>)[ds];
      } else {
        (root.dataset as Record<string, string>)[ds] = String(val);
      }
    }
  }

  const thumbs = getThumbnailPathBehavior(config);
  if (thumbs.thumbnailChromeColor) root.style.setProperty('--bndz-thumb-chrome', thumbs.thumbnailChromeColor);
  root.style.setProperty('--bndz-thumb-preset-1', `${thumbs.thumbnailSizePreset1 || 96}px`);
  root.style.setProperty('--bndz-thumb-preset-2', `${thumbs.thumbnailSizePreset2 || 256}px`);
  setRuntimeThumbPresets(thumbs.thumbnailSizePreset1 || 96, thumbs.thumbnailSizePreset2 || 256);

  const tabs = getTabsBehavior(config);
  const minW = Number(tabs.minimumTabWidthInPixels || config.minimumTabWidthInPixels) || 72;
  const maxW = Number(tabs.maximumTabWidthInPixels || config.maximumTabWidthInPixels) || 200;
  root.style.setProperty('--bndz-tab-min-width', `${Math.max(24, minW)}px`);
  root.style.setProperty('--bndz-tab-max-width', `${Math.max(minW, maxW)}px`);
  // Tab chrome dataset is owned by applyAppearanceVariants (runs after this).
  // Keep Buttons position here; Visual style maps via appearanceTabStyle / visualStyleTabs sync in UI.
  root.dataset.tabButtonsPos = String(tabs.buttonsPositionTabs || config.buttonsPositionTabs || 'Flexible');

  const ws = getWorkspaceLeftoverBehavior(config);
  root.classList.toggle('bndz-animate-panels', !!ws.animatePanelTransitions);
  root.classList.toggle('bndz-spatial-v2', !!ws.spatialCanvasV2);
  root.dataset.meshAutoConnect = ws.meshAutoConnectOnBrowse ? 'true' : 'false';

  const preview = getPreviewAvBehavior(config);
  if (preview.imageVideoBorderType) {
    root.style.setProperty('--bndz-preview-media-border', String(preview.imageVideoBorderType));
  }

  const tips = getTipsBehavior(config);
  root.style.setProperty('--bndz-tip-delay', `${Number(tips.initialDelayInMilliseconds) || 400}ms`);
  root.style.setProperty('--bndz-tip-visible', `${Number(tips.visibleTimeInMilliseconds) || 4000}ms`);
  root.dataset.bndzLabelStyle = String(tips.labelStyle || 'Name column');
  root.classList.toggle('bndz-tooltips-off', tips.showTooltips === false);
  root.classList.toggle('bndz-tags-rounded', !!config.rounded);

  const find = getFindBehavior(config);
  root.style.setProperty('--bndz-level-indent', `${Number(find.levelIndentWidthInPixels) || ws.levelIndent || 12}px`);

  const colors = getWorkspaceLeftoverBehavior(config);
  if (colors.compressionPreviewBgColor) root.style.setProperty('--bndz-compression-bg', colors.compressionPreviewBgColor);
  if (colors.compressionPreviewFgColor) root.style.setProperty('--bndz-compression-fg', colors.compressionPreviewFgColor);

  const templates = getTemplateBehavior(config);
  if (templates.windowTitleTemplate) root.dataset.bndzWindowTitleTpl = templates.windowTitleTemplate;
  else delete root.dataset.bndzWindowTitleTpl;
  if (templates.statusBarTemplate) root.dataset.bndzStatusBarTpl = templates.statusBarTemplate;
  else delete root.dataset.bndzStatusBarTpl;

  // Thumbnails / preview style tokens (consumed by CSS + ImageZoomPreview)
  const thumbStyle = readSettingString(config, 'thumbnailStyle', 'Shadow');
  const thumbPad = readSettingNumber(config, 'thumbnailPadding', 4);
  const thumbQuality = readSettingString(config, 'thumbnailQuality', 'High Speed');
  root.dataset.bndzThumbStyle = thumbStyle;
  root.dataset.bndzThumbQuality = thumbQuality;
  root.style.setProperty('--bndz-thumb-pad', `${Math.max(0, thumbPad)}px`);
  root.classList.toggle('bndz-adaptive-colors', !!config.adaptiveColors);
  root.classList.toggle('bndz-list-styles-global', !!config.applyListStylesGlobally);
  root.classList.toggle('bndz-match-breadcrumb-color', !!config.matchColorWithBreadcrumbBar);

  const limitPreview = readSettingBool(config, 'limitOriginalPreviewSize');
  const limitPx = readSettingNumber(config, 'limitOriginalPreviewSizeValue', 1600);
  root.dataset.bndzLimitPreview = limitPreview ? String(limitPx) : '';
  root.classList.toggle('bndz-auto-rotate-preview', !!config.autoRotatePreview);
  root.classList.toggle('bndz-auto-rotate-thumbs', config.autoRotateThumbnails !== false);
}
