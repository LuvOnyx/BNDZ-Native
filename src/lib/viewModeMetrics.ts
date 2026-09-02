/** Derive grid/list/details geometry from icon size sliders.
 *  Tuned to match Files WinUI GridLayoutPage / LayoutSizeKindHelper ladders.
 *  `minWidth` is the floor; VirtualizedFileList stretches tracks equally to fill the row.
 */

/** Files `GetGridViewItemWidth` ladder (Small → ExtraLarge). */
export const FILES_GRID_ITEM_WIDTHS = [
  80, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300,
] as const;

/** Max equal-width columns that fit, then stretch tracks to consume leftover width. */
export function packGridTracks(
  availableWidth: number,
  minTileWidth: number,
  gap: number,
): { cols: number; tileWidth: number } {
  const minW = Math.max(72, Math.floor(minTileWidth));
  const g = Math.max(0, gap);
  const w = Math.max(0, Math.floor(availableWidth));
  if (w <= 0) return { cols: 1, tileWidth: minW };
  // CSS auto-fill equivalent: floor((W + G) / (min + G))
  const cols = Math.max(1, Math.floor((w + g) / (minW + g)));
  const tileWidth = Math.max(minW, Math.floor((w - (cols - 1) * g) / cols));
  return { cols, tileWidth };
}

/** Map grid icon slider (16–256) onto the nearest Files grid item width. */
export function filesGridItemWidthFromIcon(gridIconSize: number): number {
  const icon = Math.max(16, Math.min(256, gridIconSize));
  const t = (icon - 16) / (256 - 16);
  const idx = Math.round(t * (FILES_GRID_ITEM_WIDTHS.length - 1));
  return FILES_GRID_ITEM_WIDTHS[Math.max(0, Math.min(FILES_GRID_ITEM_WIDTHS.length - 1, idx))];
}

export type GridTileMetricsOpts = {
  /** Appearance → Show cards — reserved for optional card frame; Files Grid is frame-less. */
  cardChrome?: boolean;
};

/**
 * Files Grid: square thumbnail cell (`ItemWidth × ItemWidth`) + caption band under it.
 * Shell icon fetch size follows Files GetIconSize bands; display fits inside the square with ~12px margin.
 */
export function gridTileMetrics(gridIconSize: number, opts?: GridTileMetricsOpts) {
  const iconHint = Math.max(16, Math.min(256, gridIconSize));
  const itemWidth = filesGridItemWidthFromIcon(iconHint);
  const dense = itemWidth <= 80 && iconHint < 36;
  const cardChrome = !!opts?.cardChrome && !dense;

  // Files GridViewBrowserTemplate: Margin="12" on thumbnail presenter.
  const thumbMargin = itemWidth <= 100 ? 10 : 12;
  const displayIcon = Math.max(16, itemWidth - thumbMargin * 2);
  // Fetch size near Files bands (96 / 128 / 256 / 384) — never below display needs.
  const icon =
    itemWidth <= 120 ? Math.max(displayIcon, 96)
    : itemWidth <= 180 ? Math.max(displayIcon, 128)
    : itemWidth <= 240 ? Math.max(displayIcon, 192)
    : Math.max(displayIcon, 256);

  const cardPadX = cardChrome ? 8 : 0;
  const cardPadTop = cardChrome ? 8 : 0;
  const cardPadBottom = cardChrome ? 6 : 0;

  // Caption: Files uses ~2 lines under the square (margin 4,0,4,8).
  const labelBlock = dense ? 0 : Math.max(36, Math.min(48, Math.round(34 + itemWidth * 0.04)));
  const captionMarginBottom = dense ? 0 : 8;
  const gap = 4;
  const iconSlot = itemWidth; // square, Files-identical
  const padding = 0;
  const marqueePad = 2;
  const tileInnerGap = 0;

  const rowHeight =
    padding * 2
    + cardPadTop
    + iconSlot
    + tileInnerGap
    + labelBlock
    + captionMarginBottom
    + cardPadBottom
    + marqueePad
    + (dense ? 0 : 4);

  return {
    icon: Math.min(icon, 384),
    minWidth: itemWidth + cardPadX * 2,
    tileWidth: itemWidth + cardPadX * 2,
    rowHeight,
    stride: rowHeight + gap,
    gap,
    padding,
    labelBlock,
    marqueePad,
    iconSlot,
    thumbMargin,
    dense,
    cardChrome,
    cardPadX,
    cardPadTop,
    cardPadBottom,
  };
}

/** This PC drive cards — scale with the same icon size slider as folders. */
export function driveGridMetrics(gridIconSize: number) {
  const itemWidth = Math.max(140, filesGridItemWidthFromIcon(gridIconSize) + 40);
  const icon = Math.max(28, Math.min(120, gridIconSize));
  const gap = 8;
  const rowHeight = Math.max(icon + 56, 100);
  return {
    icon,
    minWidth: itemWidth,
    tileWidth: itemWidth,
    rowHeight,
    stride: rowHeight + gap,
    gap,
  };
}

export function driveListMetrics(listIconSize: number) {
  const icon = Math.max(16, Math.min(64, listIconSize));
  const t = (icon - 16) / (64 - 16);
  const tileWidth = Math.round(220 + t * 160);
  const gap = 4;
  const padX = Math.max(6, Math.round(6 + t * 6));
  const padY = Math.max(4, Math.round(4 + t * 4));
  // Files list row heights: 24 / 32 / 36 / 40 / 44
  const rowHeight =
    icon <= 14 ? 24
    : icon <= 18 ? 32
    : icon <= 22 ? 36
    : icon <= 28 ? 40
    : 44;
  return {
    icon,
    tileWidth,
    rowHeight: Math.max(rowHeight, icon + padY * 2),
    stride: Math.max(rowHeight, icon + padY * 2) + gap,
    gap,
    padX,
    padY,
  };
}

/** Details — Files GetDetailsViewRowHeight ladder (Compact→XL: 24–44), snug default. */
export function detailsTileMetrics(detailsIconSize: number) {
  const icon = Math.max(12, Math.min(48, detailsIconSize));
  const rowHeight =
    icon <= 14 ? 24
    : icon <= 18 ? 28
    : icon <= 22 ? 32
    : icon <= 28 ? 36
    : 44;
  const padY = Math.max(2, Math.round((rowHeight - icon) / 2));
  const iconColClass = icon <= 16 ? 'w-5' : icon <= 24 ? 'w-7' : icon <= 32 ? 'w-9' : 'w-11';
  return { icon, rowHeight, padY, iconColClass };
}

/**
 * Files List view: compact multi-column name rows.
 * Heights from GetListViewRowHeight (24–44); tile width expands with icon for fewer columns at large sizes.
 */
export function listTileMetrics(listIconSize: number) {
  const icon = Math.max(12, Math.min(96, listIconSize));
  const t = (icon - 12) / (96 - 12);
  const dense = icon < 18;
  const large = icon >= 48;
  const hero = icon >= 72;
  const rowHeight =
    icon <= 14 ? 24
    : icon <= 18 ? 32
    : icon <= 22 ? 36
    : icon <= 28 ? 40
    : icon <= 40 ? 44
    : Math.max(hero ? icon + 16 : 48, icon + 10);
  const tileWidth = dense
    ? Math.round(120 + t * 40)
    : hero
      ? Math.round(200 + t * 180)
      : large
        ? Math.round(170 + t * 160)
        : Math.round(140 + t * 200);
  const gap = dense ? 2 : large ? 6 : 4;
  const padY = Math.max(2, Math.round((rowHeight - Math.min(icon, rowHeight - 4)) / 2));
  const padX = dense ? 6 : large ? 10 : 8;
  const iconSlot = Math.max(16, Math.min(icon + (hero ? 8 : 4), rowHeight - 2));
  return {
    icon,
    tileWidth,
    rowHeight,
    stride: rowHeight + gap,
    iconSlot,
    gap,
    padY,
    padX,
    dense,
    large,
    hero,
  };
}
