export interface ThemePreset {
  name: string;
  bg: string;
  surface: string;
  accent: string;
  text: string;
  category?: 'imported' | 'aesthetic';
}

/** Full workspace themes — applied via theme name + CSS variables */
export const IMPORTED_THEMES: ThemePreset[] = [
  { name: 'Dark', bg: '#0D0B0E', surface: '#2b292e', accent: '#007acc', text: '#ffffff', category: 'imported' },
  { name: 'DarkMica', bg: '#2D2B2E', surface: 'Transparent', accent: '#007acc', text: '#ffffff', category: 'imported' },
  { name: 'Light', bg: '#ffffff', surface: '#f0f0f0', accent: '#007acc', text: '#000000', category: 'imported' },
  { name: 'LightMica', bg: '#ffffff', surface: 'Transparent', accent: '#007acc', text: '#000000', category: 'imported' },
  { name: 'LightRoundedFlat', bg: '#ffffff', surface: '#e9ffffff', accent: '#007acc', text: '#000000', category: 'imported' },
  { name: 'MinimalWhite', bg: '#ffffff', surface: '#ffffff', accent: '#007acc', text: '#000000', category: 'imported' },
  { name: 'Neumorphic', bg: '#e3e3e3', surface: '#e3e3e3', accent: '#007acc', text: '#000000', category: 'imported' },
  { name: 'Nord', bg: '#30343F', surface: '#3B4252', accent: '#5E81AC', text: '#dadee8', category: 'imported' },
  { name: 'Nortorn', bg: '#000000', surface: '#0402ac', accent: '#008181', text: '#54fefc', category: 'imported' },
];

/** Aesthetic presets — also map to colorConfig slots */
export const AESTHETIC_THEMES: ThemePreset[] = [
  { name: 'Slate Workstation', bg: '#1e2124', surface: '#282b30', accent: '#7289da', text: '#e5e7eb', category: 'aesthetic' },
  { name: 'Studio Obsidian', bg: '#000000', surface: '#111111', accent: '#fbbf24', text: '#f3f4f6', category: 'aesthetic' },
  { name: 'Nordic Frost', bg: '#2e3440', surface: '#3b4252', accent: '#88c0d0', text: '#eceff4', category: 'aesthetic' },
  { name: 'Monokai Minimal', bg: '#2d2a2e', surface: '#403e41', accent: '#a9dc76', text: '#fcfcfa', category: 'aesthetic' },
  {
    name: 'macOS Sonoma',
    bg: '#1c1c1e',
    surface: '#2c2c2e',
    accent: '#0a84ff',
    text: '#f5f5f7',
    category: 'aesthetic',
  },
  {
    name: 'macOS Light',
    bg: '#f5f5f7',
    surface: '#ffffff',
    accent: '#007aff',
    text: '#1d1d1f',
    category: 'aesthetic',
  },
  { name: 'Aurora Violet', bg: '#13111a', surface: '#1e1a28', accent: '#a78bfa', text: '#ede9fe', category: 'aesthetic' },
  { name: 'Emerald Night', bg: '#0a1210', surface: '#12201c', accent: '#34d399', text: '#d1fae5', category: 'aesthetic' },
  { name: 'Sunset Ember', bg: '#140d0a', surface: '#241612', accent: '#fb923c', text: '#ffedd5', category: 'aesthetic' },
  { name: 'Graphite Pro', bg: '#161616', surface: '#222222', accent: '#60a5fa', text: '#f3f4f6', category: 'aesthetic' },
  { name: 'Ocean Deep', bg: '#071018', surface: '#0f1c28', accent: '#22d3ee', text: '#e0f2fe', category: 'aesthetic' },
  { name: 'Cyber Neon', bg: '#050508', surface: '#101018', accent: '#00f5d4', text: '#e8faff', category: 'aesthetic' },
  { name: 'Rose Quartz', bg: '#1a1218', surface: '#261a24', accent: '#fb7185', text: '#ffe4e8', category: 'aesthetic' },
  { name: 'Midnight Cobalt', bg: '#0b1020', surface: '#141c32', accent: '#6366f1', text: '#e8eaf6', category: 'aesthetic' },
  { name: 'Forest Canopy', bg: '#0c1410', surface: '#152820', accent: '#4ade80', text: '#ecfdf5', category: 'aesthetic' },
];

export const ALL_THEME_PRESETS = [...IMPORTED_THEMES, ...AESTHETIC_THEMES];

export function themeSurfaceColor(surface: string): string {
  return surface === 'Transparent' ? 'rgba(0,0,0,0)' : surface;
}

/** Map a theme preset onto colorConfig keys used by the runtime */
export function themeToColorConfig(preset: ThemePreset): Record<string, string | boolean> {
  const surface = themeSurfaceColor(preset.surface);
  const isLight = hexLuminance(preset.bg) > 0.55;
  return {
    theme: preset.name,
    bgMain: preset.bg,
    bgSurface: surface,
    accent: preset.accent,
    textMain: preset.text,
    colorConfig1: preset.text,
    colorConfig2: preset.bg,
    colorConfig3: preset.text,
    colorConfig4: preset.bg,
    colorConfig5: preset.text,
    colorConfig6: preset.text,
    colorConfig7: surface,
    colorConfig8: preset.text,
    colorConfig9: preset.bg,
    colorConfig10: preset.text,
    colorConfig11: preset.bg,
    colorConfig12: surface,
    colorConfig13: surface,
    colorConfig14: preset.accent,
    colorConfig15: preset.accent,
    colorConfig16: preset.text,
    colorConfig17: surface,
    colorConfig18: preset.bg,
    colorConfig19: preset.text,
    colorConfig20: preset.accent,
    colorConfig21: surface,
    colorConfig22: preset.text,
    colorConfig23: surface,
    colorConfig24: preset.accent,
    colorConfig25: preset.accent,
    colorConfig26: preset.text,
    colorConfig27: preset.bg,
    colorConfig28: preset.text,
    colorConfig29: surface,
    colorConfig34: preset.accent,
    colorConfig35: preset.accent,
    colorConfig46: mixHex(surface === 'rgba(0,0,0,0)' ? preset.bg : surface, isLight ? '#ffffff' : '#000000', isLight ? 0.04 : 0.12),
    applyColors: true,
  };
}

function hexLuminance(hex: string): number {
  const h = hex.replace('#', '');
  if (h.length < 6) return 0;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function mixHex(a: string, b: string, t: number): string {
  const pa = a.replace('#', '');
  const pb = b.replace('#', '');
  if (pa.length < 6 || pb.length < 6) return a;
  const mix = (i: number) => Math.round(parseInt(pa.slice(i, i + 2), 16) * (1 - t) + parseInt(pb.slice(i, i + 2), 16) * t);
  const r = mix(0).toString(16).padStart(2, '0');
  const g = mix(2).toString(16).padStart(2, '0');
  const bl = mix(4).toString(16).padStart(2, '0');
  return `#${r}${g}${bl}`;
}

export function applyThemeCssVars(preset: ThemePreset): void {
  const root = document.documentElement;
  const surface = themeSurfaceColor(preset.surface);
  const isLight = hexLuminance(preset.bg) > 0.55;
  const elevated = mixHex(surface === 'rgba(0,0,0,0)' ? preset.bg : surface, isLight ? '#ffffff' : '#000000', isLight ? 0.06 : 0.12);
  const menubar = mixHex(surface === 'rgba(0,0,0,0)' ? preset.bg : surface, isLight ? '#000000' : '#000000', isLight ? 0.04 : 0.18);
  const toolbar = mixHex(surface === 'rgba(0,0,0,0)' ? preset.bg : surface, isLight ? '#000000' : '#ffffff', isLight ? 0.03 : 0.08);
  const sidebar = mixHex(preset.bg, isLight ? '#ffffff' : '#000000', isLight ? 0.02 : 0.06);

  root.style.setProperty('--bg-main', preset.bg);
  root.style.setProperty('--bg-surface', surface);
  root.style.setProperty('--surface-elevated', elevated);
  root.style.setProperty('--menubar-bg', menubar);
  root.style.setProperty('--toolbar-bg', toolbar);
  root.style.setProperty('--sidebar-bg', sidebar);
  root.style.setProperty('--statusbar-bg', mixHex(preset.bg, '#000000', isLight ? 0.05 : 0.2));
  root.style.setProperty('--status-text', isLight ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.55)');
  root.style.setProperty('--sidebar-accent', preset.accent);
  root.style.setProperty('--border-subtle', isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)');
  root.style.setProperty('--border-strong', isLight ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.16)');
  root.style.setProperty('--accent', preset.accent);
  root.style.setProperty('--accent-muted', `${preset.accent}33`);
  root.style.setProperty('--text-main', preset.text);
  root.style.setProperty('--text-muted', isLight ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.55)');
  root.style.setProperty('--list-hover', isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)');
  root.style.setProperty('--list-selected', `${preset.accent}40`);
  root.style.setProperty('--list-selected-border', preset.accent);
  root.style.setProperty('--scrollbar-thumb', isLight ? '#b0b0b0' : '#3a3a3a');
  root.style.setProperty('--scrollbar-thumb-hover', isLight ? '#888' : '#555');
  root.style.setProperty('--panel-preview-bg', mixHex(preset.bg, isLight ? '#000000' : '#000000', isLight ? 0.06 : 0.14));
  root.style.setProperty('--panel-bottom-bg', mixHex(preset.bg, isLight ? '#000000' : '#000000', isLight ? 0.08 : 0.18));
  root.style.setProperty('--panel-preview-text', preset.text);
  root.style.setProperty('--panel-preview-muted', isLight ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.55)');
  root.style.setProperty('--panel-bottom-text', preset.text);
  root.style.setProperty('--panel-bottom-muted', isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)');
  root.style.setProperty('--tooltip-bg', mixHex(elevated, isLight ? '#ffffff' : '#000000', isLight ? 0.1 : 0.22));
  root.style.setProperty('--tooltip-text', preset.text);
  root.style.setProperty('--tooltip-muted', isLight ? 'rgba(0,0,0,0.52)' : 'rgba(255,255,255,0.52)');
  root.style.setProperty('--tooltip-border', isLight ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.14)');
  root.style.setProperty('--tooltip-accent', preset.accent);
  root.style.setProperty('--menu-bg', mixHex(menubar, isLight ? '#ffffff' : '#000000', isLight ? 0.04 : 0.12));
  root.style.setProperty('--menu-text', preset.text);
  root.style.setProperty('--menu-muted', isLight ? 'rgba(0,0,0,0.52)' : 'rgba(255,255,255,0.52)');
  root.style.setProperty('--menu-hover', `${preset.accent}33`);
  root.style.setProperty('--menu-border', isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)');
  root.style.setProperty('--menu-accent', preset.accent);
  root.style.setProperty('--list-text-secondary', isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.45)');
  root.style.setProperty('--list-bg', preset.bg);
  root.style.setProperty('--list-text', preset.text);
  root.style.setProperty('--tab-active-bg', elevated);
  root.style.setProperty('--tab-active-text', preset.accent);
  root.style.setProperty('--tab-inactive-bg', menubar);
  root.style.setProperty('--tab-inactive-text', isLight ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.45)');

  const slug = preset.name.toLowerCase().replace(/\s+/g, '-');
  root.dataset.theme = slug;
  root.classList.remove('theme-macos-sonoma', 'theme-macos-light', 'theme-light');
  if (preset.name === 'macOS Sonoma') root.classList.add('theme-macos-sonoma');
  if (preset.name === 'macOS Light') root.classList.add('theme-macos-light');
  if (isLight) root.classList.add('theme-light');
}

export function applyThemeByName(themeName: string | undefined): void {
  if (!themeName) return;
  const preset = ALL_THEME_PRESETS.find(t => t.name === themeName);
  if (preset) applyThemeCssVars(preset);
}
