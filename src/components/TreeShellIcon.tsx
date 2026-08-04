import { ShellNativeIcon } from './ShellNativeIcon';
import { Icons8Icon } from './Icons8Icon';
import { shellIconIsDirectory } from '../lib/shellPaths';
import { useNativeIcon, useNativeIconFetch } from '../lib/useNativeIcon';

interface TreeShellIconProps {
  path?: string;
  iconPath?: string;
  size?: number;
  /** Icons8 id only while shell loads / if shell extract returns empty. */
  fallbackIcon?: string;
}

/** Navigation-tree icon — native shell first; Icons8 is loading/empty fallback only. */
export function TreeShellIcon({ path, iconPath, size = 15, fallbackIcon }: TreeShellIconProps) {
  const fetchPath = iconPath || path || '';
  const enabled = !!fetchPath;
  const isDir = shellIconIsDirectory(fetchPath || null);
  useNativeIconFetch(fetchPath || null, isDir, 'shell', enabled, enabled);
  const shellSrc = useNativeIcon(fetchPath || null, isDir, 'shell', enabled);

  if (!fetchPath) {
    return fallbackIcon ? <Icons8Icon id={fallbackIcon} size={size} /> : null;
  }

  if (!shellSrc && fallbackIcon) {
    return <Icons8Icon id={fallbackIcon} size={size} />;
  }

  return (
    <ShellNativeIcon
      path={fetchPath}
      isDir={isDir}
      size={size}
      eager
    />
  );
}
