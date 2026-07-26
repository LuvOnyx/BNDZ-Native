import { useEffect, useState } from 'react';
import { ShellNativeIcon } from './ShellNativeIcon';
import { Icons8Icon } from './Icons8Icon';
import { shellIconIsDirectory } from '../lib/shellPaths';
import { getCachedIcon, subscribeIcon } from '../lib/nativeIconService';

interface CloudNavIconProps {
  path?: string;
  fallbackIcon: string;
  size?: number;
}

/** Cloud sidebar row icon — native shell glyph when available, branded fallback otherwise. */
export function CloudNavIcon({ path, fallbackIcon, size = 14 }: CloudNavIconProps) {
  const fetchPath = path || '';
  const isDir = shellIconIsDirectory(fetchPath);
  const [useFallback, setUseFallback] = useState(false);

  useEffect(() => {
    if (!fetchPath) {
      setUseFallback(true);
      return;
    }
    setUseFallback(false);
    if (getCachedIcon(fetchPath, isDir, 'shell')) return;
    const unsub = subscribeIcon(fetchPath, isDir, 'shell', () => {
      if (getCachedIcon(fetchPath, isDir, 'shell')) return;
    });
    const timer = window.setTimeout(() => {
      if (!getCachedIcon(fetchPath, isDir, 'shell')) setUseFallback(true);
    }, 4000);
    return () => {
      unsub();
      window.clearTimeout(timer);
    };
  }, [fetchPath, isDir]);

  if (!fetchPath || useFallback) {
    return <Icons8Icon id={fallbackIcon} size={size} />;
  }

  return (
    <ShellNativeIcon
      path={fetchPath}
      isDir={isDir}
      size={size}
      eager
      preferThumbnail={false}
    />
  );
}
