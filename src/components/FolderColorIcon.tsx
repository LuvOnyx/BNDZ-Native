import React from 'react';
import { folderColorWebUrl } from '../lib/folderColorIcons';

type Props = {
  folderIconId?: string | null;
  size: number;
  className?: string;
  title?: string;
};

/** Renders a colored folder .ico from folcolor_icons when a color-filter rule assigns one. */
export function FolderColorIcon({ folderIconId, size, className = '', title }: Props) {
  const src = folderColorWebUrl(folderIconId);
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      title={title}
      draggable={false}
      className={`inline-block shrink-0 object-contain select-none ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export default FolderColorIcon;
