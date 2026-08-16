import React from 'react';
import { ShellNativeIcon } from './ShellNativeIcon';
import { IconPlaceholder } from './IconPlaceholder';

interface PreviewHeroIconProps {
  path?: string | null;
  isDir?: boolean;
  isDrive?: boolean;
  size?: number;
  extension?: string;
  preferThumbnail?: boolean;
  className?: string;
}

/** Large native shell icon for preview panel and properties panel hero sections */
export function PreviewHeroIcon({
  path,
  isDir = false,
  isDrive = false,
  size = 128,
  extension = '',
  preferThumbnail,
  className = '',
}: PreviewHeroIconProps) {
  const isImage = !isDir && ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico'].includes(extension.toLowerCase());

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div
        className="bndz-preview-hero-frame flex items-center justify-center overflow-hidden"
        style={{ width: size, height: size, background: 'transparent', border: 'none', borderRadius: 0, boxShadow: 'none' }}
      >
        {path ? (
          <ShellNativeIcon
            path={path}
            isDir={isDir && !isDrive}
            size={size}
            preferThumbnail={preferThumbnail ?? isImage}
            eager
            hero
          />
        ) : (
          <IconPlaceholder size={Math.round(size * 0.85)} />
        )}
      </div>
    </div>
  );
}
