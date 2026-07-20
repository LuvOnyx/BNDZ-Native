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

/** Colored tab chrome — reads as a machined bar, not a flat web pill. */
export function tabAccentStyle(color?: string | null, isActive?: boolean): Record<string, string> | undefined {
  if (!color) return undefined;
  const edge = isActive ? color : `${color}cc`;
  return {
    borderTopWidth: '3px',
    borderTopStyle: 'solid',
    borderTopColor: edge,
    borderLeftColor: `${color}99`,
    borderRightColor: `${color}55`,
    borderBottomColor: 'transparent',
    boxShadow: isActive
      ? [
          `inset 0 1px 0 ${color}aa`,
          `inset 0 -2px 0 ${color}`,
          `inset 1px 0 0 ${color}33`,
          `0 1px 0 rgba(0,0,0,0.35)`,
          `0 0 14px ${color}28`,
        ].join(', ')
      : [
          `inset 0 1px 0 ${color}44`,
          `inset 0 -1px 0 ${color}22`,
          `0 1px 0 rgba(0,0,0,0.25)`,
        ].join(', '),
    backgroundImage: isActive
      ? `linear-gradient(180deg, ${color}28 0%, ${color}0c 42%, transparent 100%)`
      : `linear-gradient(180deg, ${color}14 0%, transparent 65%)`,
  };
}
