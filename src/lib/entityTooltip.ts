import type { HoverTooltipContent } from '../components/HoverTooltip';
import type React from 'react';
import { formatFsDateTime } from './listColumns';
import { formatFolderSizeLabel } from './folderSizeDisplay';
import { joinPanePath, toWindowsPath } from './pathUtils';
import {
  DEFAULT_EXTRA_FIELD_IDS,
  DEFAULT_STANDARD_FIELD_IDS,
  EXTRA_FILE_INFO_FIELDS,
  STANDARD_FILE_INFO_FIELDS,
  fieldById,
  resolveSelectedFieldIds,
} from './fileInfoTipFields';
import { showPhotoDataInHoverBox } from './tooltipSettings';
import { getExtendedMetadataCached } from './extendedMetadataCache';
import {
  bindFloatingTooltipHandlers,
  shouldShowTooltipForEntity,
  shouldShowTooltipOnSurface,
  type TooltipSurface,
} from './tooltipSettings';
import type { HoverBoxContext } from './hoverBoxConfig';
import {
  classifyTooltipMedia,
  resolveTooltipMedia,
} from './tooltipMedia';
import { hideFloatingTooltip, isShiftKeyHeld, subscribeShiftKey } from './floatingTooltip';

function formatSize(bytes?: number): string {
  if (bytes == null || bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

const AUDIO_META_KEYS = ['Duration', 'Audio Bitrate', 'Sample Rate', 'Bit Depth', 'Channels'];

/** Cool slate accent — not the legacy brown DIR badge. */
export const DIR_BADGE_COLOR = '#38bdf8';

export type EntityTooltipBuildOpts = {
  metadata?: Record<string, string>;
  md5?: string;
  hoverBox?: boolean;
  media?: HoverTooltipContent['media'];
};

export function buildEntityTooltipContent(
  entity: any,
  panePath: string,
  config: Record<string, any>,
  folderSizeMap: Record<string, number | undefined>,
  formatSizeFn: (n?: number) => string = formatSize,
  opts?: EntityTooltipBuildOpts,
): HoverTooltipContent | null {
  if (!entity) return null;
  const isDir = entity.type === 'directory';
  const fullPath = toWindowsPath(entity.path || joinPanePath(panePath, entity));
  const meta = opts?.metadata || {};
  const lines: HoverTooltipContent['lines'] = [];

  const useStandard = config.useStandardShellFileInfoTips !== false || config.showTheseFields;
  const standardIds = resolveSelectedFieldIds(
    config.shellInfoTipStandardFields,
    DEFAULT_STANDARD_FIELD_IDS,
    STANDARD_FILE_INFO_FIELDS,
  );
  const extraIds = config.extraFields
    ? resolveSelectedFieldIds(config.shellInfoTipExtraFields, DEFAULT_EXTRA_FIELD_IDS, EXTRA_FILE_INFO_FIELDS)
    : [];

  const fieldIds = [
    ...(useStandard ? standardIds : ['size', 'modified', 'type']),
    ...extraIds,
  ];

  const pushLine = (label: string, value: string, accent?: string, mono?: boolean) => {
    if (!value || value === '—') return;
    lines.push({ label, value, accent, mono });
  };

  for (const fieldId of fieldIds) {
    const field = fieldById(fieldId);
    if (!field) continue;
    switch (field.metadataKey) {
      case '__size__': {
        if (isDir) {
          const cached = folderSizeMap[fullPath.toLowerCase()];
          const sizeLabel = formatFolderSizeLabel(cached, {
            alwaysShowFolderSizes: config.alwaysShowFolderSizes,
            cacheFolderSizes: config.cacheFolderSizes,
            showCachedFolderSizesOnly: config.showCachedFolderSizesOnly,
          }, formatSizeFn);
          pushLine(field.label, sizeLabel || '—');
        } else if (entity.size != null) {
          pushLine(field.label, formatSizeFn(entity.size));
        }
        break;
      }
      case '__modified__':
        if (entity.modified) pushLine(field.label, formatFsDateTime(entity.modified));
        break;
      case '__created__':
        if (entity.created) pushLine(field.label, formatFsDateTime(entity.created));
        break;
      case '__type__':
        pushLine(field.label, entity.typeDescription || (entity.extension ? `${entity.extension.toUpperCase()} file` : isDir ? 'Folder' : 'File'));
        break;
      case '__tags__':
        if (entity.tags?.length) pushLine(field.label, entity.tags.join(', '), '#fbbf24');
        break;
      case '__path__':
        if (config.hoverTooltipShowPath !== false) {
          pushLine(field.label, fullPath.replace(/^\\+/, ''), undefined, true);
        }
        break;
      default: {
        const val = field.metadataKey === 'md5' ? opts?.md5 : meta[field.metadataKey];
        if (val) pushLine(field.label, val, undefined, field.metadataKey === 'ACL Rule');
      }
    }
  }

  if (config.showAudioInfoAndTags && !isDir) {
    for (const key of AUDIO_META_KEYS) {
      if (meta[key] && !lines.some(l => l.label === key)) {
        pushLine(key, meta[key]);
      }
    }
  }

  if (opts?.hoverBox && showPhotoDataInHoverBox(config)) {
    for (const key of ['Date Taken', 'Camera Model', 'F-Stop', 'Exposure Time', 'Focal Length', 'ISO Speed']) {
      if (meta[key] && !lines.some(l => l.label === key)) {
        pushLine(key, meta[key]);
      }
    }
  }

  if (!lines.length && !useStandard && !opts?.media) {
    if (isDir) {
      const cached = folderSizeMap[fullPath.toLowerCase()];
      const sizeLabel = formatFolderSizeLabel(cached, {
        alwaysShowFolderSizes: config.alwaysShowFolderSizes,
        cacheFolderSizes: config.cacheFolderSizes,
        showCachedFolderSizesOnly: config.showCachedFolderSizesOnly,
      }, formatSizeFn);
      if (sizeLabel) lines.push({ label: 'Size', value: sizeLabel });
    } else if (entity.size != null) {
      lines.push({ label: 'Size', value: formatSizeFn(entity.size) });
    }
    if (entity.modified) lines.push({ label: 'Modified', value: formatFsDateTime(entity.modified) });
  }

  return {
    title: entity.name,
    subtitle: isDir ? 'Folder' : entity.extension ? `.${entity.extension} file` : 'File',
    lines,
    media: opts?.media,
    badge: isDir
      ? { text: 'DIR', color: DIR_BADGE_COLOR }
      : { text: (entity.extension || 'FILE').toUpperCase().slice(0, 6), color: '#60a5fa' },
    mode: opts?.hoverBox ? 'hoverbox' : 'tip',
  };
}

type ActiveEntityHover = {
  disarm: () => void;
  tryArm: (e?: React.MouseEvent) => void;
};

let activeEntityHover: ActiveEntityHover | null = null;
let shiftHookInstalled = false;

function ensureShiftTooltipHook() {
  if (shiftHookInstalled || typeof window === 'undefined') return;
  shiftHookInstalled = true;
  subscribeShiftKey(() => {
    if (isShiftKeyHeld() && activeEntityHover) {
      activeEntityHover.tryArm();
    } else {
      hideFloatingTooltip();
    }
  });
}

export function createEntityTooltipHandlers(
  entity: any,
  panePath: string,
  config: Record<string, any>,
  folderSizeMap: Record<string, number | undefined>,
  formatSizeFn: (n?: number) => string,
  opts?: { surface?: TooltipSurface; context?: HoverBoxContext; disabled?: boolean },
) {
  ensureShiftTooltipHook();

  const surface = opts?.surface ?? 'filename';
  const context = opts?.context ?? 'list';
  if (opts?.disabled || !shouldShowTooltipForEntity(entity, config, context)) {
    return { onMouseEnter: () => {}, onMouseMove: () => {}, onMouseLeave: () => {} };
  }

  const mediaKind = entity.type !== 'directory' ? classifyTooltipMedia(entity.extension) : null;
  const needsMedia = !!mediaKind;
  const needsAudioMeta = !!config.showAudioInfoAndTags && mediaKind === 'audio';
  const needsMeta = !!config.showHoverBox || !!config.extraFields || config.showPhotoDataInTheHoverBox || needsAudioMeta;
  const hoverBox = !!config.showHoverBox;
  let cachedContent: HoverTooltipContent | null = null;
  let isHovering = false;
  let lastEvent: React.MouseEvent | null = null;
  let loadGeneration = 0;

  const loadContent = async (): Promise<HoverTooltipContent | null> => {
    if (cachedContent) return cachedContent;
    const path = toWindowsPath(entity.path || joinPanePath(panePath, entity));
    let metadata: Record<string, string> | undefined;
    let media: HoverTooltipContent['media'];

    if (entity.type !== 'directory') {
      if (needsMedia && mediaKind) {
        media = (await resolveTooltipMedia(path, mediaKind, config)) ?? undefined;
      }
      if (needsMeta || needsMedia) {
        try {
          const entry = await getExtendedMetadataCached(path, { includeMd5: false });
          metadata = entry.meta;
        } catch {
          metadata = undefined;
        }
      }
    }

    cachedContent = buildEntityTooltipContent(entity, panePath, config, folderSizeMap, formatSizeFn, {
      metadata,
      hoverBox,
      media,
    });
    return cachedContent;
  };

  const disarm = () => {
    isHovering = false;
    lastEvent = null;
    cachedContent = null;
    loadGeneration += 1;
    if (activeEntityHover?.disarm === disarm) activeEntityHover = null;
    hideFloatingTooltip();
  };

  const tryArm = async (e?: React.MouseEvent) => {
    const ev = e ?? lastEvent;
    if (!isHovering || !ev || !isShiftKeyHeld()) return;
    if (!shouldShowTooltipOnSurface(config, surface)) return;

    const generation = ++loadGeneration;
    const content = await loadContent();
    if (generation !== loadGeneration || !isHovering || !isShiftKeyHeld()) return;
    if (!content) return;

    const handlers = bindFloatingTooltipHandlers(content, config, { surface, context });
    handlers.onMouseEnter(ev);
  };

  const hoverController: ActiveEntityHover = { disarm, tryArm };

  return {
    onMouseEnter: (e: React.MouseEvent) => {
      if (!shouldShowTooltipOnSurface(config, surface)) return;
      isHovering = true;
      lastEvent = e;
      activeEntityHover = hoverController;
      if (isShiftKeyHeld()) void tryArm(e);
    },
    onMouseMove: (e: React.MouseEvent) => {
      lastEvent = e;
      if (!cachedContent || !isShiftKeyHeld()) return;
      bindFloatingTooltipHandlers(cachedContent, config, { surface, context }).onMouseMove(e);
    },
    onMouseLeave: () => disarm(),
  };
}
