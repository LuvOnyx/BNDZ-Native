import type { AppConfig } from '../data/configContext';
import { filterTreeListEntities } from './treeListItemFilter';
import { applyThemeByName } from '../data/themePresets';
import { applyAppearanceVariants } from './appearanceVariants';
import { SETTINGS_DEFAULTS } from './settingsDefaults';
import { fillToBackground, fillToSolid, migratePluginHeroFill } from './colorFill';
import {
  syncAllSettingsToDocument,
  buildKeyboardMap,
  buildMouseRuntime,
  buildSearchRuntime,
  buildShellRuntime,
  buildUiRuntime,
  SETTINGS_DEFAULT_KEY_COUNT,
} from './settingsWiring';
import { WIRED_SETTING_COUNT, DEFERRED_SETTING_COUNT } from './settingsRegistry';
import { applySettingsBehavior } from './settingsBehavior';
import type { SortColumnId } from './listColumns';
import { isNetworkPanePath, isNonFsShellIconPath } from './shellPaths';

export interface PaneSortState {
  sortColumn?: SortColumnId;
  sortDirection?: 'asc' | 'desc';
  /** Resolved byte size for size-column sort (folders use scanned/cache sizes). */
  getByteSize?: (entity: any) => number;
}

export interface SettingsRuntimeContext {
  list: {
    showExtensions: boolean;
    showTags: boolean;
    showSortHeaders: boolean;
    underlineSelected: boolean;
    showSelectionHighlight: boolean;
    showSelectionCheckboxes: boolean;
    dimmedIcons: boolean;
    coloredLines: boolean;
    dimSelectedIcons: boolean;
    ghostHiddenIcons: boolean;
    lighterDetailColumns: boolean;
    verticalGridLines: boolean;
    wrapAround: boolean;
    autoSelectFirst: boolean;
    useGenericIcons: boolean;
    applyColorFilters: boolean;
    showHiddenInList: boolean;
    zebraRows: boolean;
    /** 1 = subtle, 2 = stronger alternate rows */
    zebraIntensity: 1 | 2;
    selectionChrome: 'fullRow' | 'nameOnly' | 'throughSecondColumn';
  };
  sort: {
    method: string;
    foldersFirst: boolean;
    foldersAlwaysAsc: boolean;
    sortByBase: boolean;
    sizeDescDefault: boolean;
    dateDescDefault: boolean;
    treeLike: boolean;
    keepInViewAfterResort: boolean;
    scrollToTopAfterResort: boolean;
  };
  tree: {
    showHidden: boolean;
    expandOnBrowse: boolean;
    expandOnSingleClick: boolean;
    rememberState: boolean;
    lockState: boolean;
    skipInvisible: boolean;
    applyColorFilters: boolean;
  };
  preview: {
    enabled: boolean;
    asThumbnail: boolean;
    animDuration: number;
    delayMs: number;
    highQuality: boolean;
    nativeHandling: boolean;
    autoplay: boolean;
    preferBlob: boolean;
    zoomToFit: boolean;
    /** 0 = keep real tabs; otherwise space count for expansion. */
    displayTabsAsSpaces: number;
    utf8AutoDetection: boolean;
    transparencyBg: boolean;
    audioVideoEnabled: boolean;
    audioVideoMode: string;
    loopMedia: boolean;
  };
  thumbnail: {
    enabled: boolean;
    highRes: boolean;
    showFolders: boolean;
    showNonImages: boolean;
    showRaw: boolean;
    showOnThumbnail: boolean;
    genericFast: boolean;
  };
  operations: {
    autoRefresh: boolean;
    fsNotifications: boolean;
    refreshDuringOps: boolean;
    bypassRecycleBin: boolean;
  };
  tabs: {
    shadeInactive: boolean;
    flexibleWidth: boolean;
    showNewTab: boolean;
    showTabList: boolean;
    showCloseButtons: string;
    dualPane: boolean;
  };
  rename: {
    preselectName: boolean;
    hideExtensionInBox: boolean;
    excludeExtFromSelection: boolean;
    showNameLength: boolean;
    serialRename: boolean;
    useRenameDialog: boolean;
    allowMoveOnRename: boolean;
    resortAfterRename: boolean;
    autoReplaceInvalidChars: boolean;
  };
  mouse: ReturnType<typeof buildMouseRuntime>;
  search: ReturnType<typeof buildSearchRuntime>;
  shell: ReturnType<typeof buildShellRuntime>;
  ui: ReturnType<typeof buildUiRuntime>;
  keyboard: ReturnType<typeof buildKeyboardMap>;
  wiredKeyCount: number;
  deferredKeyCount: number;
  defaultKeyCount: number;
}

export function buildSettingsRuntime(config: AppConfig): SettingsRuntimeContext {
  return {
    list: {
      showExtensions: !!config.showFileExtensions,
      showTags: config.showTagsInFileList !== false && config.fileTaggingFeature !== false,
      showSortHeaders: config.showSortHeadersInAllViews !== false,
      underlineSelected: !!config.underlineSelectedRows,
      verticalGridLines: !!config.verticalGridLinesInDetailsView,
      wrapAround: !!config.wrapAroundList,
      autoSelectFirst: !!config.autoSelectFirstItem,
      useGenericIcons: !!config.useGenericIconsForSuperFastBrowsing,
      applyColorFilters: config.applyColorFiltersToTheList !== false && config.enableColorFilters !== false,
    showHiddenInList: !!config.showHiddenSystemFoldersInTree,
    zebraRows: !!config.listZebraStyle && config.listZebraStyle !== 'Solid Color' && config.listZebraStyle !== false,
    zebraIntensity: String(config.listZebraStyle || '').includes('(2)') ? 2 : 1,
    selectionChrome: (config.listSelectionChrome === 'nameOnly' || config.listSelectionChrome === 'throughSecondColumn')
      ? config.listSelectionChrome
      : 'fullRow',
    showSelectionHighlight: config.listShowSelectionHighlight !== false,
    showSelectionCheckboxes: !!config.listShowSelectionCheckboxes,
    dimmedIcons: !!config.dimmedIcons,
    coloredLines: !!config.coloredLines,
    dimSelectedIcons: !!config.drawSelectedListIconsDimmed,
    ghostHiddenIcons: !!config.drawHiddenIconsGhosted,
    lighterDetailColumns: !!config.lighterTextInDetailsColumns,
    },
    sort: {
      method: config.sortMethod || 'Natural',
      foldersFirst: config.sortFoldersFirst !== false,
      foldersAlwaysAsc: !!config.sortFoldersAlwaysAscending,
      sortByBase: !!config.sortFilenamesByBase,
      sizeDescDefault: !!config.sortSizeColumnsDescendingByDefault,
      dateDescDefault: !!config.sortDateColumnsDescendingByDefault,
      treeLike: !!config.defaultToTreeLikeSortOrder,
      keepInViewAfterResort: !!config.keepCurrentItemInViewAfterResorting,
      scrollToTopAfterResort: !!config.scrollToTopAfterResorting,
    },
    tree: {
      showHidden: !!config.showHiddenSystemFoldersInTree,
      expandOnBrowse: !!config.expandTreeNodesOnBrowse,
      expandOnSingleClick: !!config.expandTreeNodesOnSingleClick,
      rememberState: !!config.rememberStateOfTree,
      lockState: !!config.lockTreeState,
      skipInvisible: !!config.skipInvisibleSubfolders,
      applyColorFilters: config.applyColorFiltersToTheTree === true && config.enableColorFilters !== false,
    },
    preview: {
      enabled: true,
      asThumbnail: config.previewAsThumbnail !== false,
      animDuration: config.richTransitionAnimations !== false ? 0.15 : 0,
      delayMs: typeof config.previewDelay === 'number' ? config.previewDelay : 250,
      highQuality: !!config.highQualityImageResampling,
      nativeHandling: config.useNativeHandlingInThePreviewPane !== false,
      autoplay: config.autoplay === true
        || config.audioVideoPreview === 'Play once'
        || config.audioVideoPreview === 'Loop'
        || config.audioVideoPreview === true,
      preferBlob: config.useNativeHandlingInThePreviewPane === false,
      zoomToFit: !!config.zoomToFit,
      displayTabsAsSpaces: (() => {
        const v = config.displayTabsAsSpaces;
        if (v === true) return 4;
        if (v === false || v == null || v === 'Off' || v === 0 || v === '0') return 0;
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? Math.min(16, Math.max(1, Math.round(n))) : 0;
      })(),
      utf8AutoDetection: config.utf8AutoDetection !== false,
      transparencyBg: config.transparencyBackground !== false
        && String(config.transparencyBackground || 'Grid').toLowerCase() !== 'none',
      audioVideoEnabled: config.audioVideoPreview !== 'Disabled',
      audioVideoMode: String(config.audioVideoPreview || 'Play once'),
      loopMedia: config.audioVideoPreview === 'Loop' || config.loop === true,
    },
    thumbnail: {
      enabled: config.enableNativeThumbnails !== false,
      highRes: config.highResNativeWindowsThumbnails !== false,
      showFolders: config.showFolderThumbnails === true,
      showNonImages: config.showThumbnailsForNonImages !== false,
      showRaw: config.showThumbnailsForRawFiles !== false,
      showOnThumbnail: config.showFileIconOnThumbnail !== false,
      genericFast: !!config.useGenericIconsForSuperFastBrowsing,
    },
    operations: {
      autoRefresh: config.autoRefresh !== false,
      fsNotifications: config.respondToFileSystemNotifications !== false,
      refreshDuringOps: !!config.refreshDuringFileOperations
        || !!config.refreshFolderContentsDuringFileOperations,
      bypassRecycleBin: !!config.bypassRecycleBin,
    },
    tabs: {
      shadeInactive: config.shadeInactivePane !== false,
      flexibleWidth: config.flexibleTabWidth === true,
      showNewTab: config.showNewTabButton !== false,
      showTabList: !!config.showTabListButton,
      showCloseButtons: config.showXCloseButtonsOnTabs || 'Active tab',
      dualPane: config.dualPaneFeature !== false && config.dualPane !== false,
    },
    rename: {
      preselectName: config.preselectName !== false,
      hideExtensionInBox: !!config.hideExtensionsFromRenameEditBox,
      excludeExtFromSelection: !!config.excludeFileExtensionFromInitialSelection,
      showNameLength: !!config.showNameLengthWhileRenaming,
      serialRename: !!config.serialRenameWithUpAndDownKeys,
      useRenameDialog: !!config.useDialogToRenameSingleItems,
      allowMoveOnRename: !!config.allowMoveOnRename,
      resortAfterRename: !!config.resortListImmediatelyAfterRename,
      autoReplaceInvalidChars: !!config.autoReplaceInvalidCharacters,
    },
    mouse: buildMouseRuntime(config),
    search: buildSearchRuntime(config),
    shell: buildShellRuntime(config),
    ui: buildUiRuntime(config),
    keyboard: buildKeyboardMap(config),
    wiredKeyCount: WIRED_SETTING_COUNT,
    deferredKeyCount: DEFERRED_SETTING_COUNT,
    defaultKeyCount: SETTINGS_DEFAULT_KEY_COUNT,
  };
}

/** Filter entities for list display (hidden/system/dotfiles + Select Items categories) */
export function filterListEntities(items: any[], config: AppConfig): any[] {
  return filterTreeListEntities(items, config);
}

function sortKeyName(name: string, config: AppConfig): string {
  if (!config.sortFilenamesByBase) return name;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.substring(0, dot) : name;
}

function naturalCompare(a: string, b: string, config: AppConfig): number {
  const sa = sortKeyName(a || '', config);
  const sb = sortKeyName(b || '', config);
  const sensitivity = config.treatHyphensAndApostrophesLikeNormalCharacters ? 'variant' : 'base';
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: sensitivity as Intl.CollatorOptions['sensitivity'] });
}

/** Stable sort key for FS entities (shell folders may omit `name`) */
export function entitySortName(entity: any): string {
  if (!entity) return '';
  const raw = entity.name ?? entity.label ?? entity.displayName ?? entity.id;
  return raw != null ? String(raw) : '';
}

/** Resolve sort column: pane override → persisted preference → sortMethod setting */
export function resolveSortColumn(config: AppConfig, pane?: PaneSortState): SortColumnId {
  if (pane?.sortColumn) return pane.sortColumn as SortColumnId;
  const persisted = config.listSortColumn as SortColumnId | undefined;
  if (persisted === 'name' || persisted === 'type' || persisted === 'size' || persisted === 'modified' || persisted === 'created' || persisted === 'tags' || persisted === 'ghostState' || persisted === 'ramZone') {
    return persisted;
  }
  const method = config.sortMethod || 'Natural';
  switch (method) {
    case 'Date Modified': return 'modified';
    case 'Size': return 'size';
    case 'Type': return 'type';
    default: return 'name';
  }
}

export function resolveSortDirection(
  column: SortColumnId,
  paneDirection: 'asc' | 'desc' | undefined,
  config: AppConfig
): 'asc' | 'desc' {
  if (paneDirection) return paneDirection;
  if (config.listSortDirection === 'asc' || config.listSortDirection === 'desc') {
    // Only apply persisted direction when it matches the persisted column (or no pane override).
    if (!config.listSortColumn || config.listSortColumn === column) {
      return config.listSortDirection;
    }
  }
  if (column === 'size' && config.sortSizeColumnsDescendingByDefault) return 'desc';
  if (column === 'modified' && config.sortDateColumnsDescendingByDefault) return 'desc';
  if (config.sortFoldersAlwaysAscending && column === 'name') return 'asc';
  return 'asc';
}

/** Full XYplorer-style entity comparator */
export function compareEntities(
  a: any,
  b: any,
  config: AppConfig,
  pane?: PaneSortState
): number {
  const rt = buildSettingsRuntime(config);

  if (config.onSortingKeepTaggedItemsOnTop) {
    const tagsA = (a.tags?.length ?? 0) > 0 ? 1 : 0;
    const tagsB = (b.tags?.length ?? 0) > 0 ? 1 : 0;
    if (tagsA !== tagsB) return tagsB - tagsA;
  }

  if (rt.sort.foldersFirst || config.sortFoldersApart || config.defaultToTreeLikeSortOrder) {
    const dirA = a.type === 'directory' ? -1 : 1;
    const dirB = b.type === 'directory' ? -1 : 1;
    if (dirA !== dirB) return dirA - dirB;
  }

  const col = resolveSortColumn(config, pane);
  const dir = resolveSortDirection(col, pane?.sortDirection, config);
  const mul = dir === 'desc' ? -1 : 1;

  if (col === 'name') {
    const method = rt.sort.method;
    const nameA = entitySortName(a);
    const nameB = entitySortName(b);
    if (method === 'Alphabetical') return mul * nameA.localeCompare(nameB);
    return mul * naturalCompare(nameA, nameB, config);
  }
  if (col === 'type') {
    const typeA = a.driveInfo?.type || a.driveInfo?.format || a.extension || (a.type === 'directory' ? 'folder' : '');
    const typeB = b.driveInfo?.type || b.driveInfo?.format || b.extension || (b.type === 'directory' ? 'folder' : '');
    return mul * String(typeA).localeCompare(String(typeB));
  }
  if (col === 'size') {
    const sizeA = pane?.getByteSize ? pane.getByteSize(a) : (a.size || 0);
    const sizeB = pane?.getByteSize ? pane.getByteSize(b) : (b.size || 0);
    if (sizeA !== sizeB) return mul * (sizeA - sizeB);
    // Stable tie-break by name so equal/unknown folder sizes still reorder predictably.
    return mul * naturalCompare(entitySortName(a), entitySortName(b), config);
  }
  if (col === 'modified') {
    if (config.mixedSortOnDateColumns && a.type === 'directory' && b.type !== 'directory') return -1;
    if (config.mixedSortOnDateColumns && b.type === 'directory' && a.type !== 'directory') return 1;
    return mul * ((new Date(a.modified).getTime() || 0) - (new Date(b.modified).getTime() || 0));
  }
  if (col === 'created') {
    if (config.mixedSortOnDateColumns && a.type === 'directory' && b.type !== 'directory') return -1;
    if (config.mixedSortOnDateColumns && b.type === 'directory' && a.type !== 'directory') return 1;
    return mul * ((new Date(a.created).getTime() || 0) - (new Date(b.created).getTime() || 0));
  }
  if (col === 'tags') {
    const tagA = (Array.isArray(a.tags) ? a.tags : []).filter(Boolean).join('\0');
    const tagB = (Array.isArray(b.tags) ? b.tags : []).filter(Boolean).join('\0');
    if (config.mixedSortOnTagColumns) {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (b.type === 'directory' && a.type !== 'directory') return 1;
    }
    // Both untagged: keep current relative order (do not reshuffle by name asc/desc).
    if (!tagA && !tagB) return 0;
    // Untagged after tagged when ascending; reverse when descending.
    if (!tagA || !tagB) {
      if (!tagA) return mul;
      return -mul;
    }
    const cmp = tagA.localeCompare(tagB);
    if (cmp !== 0) return mul * cmp;
    return naturalCompare(entitySortName(a), entitySortName(b), config);
  }
  if (col === 'ghostState') {
    const gA = a.isGhostLink ? 1 : 0;
    const gB = b.isGhostLink ? 1 : 0;
    if (gA !== gB) return mul * (gA - gB);
    return naturalCompare(entitySortName(a), entitySortName(b), config);
  }
  if (col === 'ramZone') {
    const zA = String(a.ramZoneId || a.ramZone || '');
    const zB = String(b.ramZoneId || b.ramZone || '');
    const cmp = zA.localeCompare(zB);
    if (cmp !== 0) return mul * cmp;
    return naturalCompare(entitySortName(a), entitySortName(b), config);
  }
  if (col === 'path' && config.mixedSortOnPathColumns) {
    const pathA = String(a.path || a.id || '');
    const pathB = String(b.path || b.id || '');
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (b.type === 'directory' && a.type !== 'directory') return 1;
    return mul * pathA.localeCompare(pathB);
  }
  return 0;
}

export function sortEntities(items: any[], config: AppConfig, pane?: PaneSortState): any[] {
  return [...items].sort((a, b) => compareEntities(a, b, config, pane));
}

/** Display name respecting showFileExtensions and virtual locations (e.g. Recycle Bin) */
export function getDisplayName(entity: any, config: AppConfig, panePath?: string): string {
  // Lazy import avoided — inline recycle-bin strip to keep bundle simple
  const isDir = entity.type === 'directory';
  let name = entitySortName(entity);
  const inRecycle = entity.isRecycleItem || (panePath && (
    panePath === '/shell:RecycleBin' ||
    panePath.replace(/^\//, '').toLowerCase() === 'shell:recyclebin'
  ));
  if (inRecycle) {
    name = name.split(/[/\\]/).pop() || name;
    const inMatch = name.match(/^(.+?)\s+\(in\s+.+\)$/i);
    if (inMatch) name = inMatch[1].trim();
  }
  const ext = entity.extension;
  const hideShortcutExtension = !isDir
    && String(ext || '').toLowerCase() === 'lnk'
    && config.hideShortcutExtensions !== false;
  if (!isDir && ext && (config.showFileExtensions === false || hideShortcutExtension)) {
    name = name.replace(new RegExp(`\\.${ext}$`, 'i'), '');
  }
  if (config.truncateFilenamesInTheMiddle && name.length > 28) {
    const head = Math.ceil((28 - 1) / 2);
    const tail = Math.floor((28 - 1) / 2);
    name = `${name.slice(0, head)}…${name.slice(name.length - tail)}`;
  }
  if (config.showLocalizedFolderNames && isDir) {
    const localized = entity.localizedName || entity.displayName || entity.friendlyName;
    if (typeof localized === 'string' && localized.trim()) return localized.trim();
  }
  return name;
}

/** Initial rename field value */
export function getRenameInitialValue(entity: any, config: AppConfig): string {
  const name = entity.name || '';
  if (shouldHideRenameExtension(entity, config)) {
    return stripEntityExtension(name, entity.extension);
  }
  return name;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripEntityExtension(name: string, extension: string | undefined): string {
  if (!extension) return name;
  return name.replace(new RegExp(`\\.${escapeRegExp(extension)}$`, 'i'), '');
}

function shouldHideRenameExtension(entity: any, config: AppConfig): boolean {
  const ext = String(entity?.extension || '').toLowerCase();
  if (!ext || entity?.type === 'directory') return false;
  if (ext === 'lnk' && config.hideShortcutExtensions !== false) return true;
  return !!config.hideExtensionsFromRenameEditBox;
}

/** Resolve the actual filesystem name represented by the rename edit box. */
export function resolveRenameTargetName(entity: any, editedValue: string, config: AppConfig): string {
  const ext = String(entity?.extension || '');
  const raw = String(editedValue || '').trim();
  if (!raw || entity?.type === 'directory' || !shouldHideRenameExtension(entity, config)) {
    return raw;
  }

  const suffix = `.${ext}`;
  if (raw.toLowerCase().endsWith(suffix.toLowerCase())) {
    return raw;
  }
  return `${raw}${suffix}`;
}

/** Explorer-style initial selection for inline rename fields. */
export function applyRenameInputSelection(input: HTMLInputElement, entity: any, config: AppConfig): void {
  if (!input || config.preselectName === false) return;
  requestAnimationFrame(() => {
    try {
      const value = input.value;
      const ext = String(entity?.extension || '');
      const shouldSelectBase = entity?.type !== 'directory'
        && ext
        && (config.excludeFileExtensionFromInitialSelection !== false || shouldHideRenameExtension(entity, config));
      const end = shouldSelectBase ? stripEntityExtension(value, ext).length : value.length;
      input.focus();
      input.setSelectionRange(0, Math.max(0, end));
    } catch {
      input.select();
    }
  });
}

/** Keyboard list navigation index with optional wrap-around */
export function wrapListIndex(current: number, delta: number, length: number, config: AppConfig): number {
  if (length === 0) return -1;
  let next = current + delta;
  if (buildSettingsRuntime(config).list.wrapAround) {
    if (next < 0) next = length - 1;
    if (next >= length) next = 0;
    return next;
  }
  return Math.max(0, Math.min(next, length - 1));
}

/** Whether list/tree should fetch native shell icons (independent of thumbnail preview settings) */
export function shouldFetchNativeShellIcon(_entity: any, config: AppConfig, pathHint?: string): boolean {
  if (config.showCachedIconsOnly) return false;
  const probe = pathHint || String((_entity as any)?.path || '');
  // Mesh / VF / cloud / smart views — still "fetch" so FE commits __folder__ / type glyphs
  // (requestNativeIcon short-circuits; never hits Windows shell).
  if (probe && isNonFsShellIconPath(probe)) return true;
  if (config.useGenericIconsForSuperFastBrowsing) {
    // Generic-only everywhere, unless limited to network locations.
    if (!config.butOnlyInNetworkLocations) return false;
    if (probe && isNetworkPanePath(probe)) return false;
  }
  return true;
}

/** Whether to fetch a high-res thumbnail instead of / in addition to shell icon */
export function shouldFetchNativeThumbnail(entity: any, config: AppConfig, pathHint?: string): boolean {
  const rt = buildSettingsRuntime(config);
  if (!rt.thumbnail.enabled) return false;
  const probe = pathHint || String(entity?.path || '');
  if (probe && isNonFsShellIconPath(probe)) return false;
  if (rt.thumbnail.genericFast) {
    if (!config.butOnlyInNetworkLocations) return false;
    if (probe && isNetworkPanePath(probe)) return false;
  }
  if (entity.type === 'directory') return rt.thumbnail.showFolders === true;
  const ext = entityExtension(entity);
  // Images, icons, video frames, audio artwork, and archive shell thumbs.
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif', 'heic', 'jfif', 'avif'];
  const videoExts = ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'wmv', 'mpg', 'mpeg', 'flv', 'ts', 'm2ts'];
  const audioExts = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'wma', 'opus', 'aiff', 'ape'];
  const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'cab', 'iso'];
  const docExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'psd', 'ai'];
  if (imageExts.includes(ext) || videoExts.includes(ext)) return true;
  if (audioExts.includes(ext) || archiveExts.includes(ext)) return true;
  if (docExts.includes(ext)) return rt.thumbnail.showNonImages;
  if (['raw', 'cr2', 'nef', 'arw', 'dng', 'orf', 'rw2'].includes(ext)) return rt.thumbnail.showRaw;
  return rt.thumbnail.showNonImages;
}

function entityExtension(entity: any): string {
  const direct = (entity?.extension || '').toLowerCase().replace(/^\./, '');
  if (direct) return direct;
  const name = String(entity?.name || '');
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

/** XYplorer-style color filter evaluation for list rows */
/** Synthetic / virtual entities should not participate in filesystem color rules */
export function isSyntheticFsEntity(entity: any): boolean {
  if (!entity) return true;
  if (entity.driveInfo) return true;
  if (typeof entity.id === 'string' && entity.id.startsWith('drive-')) return true;
  if (entity.isVirtual || entity.isSynthetic) return true;
  return false;
}

export function evaluateColorFilter(
  entity: any,
  filters?: AppConfig['colorFilters'],
  config?: AppConfig
): { className?: string; inlineStyle?: Record<string, string>; folderIcon?: string } | null {
  if (config && buildSettingsRuntime(config).list.applyColorFilters === false) return null;
  if (!filters?.length || !entity || isSyntheticFsEntity(entity)) return null;

  const name = entity.name || '';
  const ext = (entity.extension || '').toLowerCase();
  const attrs: string[] = entity.attributes || [];
  const size = entity.size ?? 0;
  const modified = entity.modified ? new Date(entity.modified) : null;

  for (const row of filters) {
    if (!row.c || !row.t) continue;
    if (matchesColorFilter(row.t.trim(), { name, ext, attrs, size, modified, entity })) {
      const parsed = parseFilterStyle(row.style);
      const drawClasses = config ? [
        config.drawBackgroundColorsAsRoundedRectangles ? 'bndz-filter-bg-rounded' : '',
        config.drawBackgroundColorsInDistinctiveShapes ? 'bndz-filter-bg-shape' : '',
        config.drawBackgroundColorsAsWideAsTheColumn ? 'bndz-filter-bg-wide' : '',
      ].filter(Boolean).join(' ') : '';
      const nameOnly = !!config?.applyTextColorsToTheNameColumnOnly;
      const folderIcon = (row as { folderIcon?: string }).folderIcon;
      return {
        className: [parsed.className, drawClasses].filter(Boolean).join(' ') || undefined,
        inlineStyle: nameOnly
          ? (parsed.inlineStyle?.color ? { color: parsed.inlineStyle.color } : undefined)
          : parsed.inlineStyle,
        folderIcon: folderIcon || undefined,
      };
    }
  }
  return null;
}

function matchesColorFilter(
  expr: string,
  ctx: { name: string; ext: string; attrs: string[]; size: number; modified: Date | null; entity: any }
): boolean {
  const lower = expr.toLowerCase();

  if (expr.startsWith('*.') || expr.includes(';')) {
    const patterns = expr.split(';').map(p => p.trim().replace(/^\*\./, ''));
    return patterns.some(p => ctx.ext === p.toLowerCase() || ctx.name.toLowerCase().endsWith('.' + p.toLowerCase()));
  }

  if (lower.startsWith('len:')) {
    const m = expr.match(/len:([><=]+)?(\d+)/i);
    if (m) {
      const op = m[1] || '>';
      const n = parseInt(m[2], 10);
      if (op.includes('>')) return ctx.name.length > n;
      if (op.includes('<')) return ctx.name.length < n;
      return ctx.name.length === n;
    }
  }

  if (lower.startsWith('size:')) {
    const n = parseInt(expr.replace(/size:/i, '').trim(), 10);
    return ctx.size === (isNaN(n) ? 0 : n);
  }

  if (lower.startsWith('attr:')) {
    const attr = expr.replace(/attr:/i, '').trim().toLowerCase();
    if (attr === 'd' || attr === 'directory') return ctx.entity.type === 'directory';
    if (attr === 'junction') return attrsIncludes(ctx.attrs, 'reparse');
    return attrsIncludes(ctx.attrs, 'hidden') && attr === 'system'
      ? ctx.attrs.includes('system')
      : attrsIncludes(ctx.attrs, attr);
  }

  if (lower.startsWith('agem:') && ctx.modified) {
    const ageMin = (Date.now() - ctx.modified.getTime()) / 60000;
    const m = expr.match(/agem:\s*<=\s*(\d+)/i);
    if (m) return ageMin <= parseInt(m[1], 10);
    if (lower.includes('d')) {
      return ctx.modified.toDateString() === new Date().toDateString();
    }
  }

  return false;
}

function attrsIncludes(attrs: string[], token: string): boolean {
  return attrs.some(a => a.toLowerCase().includes(token));
}

function parseFilterStyle(style: string): { className?: string; inlineStyle?: Record<string, string> } {
  if (!style) return {};
  const result: { className?: string; inlineStyle?: Record<string, string> } = { className: style };
  const bgMatch = style.match(/bg-\[([^\]]+)\]/);
  const textMatch = style.match(/text-\[([^\]]+)\]/);
  if (bgMatch || textMatch) {
    result.inlineStyle = {};
    if (bgMatch) result.inlineStyle.backgroundColor = bgMatch[1];
    if (textMatch) result.inlineStyle.color = textMatch[1];
  }
  return result;
}

export function isPreviewEnabledForExt(ext: string, config: AppConfig): boolean {
  if (!ext) return false;
  const e = ext.toLowerCase().replace(/^\./, '');
  const categories = config.previewCategories || [];
  const formats = config.previewFormats || [];

  const categoryMap: Record<string, string[]> = {
    'Text Files': ['txt', 'ini', 'bat', 'log', 'md', 'csv', 'cfg', 'json', 'xml', 'html', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'cpp', 'c', 'h', 'cs', 'yaml', 'yml', 'toml', 'sh', 'ps1', 'rs', 'go', 'java', 'kt', 'sql', 'lua', 'rb', 'php', 'vue', 'svelte'],
    'Image Files': ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tif', 'tiff', 'avif', 'heic', 'heif', 'psd', 'xcf', 'raw', 'cr2', 'nef', 'dng', 'exr', 'apng', 'jfif'],
    'Audio Files': ['mp3', 'wav', 'ogg', 'oga', 'flac', 'aac', 'm4a', 'wma', 'opus', 'aiff', 'mid', 'midi', 'ape', 'wv', 'ac3', 'dts', 'caf'],
    'Video Files': ['mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'm4v', 'mpg', 'mpeg', '3gp', 'ts', 'm2ts', 'flv', 'ogv', 'mts'],
    'Document Files': ['pdf', 'docx', 'xlsx', 'odt', 'doc', 'xls', 'ppt', 'pptx', 'rtf', 'epub', 'mobi', 'azw', 'cbz', 'cbr'],
    'Archive Files': ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'cab', 'iso', 'jar', 'torrent', 'zst', 'lz', 'arj'],
    'Web Files': ['htm', 'html', 'svg', 'url', 'xml', 'mhtml', 'xhtml', 'rss', 'atom'],
    'Font Files': ['ttf', 'otf', 'fon', 'woff', 'woff2', 'eot', 'ttc', 'pfm', 'pfb'],
    '3D Model Files': ['glb', 'gltf', 'obj', 'stl', 'fbx', 'dae', 'ply', 'usdz', '3ds'],
  };

  for (const cat of categories) {
    if (!cat.c) continue;
    const exts = categoryMap[cat.n];
    if (exts?.includes(e)) return true;
  }

  return formats.some(f => f.c && f.n.toLowerCase().includes(`*.${e}`));
}

const COLOR_CSS_MAP: [string, string][] = [
  ['--tree-text', 'colorConfig1'],
  ['--tree-bg', 'colorConfig2'],
  ['--toolbar-text', 'colorConfig3'],
  ['--toolbar-bg', 'colorConfig4'],
  ['--status-text', 'colorConfig5'],
  ['--tab-active-text', 'colorConfig6'],
  ['--tab-active-bg', 'colorConfig7'],
  ['--tab-inactive-text', 'colorConfig8'],
  ['--tab-inactive-bg', 'colorConfig9'],
  ['--list-text', 'colorConfig10'],
  ['--list-bg', 'colorConfig11'],
  ['--list-alt-bg', 'colorConfig12'],
  ['--list-hover-bg', 'colorConfig13'],
  ['--list-selected-bg', 'colorConfig14'],
  ['--list-focused-bg', 'colorConfig15'],
  ['--header-text', 'colorConfig16'],
  ['--header-bg', 'colorConfig17'],
  ['--preview-bg', 'colorConfig18'],
  ['--preview-text', 'colorConfig19'],
  ['--sidebar-accent', 'colorConfig20'],
  ['--pane-divider', 'colorConfig21'],
  ['--breadcrumb-text', 'colorConfig22'],
  ['--breadcrumb-bg', 'colorConfig23'],
  ['--search-highlight', 'colorConfig24'],
  ['--tag-bg', 'colorConfig25'],
  ['--tag-text', 'colorConfig26'],
  ['--menu-bg', 'colorConfig27'],
  ['--menu-text', 'colorConfig28'],
  ['--scrollbar-thumb', 'colorConfig29'],
  ['--highlight-text', 'colorConfig30'],
  ['--highlight-bg', 'colorConfig31'],
  ['--filter-match', 'colorConfig32'],
  ['--unfocused-highlight-bg', 'colorConfig33'],
  ['--tree-trace', 'colorConfig34'],
  ['--location-pin', 'colorConfig35'],
  ['--col-accent-name', 'colorConfig36'],
  ['--col-accent-type', 'colorConfig37'],
  ['--col-accent-size', 'colorConfig38'],
  ['--col-accent-modified', 'colorConfig39'],
  ['--col-accent-created', 'colorConfig40'],
  ['--col-accent-attributes', 'colorConfig41'],
  ['--col-accent-tags', 'colorConfig42'],
  ['--col-accent-label', 'colorConfig43'],
  ['--col-accent-comment', 'colorConfig44'],
  ['--col-accent-path', 'colorConfig45'],
  ['--statusbar-bg', 'colorConfig46'],
];

/** Map custom colorConfig onto theme chrome variables (sidebar, list, tabs, etc.) */
const THEME_CHROME_COLOR_MAP: [string, string][] = [
  ['--bg-main', 'colorConfig11'],
  ['--sidebar-bg', 'colorConfig2'],
  ['--text-main', 'colorConfig1'],
  ['--toolbar-bg', 'colorConfig4'],
  ['--toolbar-text', 'colorConfig3'],
  ['--statusbar-bg', 'colorConfig46'],
  ['--status-text', 'colorConfig5'],
  ['--text-muted', 'colorConfig5'],
  ['--list-bg', 'colorConfig11'],
  ['--list-text', 'colorConfig10'],
  ['--list-hover', 'colorConfig13'],
  ['--list-selected', 'colorConfig14'],
  ['--list-selected-border', 'colorConfig20'],
  ['--list-text-secondary', 'colorConfig16'],
  ['--tab-active-bg', 'colorConfig7'],
  ['--tab-active-text', 'colorConfig6'],
  ['--tab-inactive-bg', 'colorConfig9'],
  ['--tab-inactive-text', 'colorConfig8'],
  ['--panel-preview-bg', 'colorConfig18'],
  ['--panel-preview-text', 'colorConfig19'],
  ['--panel-bottom-bg', 'colorConfig18'],
  ['--panel-bottom-text', 'colorConfig19'],
  ['--accent', 'colorConfig20'],
  ['--scrollbar-thumb', 'colorConfig29'],
  ['--breadcrumb-bg', 'colorConfig23'],
  ['--breadcrumb-text', 'colorConfig22'],
  ['--tooltip-bg', 'colorConfig27'],
  ['--tooltip-text', 'colorConfig28'],
  ['--tooltip-muted', 'colorConfig5'],
  ['--tooltip-accent', 'colorConfig20'],
  ['--tooltip-border', 'colorConfig21'],
];

const DEDICATED_TOOLTIP_COLOR_KEYS: [string, string][] = [
  ['--tooltip-bg', 'tooltipBackgroundColor'],
  ['--tooltip-text', 'tooltipTextColor'],
  ['--tooltip-muted', 'tooltipMutedColor'],
];

function isFillValue(val: unknown): val is string {
  return typeof val === 'string' && (val.startsWith('#') || val.startsWith('{') || val.includes('gradient('));
}

function cssVarAcceptsGradient(cssVar: string): boolean {
  return (
    cssVar.includes('-bg') ||
    cssVar === '--scrollbar-thumb' ||
    cssVar === '--list-hover' ||
    cssVar === '--list-selected' ||
    cssVar === '--list-selected-bg' ||
    cssVar === '--list-focused-bg' ||
    cssVar === '--list-hover-bg' ||
    cssVar === '--list-alt-bg' ||
    cssVar === '--search-highlight' ||
    cssVar === '--filter-match' ||
    cssVar === '--highlight-bg' ||
    cssVar === '--unfocused-highlight-bg' ||
    cssVar === '--tag-bg' ||
    cssVar === '--plugin-hero-fill' ||
    cssVar === '--command-deck-fill'
  );
}

function applyFillVar(root: HTMLElement, cssVar: string, raw: unknown): void {
  if (!isFillValue(raw)) return;
  const value = cssVarAcceptsGradient(cssVar) ? fillToBackground(raw) : fillToSolid(raw);
  root.style.setProperty(cssVar, value);
  // Keep sidebar chrome token in lockstep with tree background so theme CSS
  // cannot fight a custom (including gradient) tree fill.
  if (cssVar === '--tree-bg') {
    root.style.setProperty('--sidebar-bg', value);
  }
}

function applyStatusNeonAndPluginHeroVars(config: AppConfig, root: HTMLElement): void {
  const neon = fillToSolid(config.colorConfig20, '#007acc');
  if (neon.startsWith('#')) {
    root.style.setProperty('--status-neon', neon);
    root.style.setProperty('--status-neon-soft', `${neon}28`);
    root.style.setProperty('--status-neon-mid', `${neon}0a`);
    root.style.setProperty('--status-neon-glow', `${neon}59`);
  }

  // Themes already set a classic-shaped, theme-colored --plugin-hero-fill.
  // Only override when the user set an explicit custom fill in Colors.
  // Treat legacy fully-transparent end-stop fills as "no custom" so the visible
  // classic/theme wash is restored instead of a flat navy strip.
  const raw47 = config.colorConfig47;
  const hasHeroFill =
    typeof raw47 === 'string' &&
    (raw47.startsWith('{') || raw47.includes('gradient(') ||
      (raw47.startsWith('#') && (isFillValue(config.colorConfig48) || isFillValue(config.colorConfig49))));

  if (!hasHeroFill) return;

  const heroSerialized = migratePluginHeroFill(raw47, config.colorConfig48, config.colorConfig49);
  const heroBg = fillToBackground(heroSerialized);
  const looksLikeInvisibleWash =
    /transparent\s+100%|#00000000|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)\s*100%/i.test(heroBg) &&
    !/38bdf8|rgba\(\s*56\s*,\s*189\s*,\s*248/i.test(heroBg);

  if (heroBg.includes('gradient') && !looksLikeInvisibleWash) {
    root.style.setProperty('--plugin-hero-fill', heroBg);
    root.style.setProperty('--plugin-hero-edge', `${fillToSolid(config.colorConfig20, '#38bdf8')}29`);
    root.dataset.pluginHeroThemed = 'true';
  }
}

function applyCommandDeckVars(config: AppConfig, root: HTMLElement): void {
  const raw50 = config.colorConfig50;
  if (isFillValue(raw50)) {
    root.style.setProperty('--command-deck-fill', fillToBackground(raw50));
  }
  const raw51 = config.colorConfig51;
  if (isFillValue(raw51)) {
    const solid = fillToSolid(raw51);
    root.style.setProperty('--command-deck-border', solid);
  }
}

function applyColorCssVars(config: AppConfig, root: HTMLElement): void {
  for (const [cssVar, configKey] of COLOR_CSS_MAP) {
    applyFillVar(root, cssVar, config[configKey]);
  }
  for (const [cssVar, configKey] of THEME_CHROME_COLOR_MAP) {
    const val = config[configKey];
    if (!isFillValue(val)) continue;
    applyFillVar(root, cssVar, val);
    if (cssVar === '--accent') {
      const solid = fillToSolid(val);
      root.style.setProperty('--accent-muted', `${solid}33`);
    }
  }
  for (const [cssVar, configKey] of DEDICATED_TOOLTIP_COLOR_KEYS) {
    applyFillVar(root, cssVar, config[configKey]);
  }
  applyStatusNeonAndPluginHeroVars(config, root);
  applyCommandDeckVars(config, root);
  const listSel = config.listSelectionHighlightColor;
  if (typeof listSel === 'string' && listSel.trim()) {
    const solid = listSel.trim().startsWith('#') ? listSel.trim() : `#${listSel.trim()}`;
    root.style.setProperty('--list-selected-bg', solid);
    root.style.setProperty('--list-focused-bg', solid);
    root.style.setProperty('--highlight-bg', solid);
    root.style.setProperty('--tree-trace', solid);
    root.style.setProperty('--bndz-files-selected', `${solid}57`);
    root.style.setProperty('--bndz-files-selected-hover', `${solid}66`);
  }
  const radius = config.tooltipCornerRadius;
  if (typeof radius === 'number' && radius >= 0) {
    root.style.setProperty('--tooltip-radius', `${radius}px`);
  }
}

const COLUMN_ACCENT_CSS_MAP: [string, string][] = [
  ['--col-accent-name', 'colorConfig36'],
  ['--col-accent-type', 'colorConfig37'],
  ['--col-accent-size', 'colorConfig38'],
  ['--col-accent-modified', 'colorConfig39'],
  ['--col-accent-created', 'colorConfig40'],
  ['--col-accent-attributes', 'colorConfig41'],
  ['--col-accent-tags', 'colorConfig42'],
  ['--col-accent-label', 'colorConfig43'],
  ['--col-accent-comment', 'colorConfig44'],
  ['--col-accent-path', 'colorConfig45'],
];

function applyColumnAccentCssVars(config: AppConfig, root: HTMLElement): void {
  for (const [cssVar, configKey] of COLUMN_ACCENT_CSS_MAP) {
    const raw = config[configKey];
    const fallback = SETTINGS_DEFAULTS[configKey];
    const source = isFillValue(raw) ? raw : (typeof fallback === 'string' ? fallback : undefined);
    if (source) root.style.setProperty(cssVar, fillToSolid(source));
  }
}

function clearColorCssVars(root: HTMLElement): void {
  for (const [cssVar] of COLOR_CSS_MAP) root.style.removeProperty(cssVar);
  for (const [cssVar] of THEME_CHROME_COLOR_MAP) root.style.removeProperty(cssVar);
  for (const [cssVar] of DEDICATED_TOOLTIP_COLOR_KEYS) root.style.removeProperty(cssVar);
  root.style.removeProperty('--accent-muted');
  root.style.removeProperty('--tooltip-radius');
  root.style.removeProperty('--status-neon');
  root.style.removeProperty('--status-neon-soft');
  root.style.removeProperty('--status-neon-mid');
  root.style.removeProperty('--status-neon-glow');
  // Do NOT clear --plugin-hero-fill / edge — that flattened heroes to a solid panel.
}

import { buildPanelTypographyCssVars } from './panelTypography';

function readSelectString(config: AppConfig, key: string, fallback: string): string {
  const v = config[key as keyof AppConfig];
  if (typeof v === 'string' && v.length > 0) return v;
  const def = SETTINGS_DEFAULTS[key];
  return typeof def === 'string' ? def : fallback;
}

function applyListStyleDataset(config: AppConfig, root: HTMLElement): void {
  const borderRaw = readSelectString(config, 'listSelectionBorderStyle', 'No border');
  root.dataset.listSelectionBorder = borderRaw === 'Solid border'
    ? 'solid'
    : borderRaw === 'Dashed border'
      ? 'dashed'
      : 'none';

  const shapeRaw = readSelectString(config, 'listSelectionChromeStyle', 'BNDZ Style (Rounded)');
  root.dataset.listSelectionShape = shapeRaw === 'Windows Native'
    ? 'native'
    : shapeRaw === 'Flat'
      ? 'flat'
      : 'rounded';

  const focusRaw = readSelectString(config, 'listSelectionFillStyle', 'Solid');
  root.dataset.listSelectionFocus = focusRaw === 'Gradient'
    ? 'gradient'
    : focusRaw === 'Transparent'
      ? 'transparent'
      : 'solid';

  const traceWidth = parseInt(readSelectString(config, 'listHoverFadeSteps', '2'), 10) || 2;
  root.style.setProperty('--tree-trace-width', `${traceWidth}px`);

  const lineSpacing = parseInt(readSelectString(config, 'listGridLineWidth', '2'), 10) || 2;
  const overallSpacing = parseInt(readSelectString(config, 'listSortArrowSize', '6'), 10) || 6;
  root.style.setProperty('--bndz-list-line-spacing', `${lineSpacing}px`);
  root.style.setProperty('--bndz-list-overall-spacing', `${overallSpacing}px`);

  root.dataset.translucentSelection = config.translucentSelectionBox ? 'true' : 'false';
  root.dataset.semiTransparentGrid = config.semiTransparentGridColor ? 'true' : 'false';
  root.dataset.mirrorTreeBoxInList = config.mirrorTreeBoxColorInList ? 'true' : 'false';
  root.dataset.matchTraceBreadcrumb = config.matchColorWithBreadcrumbBar ? 'true' : 'false';
  root.dataset.matchPinTrace = config.matchColorWithTreePathTracing ? 'true' : 'false';

  const selChrome = config.listSelectionChrome === 'nameOnly' || config.listSelectionChrome === 'throughSecondColumn'
    ? config.listSelectionChrome
    : 'fullRow';
  root.dataset.listSelChrome = selChrome;

  const zebraIntensity = String(config.listZebraStyle || '').includes('(2)') ? '2' : '1';
  root.dataset.zebraIntensity = zebraIntensity;
  // Visible zebra even when the color pack is off (avoid near-invisible #1e1e1e on dark lists).
  if (!config.applyColors) {
    root.style.setProperty(
      '--list-alt-bg',
      zebraIntensity === '2' ? 'rgba(255,255,255,0.075)' : 'rgba(255,255,255,0.042)',
    );
  } else {
    const cur = root.style.getPropertyValue('--list-alt-bg').trim();
    if (!cur || cur === '#1e1e1e' || cur === '#1E1E1E') {
      root.style.setProperty(
        '--list-alt-bg',
        zebraIntensity === '2' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.045)',
      );
    }
  }

  if (config.matchColorWithBreadcrumbBar) {
    const trace = config.colorConfig23;
    if (typeof trace === 'string' && trace.startsWith('#')) {
      root.style.setProperty('--tree-trace', trace);
    }
  }
  if (config.matchColorWithTreePathTracing) {
    const pin = config.colorConfig34;
    if (typeof pin === 'string' && pin.startsWith('#')) {
      root.style.setProperty('--location-pin', pin);
    }
  }

  const darkness = parseInt(readSelectString(config, 'listSelectionOpacity', '20'), 10);
  const contrast = parseInt(readSelectString(config, 'listHoverOpacity', '15'), 10);
  const tint = parseInt(readSelectString(config, 'listInactiveOpacity', '0'), 10);
  root.dataset.darknessLevel = String(Number.isFinite(darkness) ? darkness : 20);
  root.dataset.textContrast = String(Number.isFinite(contrast) ? contrast : 15);
  root.dataset.colorTint = String(Number.isFinite(tint) ? tint : 0);
  const brightness = 0.58 + ((100 - Math.min(100, Math.max(0, darkness))) / 100) * 0.42;
  root.style.setProperty('--bndz-chrome-brightness', String(brightness));
  root.style.setProperty('--bndz-text-contrast-mix', `${Math.min(100, Math.max(0, contrast))}%`);
  root.style.setProperty('--bndz-color-tint-mix', `${Math.min(100, Math.max(0, tint))}%`);
}

export function applySettingsRuntime(config: AppConfig): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const rt = buildSettingsRuntime(config);

  syncAllSettingsToDocument(config);
  applySettingsBehavior(config);

  root.style.setProperty('--bndz-font-size', `${rt.ui.fontSize}px`);
  root.style.setProperty('--bndz-font-family', rt.ui.fontFamily);
  root.style.setProperty('--bndz-font-family-mono', rt.ui.fontFamilyMono);
  root.style.setProperty('--bndz-tab-font-size', `${rt.ui.tabFontSize}px`);
  root.style.setProperty('--bndz-tab-bar-height', `${rt.ui.tabBarHeight}px`);
  root.style.setProperty('--bndz-row-height', `${rt.ui.rowHeight}px`);

  const panelFontVars = buildPanelTypographyCssVars(config);
  for (const [key, value] of Object.entries(panelFontVars)) {
    root.style.setProperty(key, value);
  }
  root.style.setProperty('--bndz-preview-delay', `${rt.preview.delayMs}ms`);
  root.dataset.showExtensions = String(rt.list.showExtensions);
  root.dataset.sortFoldersFirst = String(rt.sort.foldersFirst);
  root.dataset.nativeThumbnails = String(rt.thumbnail.enabled);
  root.dataset.dualPane = String(rt.tabs.dualPane);
  root.dataset.theme = rt.ui.theme;
  root.dataset.applyColors = String(rt.ui.applyColors);
  root.dataset.confirmDelete = String(rt.shell.confirmDelete);
  root.dataset.hoverSelect = String(rt.mouse.hoverSelect);
  root.dataset.highlightHovered = String(rt.mouse.highlightHovered);
  root.dataset.globalSearchPrefix = String(rt.search.globalPrefix);
  root.dataset.listFontAa = config.listFontLcdAa === false ? 'greyscale' : 'lcd';
  root.classList.toggle('bndz-compact', rt.ui.compactMode);
  root.classList.toggle('bndz-adaptive-colors', rt.ui.adaptiveColors);
  root.classList.toggle('bndz-vertical-grid', rt.list.verticalGridLines);
  root.classList.toggle('bndz-underline-selected', rt.list.underlineSelected);
  root.classList.toggle('theme-macos-sonoma', config.theme === 'macOS Sonoma');
  root.classList.toggle('theme-macos-light', config.theme === 'macOS Light');

  if (rt.ui.applyColors) {
    if (config.theme) applyThemeByName(config.theme);
    else {
      // No named theme — still paint classic hero and mark themed off so CSS hardcode shows.
      root.dataset.pluginHeroThemed = 'false';
    }
    applyColorCssVars(config, root);
  } else {
    clearColorCssVars(root);
    if (config.theme) applyThemeByName(config.theme);
    else root.dataset.pluginHeroThemed = 'false';
    applyStatusNeonAndPluginHeroVars(config, root);
  }

  // Column header accents stay personalizable even when the global color pack is off.
  applyColumnAccentCssVars(config, root);

  document.body.style.fontSize = `${rt.ui.fontSize}px`;
  document.body.style.fontFamily = rt.ui.fontFamily;

  const scale = typeof config.interfaceScale === 'number'
    ? Math.min(150, Math.max(80, config.interfaceScale))
    : 100;
  const scaleFactor = scale / 100;
  root.style.setProperty('--bndz-interface-scale', String(scaleFactor));
  if (typeof document !== 'undefined') {
    document.documentElement.style.zoom = scaleFactor === 1 ? '' : String(scaleFactor);
  }

  applyAppearanceVariants(config, root);
  applyListStyleDataset(config, root);

  import('./shellIntegrationRuntime').then(({ scheduleBackendSettings }) => {
    scheduleBackendSettings(config);
  });
}

export function applyBackendSettings(config: AppConfig): void {
  import('./shellIntegrationRuntime').then(({ scheduleBackendSettings }) => {
    scheduleBackendSettings(config, true);
  });
}
