import React from 'react';
import { launcherIconUrl } from '../lib/toolbarLauncherIcons';

type Props = {
  id: string;
  size?: number;
  className?: string;
};

/** Renders a toolbar Icons8 3D Fluency PNG by launcher id. */
export function LauncherIcon({ id, size = 16, className = '' }: Props) {
  const src = launcherIconUrl(id);
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className={`object-contain pointer-events-none ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export default LauncherIcon;
