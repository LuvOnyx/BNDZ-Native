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
    marqueePad: 0,
    iconSlot,
  };
}

/** This PC drive cards — independent of the file-icon slider. */
export function driveGridMetrics() {
  return {
    minWidth: 156,
    tileWidth: 156,
    rowHeight: 118,
    stride: 126,
    gap: 8,
  };
}

export function driveListMetrics() {
  return {
    tileWidth: 300,
    rowHeight: 52,
    gap: 6,
  };
}

export function listTileMetrics(listIconSize: number) {
  const icon = Math.max(12, Math.min(96, listIconSize));
  const gap = Math.max(4, Math.min(8, Math.round(icon / 12)));
  return {
    icon,
    tileWidth: Math.max(140, Math.min(220, icon * 4 + 64)),
    rowHeight: Math.max(22, icon + Math.max(4, Math.round(icon * 0.22))),
    iconSlot: Math.max(18, icon + 4),
    gap,
  };
}
