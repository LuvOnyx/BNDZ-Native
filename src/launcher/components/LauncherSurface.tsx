import React from 'react';
import {
  DEFAULT_LAUNCHER_BACKGROUND_OPACITY_PERCENT,
  clampLauncherBackgroundPercent,
  launcherBackgroundBlurPercentToPx,
} from '../utils/launcher-background';

type Props = {
  className?: string;
  compact?: boolean;
  backgroundImageUrl?: string;
  showBackground?: boolean;
  backgroundBlurPercent?: number;
  backgroundOpacityPercent?: number;
  children: React.ReactNode;
};

/** Raycast-style glass shell wrapper with optional desktop wallpaper */
export default function LauncherSurface({
  className = '',
  compact = false,
  backgroundImageUrl = '',
  showBackground = false,
  backgroundBlurPercent = 35,
  backgroundOpacityPercent = DEFAULT_LAUNCHER_BACKGROUND_OPACITY_PERCENT,
  children,
}: Props) {
  const backgroundOpacity = clampLauncherBackgroundPercent(
    backgroundOpacityPercent,
    DEFAULT_LAUNCHER_BACKGROUND_OPACITY_PERCENT,
  ) / 100;
  const backgroundBlurPx = launcherBackgroundBlurPercentToPx(backgroundBlurPercent);

  return (
    <div className={`w-full h-full ${compact ? 'launcher-compact-shell' : ''}`}>
      <div className={`glass-effect overflow-hidden h-full flex flex-col relative ${className}`.trim()}>
        {showBackground && backgroundImageUrl ? (
          <div className="launcher-background-media" aria-hidden="true">
            <div
              className="launcher-background-image"
              style={
                {
                  backgroundImage: `url("${backgroundImageUrl}")`,
                  ['--launcher-background-opacity' as string]: String(backgroundOpacity),
                  ['--launcher-background-blur' as string]: `${backgroundBlurPx}px`,
                } as React.CSSProperties
              }
            />
            <div className="launcher-background-tint" />
          </div>
        ) : null}
        <div className="relative z-10 flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}
