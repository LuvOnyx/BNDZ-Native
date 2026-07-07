/** Derive grid/list tile geometry from icon size slider values. */
export function gridTileMetrics(gridIconSize: number) {
  const icon = Math.max(12, Math.min(72, gridIconSize));
  return {
    icon,
    minWidth: Math.max(72, icon + 28),
    rowHeight: Math.max(88, icon + 44),
    gap: Math.max(4, Math.round(icon / 12)),
    padding: Math.max(4, Math.round(icon / 8)),
  };
}

export function listTileMetrics(listIconSize: number) {
  const icon = Math.max(12, Math.min(72, listIconSize));
  return {
    icon,
    tileWidth: Math.max(140, icon * 7 + 72),
    rowHeight: Math.max(24, icon + 10),
    iconSlot: Math.max(20, icon + 6),
    gap: Math.max(4, Math.round(icon / 10)),
  };
}
