import React from 'react';

export type SizeBarStyle = 'bar' | 'segment' | 'meter';

type Props = {
  percent: number;
  isDir?: boolean;
  style?: SizeBarStyle;
  className?: string;
  widthClass?: string;
};

/** macOS-style folder size indicators — slightly rounded, never pill-shaped. */
export function SizeBar({
  percent,
  isDir = true,
  style = 'bar',
  className = '',
  widthClass = 'w-12',
}: Props) {
  const pct = Math.max(0, Math.min(100, percent));
  if (pct <= 0) return null;

  const fillClass = isDir
    ? 'bg-sky-500/85'
    : 'bg-violet-500/75';

  if (style === 'segment') {
    const segments = 8;
    const filled = Math.max(1, Math.round((pct / 100) * segments));
    return (
      <span className={`inline-flex gap-px h-2 ${widthClass} shrink-0 ${className}`} aria-hidden>
        {Array.from({ length: segments }, (_, i) => (
          <span
            key={i}
            className={`flex-1 min-w-0 rounded-[2px] ${i < filled ? fillClass : 'bg-white/[0.06]'}`}
          />
        ))}
      </span>
    );
  }

  if (style === 'meter') {
    return (
      <span className={`relative inline-flex h-[3px] ${widthClass} shrink-0 rounded-[2px] bg-white/[0.08] overflow-hidden ${className}`} aria-hidden>
        <span className={`absolute inset-y-0 left-0 rounded-[2px] ${fillClass}`} style={{ width: `${pct}%` }} />
        <span
          className="absolute top-1/2 -translate-y-1/2 w-[3px] h-[7px] rounded-[1px] bg-white/90 shadow-sm"
          style={{ left: `calc(${pct}% - 1.5px)` }}
        />
      </span>
    );
  }

  return (
    <span className={`inline-flex h-[5px] ${widthClass} shrink-0 rounded-[3px] bg-black/35 overflow-hidden border border-white/[0.05] ${className}`} aria-hidden>
      <span className={`h-full rounded-[2px] ${fillClass}`} style={{ width: `${pct}%` }} />
    </span>
  );
}

export const SIZE_BAR_STYLE_OPTIONS: { id: SizeBarStyle; label: string; hint: string }[] = [
  { id: 'bar', label: 'Bar', hint: 'macOS-style rounded fill (default)' },
  { id: 'segment', label: 'Segments', hint: 'Discrete blocks — XYplorer-style at a glance' },
  { id: 'meter', label: 'Meter', hint: 'Thin line with position marker' },
];
