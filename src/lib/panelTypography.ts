import type { AppConfig } from '../data/configContext';
import { readSettingNumber, readSettingString } from './settingsWiring';

export type PanelFontZone = 'tree' | 'list' | 'tabs' | 'preview' | 'bottom' | 'status' | 'chrome';

export type PanelFontTokens = {
  family: string;
  size: number;
  weight: number;
  lineHeight: number;
  monoFamily: string;
};

/**
 * BNDZ font pack — expressive UI faces (bundled via @fontsource).
 * Avoids generic stacks (Inter / Roboto / Arial / system defaults as the product look).
 */
const FONT_PRESETS: Record<string, string> = {
  Outfit: 'Outfit, sans-serif',
  'Space Grotesk': '"Space Grotesk", sans-serif',
  Sora: 'Sora, sans-serif',
  Manrope: 'Manrope, sans-serif',
  'DM Sans': '"DM Sans", sans-serif',
  Syne: 'Syne, sans-serif',
  'Instrument Sans': '"Instrument Sans", sans-serif',
};

const MONO_PRESETS: Record<string, string> = {
  'JetBrains Mono': '"JetBrains Mono", monospace',
  'IBM Plex Mono': '"IBM Plex Mono", monospace',
  'Fira Code': '"Fira Code", monospace',
};

export const UI_FONT_PRESET_OPTIONS = Object.entries(FONT_PRESETS).map(([label, value]) => ({ label, value }));
export const MONO_FONT_PRESET_OPTIONS = Object.entries(MONO_PRESETS).map(([label, value]) => ({ label, value }));

export const PANEL_FONT_ZONE_META: { id: PanelFontZone; label: string; description: string }[] = [
  { id: 'tree', label: 'Navigation tree', description: 'Sidebar folders, drives, favorites' },
  { id: 'list', label: 'File list', description: 'Details, grid, and list views' },
  { id: 'tabs', label: 'List tabs', description: 'Folder tabs above the file list' },
  { id: 'chrome', label: 'Top menu bar', description: 'Menubar and toolbar labels' },
  { id: 'preview', label: 'Preview panel', description: 'Inspector tabs, metadata, media chrome' },
  { id: 'bottom', label: 'Bottom plugins', description: 'Plugin tabs and embedded tools' },
  { id: 'status', label: 'Status bar', description: 'Footer selection and progress text' },
];

function zoneFamilyKey(zone: PanelFontZone): keyof AppConfig {
  return `${zone}FontFamily` as keyof AppConfig;
}

function zoneSizeKey(zone: PanelFontZone): keyof AppConfig {
  return `${zone}FontSize` as keyof AppConfig;
}

export function resolvePanelFont(config: AppConfig, zone: PanelFontZone): PanelFontTokens {
  const baseFamily = readSettingString(config, 'uiFontFamily', FONT_PRESETS.Outfit);
  const baseSize = readSettingNumber(config, 'fontSize', 12);
  const baseWeight = readSettingNumber(config, 'uiFontWeight', 500);
  const monoFamily = readSettingString(config, 'uiFontFamilyMono', MONO_PRESETS['JetBrains Mono']);

  const familyOverride = readSettingString(config, String(zoneFamilyKey(zone)), '');
  const sizeOverride = readSettingNumber(config, String(zoneSizeKey(zone)), 0);

  const zoneDefaults: Record<PanelFontZone, { size: number; weight: number; lineHeight: number }> = {
    tree: { size: 12, weight: baseWeight, lineHeight: 1.35 },
    list: { size: 12, weight: baseWeight, lineHeight: 1.3 },
    tabs: { size: readSettingNumber(config, 'tabFontSize', 11) || 11, weight: baseWeight, lineHeight: 1.25 },
    preview: { size: 12, weight: baseWeight, lineHeight: 1.4 },
    bottom: { size: 12, weight: baseWeight, lineHeight: 1.35 },
    status: { size: 11, weight: baseWeight, lineHeight: 1.25 },
    chrome: { size: baseSize, weight: baseWeight, lineHeight: 1.3 },
  };

  const zoneDef = zoneDefaults[zone];
  return {
    family: familyOverride || baseFamily,
    size: sizeOverride > 0 ? sizeOverride : (zone === 'chrome' ? baseSize : zoneDef.size),
    weight: zoneDef.weight,
    lineHeight: zoneDef.lineHeight,
    monoFamily,
  };
}

export function buildPanelTypographyCssVars(config: AppConfig): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const zone of PANEL_FONT_ZONE_META) {
    const tokens = resolvePanelFont(config, zone.id);
    vars[`--bndz-font-${zone.id}-family`] = tokens.family;
    vars[`--bndz-font-${zone.id}-size`] = `${tokens.size}px`;
    vars[`--bndz-font-${zone.id}-weight`] = String(tokens.weight);
    vars[`--bndz-font-${zone.id}-line-height`] = String(tokens.lineHeight);
  }
  const base = resolvePanelFont(config, 'chrome');
  vars['--bndz-font-family'] = base.family;
  vars['--bndz-font-size'] = `${base.size}px`;
  vars['--bndz-font-weight-ui'] = String(base.weight);
  vars['--bndz-font-family-mono'] = base.monoFamily;
  return vars;
}
