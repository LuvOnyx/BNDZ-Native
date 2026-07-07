import React from 'react';

type GlyphProps = {
  size?: number;
  className?: string;
};

/** Flat stroke SVGs for window chrome and small inline UI — never Icons8 3D PNGs. */
export function MinimizeGlyph({ size = 14, className = '' }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden>
      <line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

export function CloseGlyph({ size = 14, className = '' }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden>
      <line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" strokeWidth="1.25" />
      <line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

export function ChevronRightGlyph({ size = 12, className = '' }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden>
      <path d="M6 3 L11 8 L6 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronDownGlyph({ size = 12, className = '' }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden>
      <path d="M3 6 L8 11 L13 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** CSS-box maximize/restore icons (Explorer-style). */
export function MaximizeGlyph({ restored = false, bg = '#252526' }: { restored?: boolean; bg?: string }) {
  if (restored) {
    return (
      <span className="relative inline-block w-[11px] h-[11px]">
        <span className="absolute right-0 top-0 w-[8px] h-[8px] border border-current" />
        <span className="absolute left-0 bottom-0 w-[8px] h-[8px] border border-current" style={{ background: bg }} />
      </span>
    );
  }
  return <span className="inline-block w-[11px] h-[11px] border border-current" />;
}
