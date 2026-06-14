import type { HoverTooltipContent, HoverTooltipTheme } from '../components/HoverTooltip';
import {
  getFloatingTooltip,
  hideFloatingTooltip,
  setHoverPending,
  updateHoverPendingPosition,
} from './floatingTooltip';

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

/** Rich hover tooltips — requires file info tips (or hover box) to be enabled */
export function shouldShowRichTooltips(config: Record<string, any>): boolean {
  if (config.enableRichHoverTooltips === false) return false;
  if (config.showFileInfoTips === false && config.showHoverBox !== true) return false;
  return true;
}

/** Shift required by default; only disabled when user explicitly turns off the setting */
export function isShiftRequiredForTooltips(config: Record<string, any>): boolean {
  return config.onlyWhileTheShiftKeyIsHeldDown !== false;
}

export function shouldShowTooltipForEntity(entity: any, config: Record<string, any>): boolean {
  if (!shouldShowRichTooltips(config)) return false;
  const ext = (entity?.extension || '').toLowerCase();
  const isExe = ext === 'exe' || ext === 'msi' || ext === 'bat' || ext === 'cmd';
  if (isExe && config.forExecutablesAsWell === false) return false;
  return true;
}

export function shouldShowTreeTooltip(config: Record<string, any>): boolean {
  if (!shouldShowRichTooltips(config)) return false;
  if (config.inTreeAsWell === false) return false;
  return true;
}

/** Suppress native browser title tooltips when rich shift-tooltips are active */
export function shouldSuppressNativeEntityTitle(config: Record<string, any>): boolean {
  return shouldShowRichTooltips(config) && isShiftRequiredForTooltips(config);
}

/** Hover an item, then hold Shift to reveal the tooltip beside the cursor */
export function bindFloatingTooltipHandlers(
  content: HoverTooltipContent | null,
  config: Record<string, any>,
): {
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
} {
  const theme = (config.hoverTooltipTheme as HoverTooltipTheme) || 'glass';
  const requireShift = isShiftRequiredForTooltips(config);

  return {
    onMouseEnter: (e) => {
      if (!content) return;
      // Only show immediately when user explicitly disabled shift requirement
      setHoverPending(content, e.clientX, e.clientY, theme, !requireShift);
    },
    onMouseMove: (e) => {
      if (!content) return;
      if (getFloatingTooltip() || requireShift) {
        scheduleTooltipMove(e.clientX, e.clientY);
      }
    },
    onMouseLeave: () => hideFloatingTooltip(),
  };
}

// Re-export for components that subscribe to shift changes
export { subscribeShiftKey, subscribeShiftKey as subscribeTooltipKeys } from './floatingTooltip';
