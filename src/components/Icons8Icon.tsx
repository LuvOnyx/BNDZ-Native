import React from 'react';
import { launcherIconUrl } from '../lib/toolbarLauncherIcons';
import { TagGlyph } from './TagGlyph';
import { FavoritesGlyph } from './FavoritesGlyph';

interface Icons8IconProps {
  /** Icon id from TOOLBAR_LAUNCHER_ICONS (e.g. 'copy', 'chevron_right', 'close'). */
  id: string;
  size?: number;
  className?: string;
  /** Dim the icon (e.g. disabled buttons) without needing a distinct asset. */
  disabled?: boolean;
  /** Spin animation — used for 'loading' in place of Lucide's Loader2. */
  spin?: boolean;
  title?: string;
  /** Stroke/tint color for tintable glyphs (tag_manager / tag__ / favorites). */
  color?: string;
}

/**
 * Renders a real Icons8 3D-Fluency PNG asset (public/launcher-icons/) in place of a
 * Lucide vector icon. These are raster 3D renders, not tintable strokes — size and
 * opacity are the only visual knobs, matching how the existing toolbar already
 * consumes launcherIconUrl(). Falls back to a small neutral dot if the id has no
 * mapped asset, so a missing icon never breaks layout.
 *
 * Exceptions: tag_manager / tag__ use a tintable tag mask; favorites uses the bookmark glyph.
 */
export function Icons8Icon({ id, size = 16, className = '', disabled, spin, title, color }: Icons8IconProps) {
  // Guard: plugins sometimes pass a ReactNode by mistake — never call string methods on it.
  if (typeof id !== 'string' || !id) {
    return (
      <span
        className={`inline-block rounded-full bg-white/20 ${className}`}
        style={{ width: Math.max(4, size * 0.3), height: Math.max(4, size * 0.3) }}
        title={title}
        aria-hidden
      />
    );
  }
  if (id === 'tag_manager' || id.startsWith('tag__')) {
    return (
      <TagGlyph
        color={color || '#FACC15'}
        size={size}
        className={`${disabled ? 'opacity-35' : ''} ${spin ? 'bndz-icon8-spin' : ''} ${className}`}
        title={title}
      />
    );
  }

  if (id === 'favorites') {
    return (
      <FavoritesGlyph
        color={color || '#FACC15'}
        size={size}
        className={`${disabled ? 'opacity-35' : ''} ${spin ? 'bndz-icon8-spin' : ''} ${className}`}
        title={title}
      />
    );
  }

  const src = launcherIconUrl(id);

  if (!src) {
    return (
      <span
        className={`inline-block rounded-full bg-white/20 ${className}`}
        style={{ width: Math.max(4, size * 0.3), height: Math.max(4, size * 0.3) }}
        title={title}
        aria-hidden
      />
    );
  }

  return (
    <img
      src={src}
      alt=""
      title={title}
      draggable={false}
      className={`inline-block shrink-0 object-contain select-none ${disabled ? 'opacity-35' : ''} ${spin ? 'bndz-icon8-spin' : ''} ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/** Small geometric six-dot drag handle — Icons8 has no matching 3D asset at UI-chrome scale. */
export function DragHandleGlyph({ size = 14, className = '' }: { size?: number; className?: string }) {
  const dot = Math.max(1.5, size / 8);
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden>
      {[4, 8, 12].map(y => (
        <React.Fragment key={y}>
          <circle cx={5} cy={y} r={dot} fill="currentColor" opacity={0.6} />
          <circle cx={11} cy={y} r={dot} fill="currentColor" opacity={0.6} />
        </React.Fragment>
      ))}
    </svg>
  );
}

/** Pop-out / open-in-new-window glyph — replaces the misleading chain-link external_link asset. */
export function PopOutGlyph({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2.5" y="4.5" width="9" height="9" rx="1.5" opacity={0.85} />
      <path d="M7 2.5h6.5V9" />
      <path d="M13.5 2.5 8 8" />
    </svg>
  );
}
