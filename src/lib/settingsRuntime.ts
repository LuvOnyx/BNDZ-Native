import type { AppConfig } from '../data/configContext';
import { filterTreeListEntities } from './treeListItemFilter';
import { applyThemeByName } from '../data/themePresets';
import { applyAppearanceVariants } from './appearanceVariants';
import { SETTINGS_DEFAULTS } from './settingsDefaults';
import {
  syncAllSettingsToDocument,
  buildKeyboardMap,
  buildMouseRuntime,
  buildSearchRuntime,
  buildShellRuntime,
  buildUiRuntime,
  WIRED_KEY_COUNT,
} from './settingsWiring';

export interface PaneSortState {
  sortColumn?: 'name' | 'type' | 'size' | 'modified' | 'created';
  sortDirection?: 'asc' | 'desc';
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
  };
  sort: {
    method: string;
    foldersFirst: boolean;
    foldersAlwaysAsc: boolean;
    sortByBase: boolean;
    sizeDescDefault: boolean;
    dateDescDefault: boolean;
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
    displayTabsAsSpaces: boolean;
    utf8AutoDetection: boolean;
    transparencyBg: boolean;
    audioVideoEnabled: boolean;
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
    zebraRows: !!config.selectConfig5 && config.selectConfig5 !== 'Solid Color' && config.selectConfig5 !== false,
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
      highQuality: config.highQualityImageResampling !== false,
      nativeHandling: config.useNativeHandlingInThePreviewPane !== false,
      autoplay: config.autoplay === true || config.audioVideoPreview === 'Play once' || config.audioVideoPreview === true,
      preferBlob: config.useNativeHandlingInThePreviewPane === false,
      zoomToFit: config.zoomToFit !== false,
      displayTabsAsSpaces: config.displayTabsAsSpaces === true,
      utf8AutoDetection: config.utf8AutoDetection !== false,
      transparencyBg: config.transparencyBackground !== false,
      audioVideoEnabled: config.audioVideoPreview !== 'Disabled',
    },
    thumbnail: {
      enabled: config.enableNativeThumbnails !== false,
      highRes: config.highResNativeWindowsThumbnails !== false,
      showFolders: config.showFolderThumbnails !== false,
      showNonImages: config.showThumbnailsForNonImages !== false,
      showRaw: config.showThumbnailsForRawFiles !== false,
      showOnThumbnail: config.showFileIconOnThumbnail !== false,
      genericFast: !!config.useGenericIconsForSuperFastBrowsing,
    },
    operations: {
      autoRefresh: config.autoRefresh !== false,
      fsNotifications: config.respondToFileSystemNotifications !== false,
      refreshDuringOps: !!config.refreshDuringFileOperations,
      bypassRecycleBin: !!config.bypassRecycleBin,
    },
    tabs: {
      shadeInactive: config.shadeInactivePane !== false,
      flexibleWidth: config.flexibleTabWidth !== false,
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
    wiredKeyCount: WIRED_KEY_COUNT,
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

/** Resolve default sort column from global sortMethod setting */
export function resolveSortColumn(config: AppConfig, pane?: PaneSortState): 'name' | 'type' | 'size' | 'modified' | 'created' {
  if (pane?.sortColumn) return pane.sortColumn;
  const method = config.sortMethod || 'Natural';
  switch (method) {
    case 'Date Modified': return 'modified';
    case 'Size': return 'size';
    case 'Type': return 'type';
    default: return 'name';
  }
}

export function resolveSortDirection(
  column: 'name' | 'type' | 'size' | 'modified' | 'created',
  paneDirection: 'asc' | 'desc' | undefined,
  config: AppConfig
): 'asc' | 'desc' {
  if (paneDirection) return paneDirection;
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

  if (rt.sort.foldersFirst || config.sortFoldersApart) {
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
    const typeA = a.extension || (a.type === 'directory' ? 'folder' : '');
    const typeB = b.extension || (b.type === 'directory' ? 'folder' : '');
    return mul * String(typeA).localeCompare(String(typeB));
  }
  if (col === 'size') {
    if (config.mixedSortOnDateColumns && a.type === 'directory' && b.type !== 'directory') return -1;
    if (config.mixedSortOnDateColumns && b.type === 'directory' && a.type !== 'directory') return 1;
    return mul * ((a.size || 0) - (b.size || 0));
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
  if (col === 'tags' && config.mixedSortOnTagColumns) {
    const tagA = (a.tags || []).join(',');
    const tagB = (b.tags || []).join(',');
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (b.type === 'directory' && a.type !== 'directory') return 1;
    return mul * tagA.localeCompare(tagB);
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
export function shouldFetchNativeShellIcon(_entity: any, config: AppConfig): boolean {
  if (config.showCachedIconsOnly) return false;
  if (config.useGenericIconsForSuperFastBrowsing) return false;
  return true;
}

/** Whether to fetch a high-res thumbnail instead of / in addition to shell icon */
export function shouldFetchNativeThumbnail(entity: any, config: AppConfig): boolean {
  const rt = buildSettingsRuntime(config);
  if (!rt.thumbnail.enabled || rt.thumbnail.genericFast) return false;
  if (entity.type === 'directory') return rt.thumbnail.showFolders;
  const ext = (entity.extension || '').toLowerCase();
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico'];
  if (imageExts.includes(ext)) return true;
  if (['raw', 'cr2', 'nef', 'arw'].includes(ext)) return rt.thumbnail.showRaw;
  return rt.thumbnail.showNonImages;
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
): { className?: string; inlineStyle?: Record<string, string> } | null {
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
      const nameOnly = config?.applyTextColorsToTheNameColumnOnly;
      return {
        className: [parsed.className, drawClasses].filter(Boolean).join(' ') || undefined,
        inlineStyle: nameOnly
          ? (parsed.inlineStyle?.color ? { color: parsed.inlineStyle.color } : undefined)
          : parsed.inlineStyle,
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
];

/** Map custom colorConfig onto theme chrome variables (sidebar, list, tabs, etc.) */
const THEME_CHROME_COLOR_MAP: [string, string][] = [
  ['--bg-main', 'colorConfig11'],
  ['--sidebar-bg', 'colorConfig2'],
  ['--text-main', 'colorConfig1'],
  ['--menubar-bg', 'colorConfig27'],
  ['--toolbar-bg', 'colorConfig4'],
  ['--toolbar-text', 'colorConfig3'],
  ['--statusbar-bg', 'colorConfig17'],
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

function applyColorCssVars(config: AppConfig, root: HTMLElement): void {
  for (const [cssVar, configKey] of COLOR_CSS_MAP) {
    const val = config[configKey];
    if (typeof val === 'string' && val.startsWith('#')) root.style.setProperty(cssVar, val);
  }
  for (const [cssVar, configKey] of THEME_CHROME_COLOR_MAP) {
    const val = config[configKey];
    if (typeof val === 'string' && val.startsWith('#')) {
      root.style.setProperty(cssVar, val);
      if (cssVar === '--accent') root.style.setProperty('--accent-muted', `${val}33`);
    }
  }
  for (const [cssVar, configKey] of DEDICATED_TOOLTIP_COLOR_KEYS) {
    const val = config[configKey];
    if (typeof val === 'string' && val.startsWith('#')) root.style.setProperty(cssVar, val);
  }
  const radius = config.tooltipCornerRadius;
  if (typeof radius === 'number' && radius >= 0) {
    root.style.setProperty('--tooltip-radius', `${radius}px`);
  }
}

function clearColorCssVars(root: HTMLElement): void {
  for (const [cssVar] of COLOR_CSS_MAP) root.style.removeProperty(cssVar);
  for (const [cssVar] of THEME_CHROME_COLOR_MAP) root.style.removeProperty(cssVar);
  for (const [cssVar] of DEDICATED_TOOLTIP_COLOR_KEYS) root.style.removeProperty(cssVar);
  root.style.removeProperty('--accent-muted');
  root.style.removeProperty('--tooltip-radius');
}

import { buildPanelTypographyCssVars } from './panelTypography';

function readSelectString(config: AppConfig, key: string, fallback: string): string {
  const v = config[key as keyof AppConfig];
  if (typeof v === 'string' && v.length > 0) return v;
  const def = SETTINGS_DEFAULTS[key];
  return typeof def === 'string' ? def : fallback;
}

function applyListStyleDataset(config: AppConfig, root: HTMLElement): void {
  const borderRaw = readSelectString(config, 'selectConfig6', 'No border');
  root.dataset.listSelectionBorder = borderRaw === 'Solid border'
    ? 'solid'
    : borderRaw === 'Dashed border'
      ? 'dashed'
      : 'none';

  const shapeRaw = readSelectString(config, 'selectConfig7', 'BNDZ Style (Rounded)');
  root.dataset.listSelectionShape = shapeRaw === 'Windows Native'
    ? 'native'
    : shapeRaw === 'Flat'
      ? 'flat'
      : 'rounded';

  const focusRaw = readSelectString(config, 'selectConfig8', 'Solid');
  root.dataset.listSelectionFocus = focusRaw === 'Gradient'
    ? 'gradient'
    : focusRaw === 'Transparent'
      ? 'transparent'
      : 'solid';

  const traceWidth = parseInt(readSelectString(config, 'selectConfig9', '2'), 10) || 2;
  root.style.setProperty('--tree-trace-width', `${traceWidth}px`);

  const lineSpacing = parseInt(readSelectString(config, 'selectConfig14', '2'), 10) || 2;
  const overallSpacing = parseInt(readSelectString(config, 'selectConfig15', '6'), 10) || 6;
  root.style.setProperty('--bndz-list-line-spacing', `${lineSpacing}px`);
  root.style.setProperty('--bndz-list-overall-spacing', `${overallSpacing}px`);

  root.dataset.translucentSelection = config.translucentSelectionBox ? 'true' : 'false';
  root.dataset.semiTransparentGrid = config.semiTransparentGridColor ? 'true' : 'false';
  root.dataset.mirrorTreeBoxInList = config.mirrorTreeBoxColorInList ? 'true' : 'false';
  root.dataset.matchTraceBreadcrumb = config.matchColorWithBreadcrumbBar ? 'true' : 'false';
  root.dataset.matchPinTrace = config.matchColorWithTreePathTracing ? 'true' : 'false';

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

  const darkness = parseInt(readSelectString(config, 'selectConfig11', '20'), 10);
  const contrast = parseInt(readSelectString(config, 'selectConfig12', '15'), 10);
  const tint = parseInt(readSelectString(config, 'selectConfig13', '0'), 10);
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
  root.classList.toggle('bndz-compact', rt.ui.compactMode);
  root.classList.toggle('bndz-adaptive-colors', rt.ui.adaptiveColors);
  root.classList.toggle('bndz-vertical-grid', rt.list.verticalGridLines);
  root.classList.toggle('bndz-underline-selected', rt.list.underlineSelected);
  root.classList.toggle('theme-macos-sonoma', config.theme === 'macOS Sonoma');
  root.classList.toggle('theme-macos-light', config.theme === 'macOS Light');

  if (rt.ui.applyColors) {
    if (config.theme) applyThemeByName(config.theme);
    applyColorCssVars(config, root);
  } else {
    clearColorCssVars(root);
    applyThemeByName(config.theme);
  }

  document.body.style.fontSize = `${rt.ui.fontSize}px`;
  document.body.style.fontFamily = rt.ui.fontFamily;

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
