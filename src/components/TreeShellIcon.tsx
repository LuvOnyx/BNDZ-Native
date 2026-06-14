import { useEffect } from 'react';
import { ShellNativeIcon } from './ShellNativeIcon';
import { requestNativeIcon } from '../lib/nativeIconService';
import { shellIconIsDirectory } from '../lib/shellPaths';

interface TreeShellIconProps {
  path?: string;
  iconPath?: string;
  size?: number;
}

/** Navigation-tree icon — always uses iconPath for shell fetch and preloads eagerly. */
export function TreeShellIcon({ path, iconPath, size = 15 }: TreeShellIconProps) {
  const fetchPath = iconPath || path;

  useEffect(() => {
    if (!fetchPath) return;
    void requestNativeIcon(fetchPath, shellIconIsDirectory(fetchPath), 'shell');
  }, [fetchPath]);

  if (!fetchPath) return null;

  return (
    <ShellNativeIcon
      path={fetchPath}
      isDir={shellIconIsDirectory(fetchPath)}
      size={size}
      eager
    />
  );
}
