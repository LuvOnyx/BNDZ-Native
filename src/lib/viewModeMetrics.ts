/** Derive grid/list tile geometry from icon size slider values.
 *  Tiles are fixed-size (never stretch with 1fr) so icons stay packed like Explorer.
 */

export function gridTileMetrics(gridIconSize: number) {
  const icon = Math.max(16, Math.min(192, gridIconSize));
  // Tile width hugs the icon — label wraps inside this width.
  const minWidth = Math.max(72, icon + Math.round(icon * 0.35) + 16);
  const padding = Math.max(4, Math.round(icon * 0.06));
  const labelBlock = Math.max(26, Math.min(36, Math.round(16 + icon * 0.1)));
  const gap = Math.max(4, Math.min(10, Math.round(icon / 14)));
  const iconSlot = icon + 4;
  const rowHeight = padding * 2 + iconSlot + labelBlock;
  return {
    icon,
    minWidth,
    /** Fixed column width for auto-fill grids (no 1fr stretch). */
    tileWidth: minWidth,
    rowHeight,
    stride: rowHeight + gap,
    gap,
    padding,
    labelBlock,
    marqueePad: Math.max(4, Math.round(gap * 0.5)),
    iconSlot,
  };
}

/** This PC drive cards — scale with the same icon size slider as folders. */
export function driveGridMetrics(gridIconSize: number) {
  const icon = Math.max(28, Math.min(120, gridIconSize));
  const minWidth = Math.max(140, icon + 48);
  const gap = Math.max(6, Math.min(12, Math.round(icon / 12)));
  const rowHeight = icon + 62;
  return {
    icon,
    minWidth,
    tileWidth: minWidth,
    rowHeight,
    stride: rowHeight + gap,
    gap,
  };
}

export function driveListMetrics(listIconSize: number) {
  const icon = Math.max(16, Math.min(64, listIconSize));
  const t = (icon - 16) / (64 - 16);
  const tileWidth = Math.round(220 + t * 160);
  const gap = Math.max(4, Math.round(4 + t * 6));
  const padX = Math.max(6, Math.round(6 + t * 6));
  const padY = Math.max(4, Math.round(4 + t * 6));
  const rowHeight = Math.max(40, icon + padY * 2 + 8);
  return {
    icon,
    tileWidth,
    rowHeight,
    stride: rowHeight + gap,
    gap,
    padX,
    padY,
  };
}

/** Details / default list-row metrics from icon size slider. */
export function detailsTileMetrics(detailsIconSize: number) {
  const icon = Math.max(12, Math.min(48, detailsIconSize));
  const padY = Math.max(3, Math.round(2 + icon * 0.12));
  const rowHeight = Math.max(24, icon + padY * 2);
  const iconColClass = icon <= 16 ? 'w-5' : icon <= 24 ? 'w-7' : icon <= 32 ? 'w-9' : 'w-11';
  return { icon, rowHeight, padY, iconColClass };
}

/**
 * Explorer-style List view metrics.
 * Low slider = dense multi-column name list (small icons, many columns).
 * High slider = large icon+name tiles (few columns) — formatting shifts like Grid.
 */
export function listTileMetrics(listIconSize: number) {
  const icon = Math.max(12, Math.min(96, listIconSize));
  const t = (icon - 12) / (96 - 12); // 0 = densest, 1 = largest
  // Wide range so 0% vs 100% clearly changes column count (not just icon size).
  const tileWidth = Math.round(88 + t * 252); // 88 → 340
  const gap = Math.max(2, Math.min(14, Math.round(2 + t * 12)));
  const padY = Math.max(1, Math.round(1 + t * 10));
  const padX = Math.max(4, Math.round(4 + t * 10));
  const rowHeight = Math.max(18, icon + padY * 2);
  const iconSlot = Math.max(14, icon + 2);
  return {
    icon,
    tileWidth,
    rowHeight,
    stride: rowHeight + gap,
    iconSlot,
    gap,
    padY,
    padX,
  };
}
