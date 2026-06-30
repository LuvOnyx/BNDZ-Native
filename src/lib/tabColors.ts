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

export function tabAccentStyle(color?: string | null, isActive?: boolean): Record<string, string> | undefined {
  if (!color) return undefined;
  return {
    borderTopColor: color,
    borderLeftColor: `${color}88`,
    borderRightColor: `${color}88`,
    boxShadow: isActive ? `inset 0 -2px 0 ${color}, 0 0 12px ${color}22` : undefined,
    backgroundImage: isActive
      ? `linear-gradient(180deg, ${color}18 0%, transparent 70%)`
      : `linear-gradient(180deg, ${color}0a 0%, transparent 60%)`,
  };
}
