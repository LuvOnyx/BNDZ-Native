/** Per-tab accent colors — right-click tab → pick color */
export const TAB_ACCENT_PRESETS = [
  { id: 'default', label: 'Default', color: '' },
  { id: 'sky', label: 'Sky', color: '#38bdf8' },
  { id: 'violet', label: 'Violet', color: '#a78bfa' },
  { id: 'emerald', label: 'Emerald', color: '#34d399' },
  { id: 'amber', label: 'Amber', color: '#fbbf24' },
  { id: 'rose', label: 'Rose', color: '#fb7185' },
  { id: 'orange', label: 'Orange', color: '#fb923c' },
  { id: 'cyan', label: 'Cyan', color: '#22d3ee' },
  { id: 'lime', label: 'Lime', color: '#a3e635' },
] as const;

/**
 * Colored tab chrome — instrument chip with a bottom color slit.
 * Plaque silhouette stays in CSS; only --bndz-tab-slit changes with the pick.
 */
export function tabAccentStyle(color?: string | null, _isActive?: boolean): Record<string, string> | undefined {
  if (!color) return undefined;
  return {
    ['--bndz-tab-slit' as string]: color,
    ['--bndz-tab-slit-glow' as string]: `${color}66`,
  } as Record<string, string>;
}
