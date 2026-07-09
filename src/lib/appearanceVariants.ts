import type { AppConfig } from '../data/configContext';

export type SelectionStyle = 'classic' | 'inset' | 'xyplorer' | 'filepilot' | 'minimal' | 'glow';
export type SurfaceStyle = 'flat' | 'subtle' | 'glass';
export type CornerRadius = 'sharp' | 'rounded' | 'soft';
export type DensityStyle = 'compact' | 'comfortable' | 'spacious';
export type TabStyle = 'underline' | 'segment' | 'flat';
export type ChromePalette = 'neutral' | 'cool' | 'warm';
export type GridSelectionStyle = 'subtle' | 'filled' | 'border';
export type NavTreeColorMode = 'off' | 'subtle' | 'vivid';
export type SizeBarStyle = 'bar' | 'segment' | 'meter';

export const SELECTION_STYLE_OPTIONS: { id: SelectionStyle; label: string; hint: string }[] = [
  { id: 'classic', label: 'Classic', hint: 'Solid row fill (Windows Explorer–like)' },
  { id: 'inset', label: 'Inset border', hint: 'Thin inset ring, no glow (default)' },
  { id: 'xyplorer', label: 'XYplorer', hint: 'Flat blue row, high contrast, no shadow' },
  { id: 'filepilot', label: 'FilePilot', hint: 'Accent left bar + soft fill' },
  { id: 'minimal', label: 'Minimal', hint: 'Outline only — best for dense grids' },
  { id: 'glow', label: 'Glow', hint: 'Accent halo (previous neon style)' },
];

export const SURFACE_STYLE_OPTIONS: { id: SurfaceStyle; label: string; hint: string }[] = [
  { id: 'flat', label: 'Flat', hint: 'Clean panels, no blur' },
  { id: 'subtle', label: 'Subtle depth', hint: 'Light elevation, minimal blur' },
  { id: 'glass', label: 'Glass', hint: 'Translucent blur (Raycast-inspired)' },
];

export const CORNER_RADIUS_OPTIONS: { id: CornerRadius; label: string; hint: string }[] = [
  { id: 'sharp', label: 'Sharp', hint: '2–4px corners' },
  { id: 'rounded', label: 'Rounded', hint: '6px corners (recommended)' },
  { id: 'soft', label: 'Soft', hint: '8px corners' },
];

export const DENSITY_OPTIONS: { id: DensityStyle; label: string; hint: string }[] = [
  { id: 'compact', label: 'Compact', hint: 'XYplorer density — tighter rows' },
  { id: 'comfortable', label: 'Comfortable', hint: 'Balanced default' },
  { id: 'spacious', label: 'Spacious', hint: 'More padding in lists & tree' },
];

export const TAB_STYLE_OPTIONS: { id: TabStyle; label: string; hint: string }[] = [
  { id: 'underline', label: 'Underline', hint: 'Active tab accent line' },
  { id: 'segment', label: 'Segment', hint: 'Raised segment (macOS-like)' },
  { id: 'flat', label: 'Flat', hint: 'Minimal tab chrome' },
];

export const CHROME_PALETTE_OPTIONS: { id: ChromePalette; label: string; hint: string }[] = [
  { id: 'cool', label: 'Cool slate', hint: '#16181f family — no brown tint' },
  { id: 'neutral', label: 'Neutral gray', hint: 'Balanced gray workspace' },
  { id: 'warm', label: 'Warm dark', hint: 'Slightly warm panels' },
];

export const GRID_SELECTION_OPTIONS: { id: GridSelectionStyle; label: string; hint: string }[] = [
  { id: 'subtle', label: 'Subtle', hint: 'Light border — no full tile fill' },
  { id: 'filled', label: 'Filled', hint: 'Tinted tile background' },
  { id: 'border', label: 'Border only', hint: 'Accent outline on grid items' },
];

export const NAV_TREE_COLOR_OPTIONS: { id: NavTreeColorMode; label: string; hint: string }[] = [
  { id: 'subtle', label: 'Subtle', hint: 'Soft gradient accents on sidebar sections (default)' },
  { id: 'vivid', label: 'Vivid', hint: 'Stronger category colors for faster scanning' },
  { id: 'off', label: 'Off', hint: 'Flat monochrome sidebar headers' },
];

const RADIUS_MAP: Record<CornerRadius, { sm: string; md: string; lg: string }> = {
  sharp: { sm: '3px', md: '4px', lg: '5px' },
  rounded: { sm: '5px', md: '6px', lg: '8px' },
  soft: { sm: '6px', md: '8px', lg: '10px' },
};

const PALETTE_MAP: Record<ChromePalette, { chrome: string; raised: string; base: string }> = {
  cool: { chrome: '#12141a', raised: '#1c1f28', base: '#16181f' },
  neutral: { chrome: '#141414', raised: '#1e1e1e', base: '#181818' },
  warm: { chrome: '#161412', raised: '#211e1a', base: '#1a1816' },
};

const DENSITY_ROW: Record<DensityStyle, number> = {
  compact: 20,
  comfortable: 24,
  spacious: 28,
};

export function resolveAppearance(config: AppConfig) {
  return {
    selection: (config.appearanceSelectionStyle as SelectionStyle) || 'inset',
    surface: (config.appearanceSurfaceStyle as SurfaceStyle) || 'flat',
    corners: (config.appearanceCornerRadius as CornerRadius) || 'rounded',
    density: (config.appearanceDensity as DensityStyle) || 'comfortable',
    tabs: (config.appearanceTabStyle as TabStyle) || 'underline',
    chrome: (config.appearanceChromePalette as ChromePalette) || 'cool',
    gridSelection: (config.appearanceGridSelection as GridSelectionStyle) || 'subtle',
    navTreeColors: (config.appearanceNavTreeColors as NavTreeColorMode) || 'subtle',
    sizeBar: (config.folderSizeBarStyle as SizeBarStyle) || 'bar',
  };
}

/** Apply appearance variant data attributes + CSS variables to document */
export function applyAppearanceVariants(config: AppConfig, root: HTMLElement = document.documentElement): void {
  const a = resolveAppearance(config);
  root.dataset.selectionStyle = a.selection;
  root.dataset.surfaceStyle = a.surface;
  root.dataset.cornerRadius = a.corners;
  root.dataset.density = a.density;
  root.dataset.tabStyle = a.tabs;
  root.dataset.chromePalette = a.chrome;
  root.dataset.gridSelection = a.gridSelection;
  root.dataset.navTreeColors = a.navTreeColors;
  root.dataset.sizeBarStyle = a.sizeBar;

  const r = RADIUS_MAP[a.corners];
  root.style.setProperty('--bndz-radius-sm', r.sm);
  root.style.setProperty('--bndz-radius-md', r.md);
  root.style.setProperty('--bndz-radius-lg', r.lg);

  const p = PALETTE_MAP[a.chrome];
  root.style.setProperty('--bndz-surface-chrome', p.chrome);
  root.style.setProperty('--bndz-surface-raised', p.raised);
  root.style.setProperty('--bndz-surface-base', p.base);

  const rowH = config.rowHeight && Number(config.rowHeight) > 0
    ? Number(config.rowHeight)
    : DENSITY_ROW[a.density];
  root.style.setProperty('--bndz-density-row', `${rowH}px`);

  if (a.surface === 'flat') {
    root.style.setProperty('--bndz-glass-bg', p.raised);
    root.style.setProperty('--bndz-glass-blur', '0px');
  } else if (a.surface === 'subtle') {
    root.style.setProperty('--bndz-glass-bg', `color-mix(in srgb, ${p.raised} 92%, white 8%)`);
    root.style.setProperty('--bndz-glass-blur', '6px');
  } else {
    root.style.setProperty('--bndz-glass-bg', `color-mix(in srgb, ${p.raised} 78%, transparent)`);
    root.style.setProperty('--bndz-glass-blur', '12px');
  }
}
