import React, { useEffect, useState } from 'react';

/**
 * Native FM plaque art for static surfaces (empties, alert tones, panel idle, tabs).
 * Not for list rows, DnD ghosts, or live transfer chrome.
 *
 * Assets are keepers promoted from public/plaques/ after QUALITY pass —
 * object/chrome art only (no people illustrations).
 */

export type BndzPlaqueTone =
  | 'idle'
  | 'warn'
  | 'error'
  | 'brand'
  | 'question'
  | 'panel'
  | 'folder'
  | 'search'
  | 'tabs'
  | 'transfer'
  | 'history';

export type BndzPlaqueSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** Context-menu bitmaps stay off until assets prove crisp at menu density. */
export const PLAQUE_CONTEXT_MENU_ENABLED = false;

type ThemePair = { dark: string; light?: string };

const PLAQUE_SRC: Record<BndzPlaqueTone, ThemePair> = {
  // System Properties / generic empty tray — original glass folder + platter (dope-FM ref craft)
  idle: { dark: '/plaques/fm-glass-idle-dark.svg', light: '/plaques/fm-glass-idle-light.svg' },
  warn: { dark: '/plaques/warning.svg', light: '/plaques/warning.svg' },
  error: { dark: '/plaques/error-dark.svg', light: '/plaques/error-light.svg' },
  brand: { dark: '/plaques/brand-mark.png', light: '/plaques/brand-mark.png' },
  question: { dark: '/plaques/access-denied-dark.svg', light: '/plaques/access-denied-light.svg' },
  // Preview Inspector idle — original glass loupe well (dope-FM ref craft)
  panel: { dark: '/plaques/fm-glass-panel-dark.svg', light: '/plaques/fm-glass-panel-light.svg' },
  folder: { dark: '/plaques/folder-empty-dark.svg', light: '/plaques/folder-empty-light.svg' },
  search: { dark: '/plaques/search-empty-dark.svg', light: '/plaques/search-empty-light.svg' },
  tabs: { dark: '/plaques/tab-empty.svg', light: '/plaques/tab-empty.svg' },
  transfer: { dark: '/plaques/fm-transfer-dark.svg', light: '/plaques/fm-transfer-light.svg' },
  history: { dark: '/plaques/history-dark.svg', light: '/plaques/history-dark.svg' },
};

const SIZE_CLASS: Record<BndzPlaqueSize, string> = {
  xs: 'bndz-plaque--xs',
  sm: 'bndz-plaque--sm',
  md: 'bndz-plaque--md',
  lg: 'bndz-plaque--lg',
  xl: 'bndz-plaque--xl',
};

function readLightTheme(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains('theme-light');
}

export function plaqueSrcForTone(tone: BndzPlaqueTone, light = readLightTheme()): string {
  const pair = PLAQUE_SRC[tone];
  return light && pair.light ? pair.light : pair.dark;
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
  const [light, setLight] = useState(readLightTheme);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setLight(root.classList.contains('theme-light'));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  const src = plaqueSrcForTone(tone, light);

  return (
    <span
      className={`bndz-plaque ${SIZE_CLASS[size]} bndz-plaque--${tone}${animate ? ' bndz-plaque--animate' : ''} ${className}`.trim()}
      aria-hidden={alt ? undefined : true}
    >
      <img
        src={src}
        alt={alt}
        className="bndz-plaque-img"
        draggable={false}
        decoding="async"
      />
    </span>
  );
}

export default BndzPlaque;
