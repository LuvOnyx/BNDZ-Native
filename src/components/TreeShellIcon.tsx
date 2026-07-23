import { ShellNativeIcon } from './ShellNativeIcon';
import { shellIconIsDirectory } from '../lib/shellPaths';

interface TreeShellIconProps {
  path?: string;
  iconPath?: string;
  size?: number;
}

/** Navigation-tree icon — lazy via IntersectionObserver (no eager IPC storm while scrolling). */
export function TreeShellIcon({ path, iconPath, size = 15 }: TreeShellIconProps) {
  const fetchPath = iconPath || path;
  if (!fetchPath) return null;

  return (
    <ShellNativeIcon
      path={fetchPath}
      isDir={shellIconIsDirectory(fetchPath)}
      size={size}
    />
  );
}
