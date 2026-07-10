import type { HoverTooltipContent, HoverTooltipTheme } from '../components/HoverTooltip';
import {
  getFloatingTooltip,
  hideFloatingTooltip,
  setHoverPending,
  updateHoverPendingPosition,
} from './floatingTooltip';
import {
  DEFAULT_HOVER_BOX_CONTEXTS,
  DEFAULT_HOVER_BOX_ITEM_TYPES,
  type HoverBoxContext,
  hoverBoxAllowsContext,
  hoverBoxAllowsEntity,
} from './hoverBoxConfig';

let moveRaf: number | null = null;
let pendingMove: { x: number; y: number } | null = null;

function scheduleTooltipMove(x: number, y: number) {
  pendingMove = { x, y };
  if (moveRaf != null) return;
  moveRaf = requestAnimationFrame(() => {
    moveRaf = null;
    if (pendingMove) updateHoverPendingPosition(pendingMove.x, pendingMove.y);
    pendingMove = null;
  });
}

export function showPhotoDataInHoverBox(config: Record<string, any>): boolean {
  return config.showPhotoDataInTheHoverBox !== false;
}

export function shouldShowRichTooltips(config: Record<string, any>): boolean {
  if (config.enableRichHoverTooltips === false) return false;
  if (config.showFileInfoTips === false && config.showHoverBox !== true) return false;
  return true;
}

export function isShiftRequiredForTooltips(config: Record<string, any>): boolean {
  if (config.showHoverBox && config.showFileInfoTips === false) return false;
  return config.onlyWhileTheShiftKeyIsHeldDown !== false;
}

export function shouldShowTooltipForEntity(
  entity: any,
  config: Record<string, any>,
  context: HoverBoxContext = 'list',
): boolean {
  if (!shouldShowRichTooltips(config)) return false;
  const ext = (entity?.extension || '').toLowerCase();
  const isExe = ext === 'exe' || ext === 'msi' || ext === 'bat' || ext === 'cmd';
  if (isExe && config.forExecutablesAsWell === false) return false;

  if (config.showHoverBox) {
    const types = config.hoverBoxItemTypes?.length ? config.hoverBoxItemTypes : DEFAULT_HOVER_BOX_ITEM_TYPES;
    const contexts = config.hoverBoxContexts?.length ? config.hoverBoxContexts : DEFAULT_HOVER_BOX_CONTEXTS;
    if (!hoverBoxAllowsEntity(entity, types)) return false;
    if (!hoverBoxAllowsContext(context, contexts)) return false;
  }

  return true;
}

export function shouldShowTreeTooltip(config: Record<string, any>): boolean {
  if (!shouldShowRichTooltips(config)) return false;
  if (config.inTreeAsWell === false) return false;
  return hoverBoxAllowsContext('tree', config.hoverBoxContexts) || config.showFileInfoTips !== false;
}

export function shouldSuppressNativeEntityTitle(config: Record<string, any>): boolean {
  return shouldShowRichTooltips(config) && isShiftRequiredForTooltips(config);
}

export type TooltipSurface = 'icon' | 'filename';

export function shouldShowTooltipOnSurface(config: Record<string, any>, surface: TooltipSurface): boolean {
  if (config.showHoverBox) {
    if (surface === 'icon') return config.whenHoveringOverTheIcon !== false;
    return config.whenHoveringOverTheFilename !== false;
  }
  if (surface === 'icon') return config.whenHoveringOverTheIcon !== false;
  return config.whenHoveringOverTheFilename !== false;
}

export function bindFloatingTooltipHandlers(
  content: HoverTooltipContent | null,
  config: Record<string, any>,
  opts?: { surface?: TooltipSurface; context?: HoverBoxContext },
): {
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
} {
  const theme = (config.hoverTooltipTheme as HoverTooltipTheme) || 'glass';
  const requireShift = isShiftRequiredForTooltips(config);
  const hoverBox = !!config.showHoverBox;
  const surface = opts?.surface ?? 'filename';

  return {
    onMouseEnter: (e) => {
      if (!content) return;
      if (!shouldShowTooltipOnSurface(config, surface)) return;
      const payload = hoverBox ? { ...content, mode: 'hoverbox' as const } : content;
      const showImmediately = hoverBox || !requireShift;
      setHoverPending(payload, e.clientX, e.clientY, theme, showImmediately);
    },
    onMouseMove: (e) => {
      if (!content) return;
      if (getFloatingTooltip() || requireShift || hoverBox) {
        scheduleTooltipMove(e.clientX, e.clientY);
      }
    },
    onMouseLeave: () => hideFloatingTooltip(),
  };
}

export { subscribeShiftKey, subscribeShiftKey as subscribeTooltipKeys } from './floatingTooltip';
