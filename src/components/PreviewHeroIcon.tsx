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
        className="rounded-2xl bg-gradient-to-br from-white/[0.04] to-transparent border border-white/[0.06] flex items-center justify-center shadow-2xl"
        style={{ width: size + 24, height: size + 24 }}
      >
        {path ? (
          <ShellNativeIcon
            path={path}
            isDir={isDir && !isDrive}
            size={size}
            preferThumbnail={preferThumbnail ?? isImage}
            eager
          />
        ) : (
          <IconPlaceholder size={size * 0.7} />
        )}
      </div>
    </div>
  );
}
