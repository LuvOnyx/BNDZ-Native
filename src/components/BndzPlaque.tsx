import React from 'react';

/**
 * Native FM plaque art for static surfaces (empties, alert tones, panel idle).
 * Not for list rows, DnD ghosts, or live transfer chrome.
 */

export type BndzPlaqueTone =
  | 'idle'
  | 'warn'
  | 'error'
  | 'brand'
  | 'question'
  | 'panel'
  | 'folder';

export type BndzPlaqueSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** Context-menu bitmaps stay off until assets prove crisp at menu density. */
export const PLAQUE_CONTEXT_MENU_ENABLED = false;

const PLAQUE_SRC: Record<BndzPlaqueTone, string> = {
  idle: '/plaques/hexigon-idle.png',
  warn: '/plaques/hexigon-question.png',
  error: '/plaques/hexigon-error.png',
  brand: '/plaques/brand-mark.png',
  question: '/plaques/hexigon-question.png',
  panel: '/plaques/panel-idle.svg',
  folder: '/plaques/idle-folder.svg',
};

const SIZE_CLASS: Record<BndzPlaqueSize, string> = {
  xs: 'bndz-plaque--xs',
  sm: 'bndz-plaque--sm',
  md: 'bndz-plaque--md',
  lg: 'bndz-plaque--lg',
  xl: 'bndz-plaque--xl',
};

export function plaqueSrcForTone(tone: BndzPlaqueTone): string {
  return PLAQUE_SRC[tone];
}

export type BndzPlaqueProps = {
  tone?: BndzPlaqueTone;
  size?: BndzPlaqueSize;
  className?: string;
  alt?: string;
  /** Optional decorative float / entrance — keep subtle. */
  animate?: boolean;
};

export function BndzPlaque({
  tone = 'idle',
  size = 'md',
  className = '',
  alt = '',
  animate = true,
}: BndzPlaqueProps) {
  return (
    <span
      className={`bndz-plaque ${SIZE_CLASS[size]} bndz-plaque--${tone}${animate ? ' bndz-plaque--animate' : ''} ${className}`.trim()}
      aria-hidden={alt ? undefined : true}
    >
      <img
        src={PLAQUE_SRC[tone]}
        alt={alt}
        className="bndz-plaque-img"
        draggable={false}
        decoding="async"
      />
    </span>
  );
}

export default BndzPlaque;
