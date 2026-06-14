import { useEffect, useState } from 'react';
import {
  getCachedIcon,
  requestNativeIcon,
  subscribeIcon,
  type IconRequestKind,
} from './nativeIconService';

/** Subscribe to the global native icon cache without useSyncExternalStore (avoids React #185 loops). */
export function useNativeIcon(
  path: string | null | undefined,
  isDirectory: boolean,
  kind: IconRequestKind,
  enabled = true,
): string | null {
  const [src, setSrc] = useState<string | null>(() =>
    path && enabled ? getCachedIcon(path, isDirectory, kind) : null,
  );

  useEffect(() => {
    if (!path || !enabled) {
      setSrc(prev => (prev === null ? prev : null));
      return;
    }
    const apply = () => {
      const next = getCachedIcon(path, isDirectory, kind);
      if (next) {
        setSrc(prev => (prev === next ? prev : next));
      }
    };
    apply();
    return subscribeIcon(path, isDirectory, kind, apply);
  }, [path, isDirectory, kind, enabled]);

  return src;
}

export function useNativeIconFetch(
  path: string | null | undefined,
  isDirectory: boolean,
  kind: IconRequestKind,
  visible: boolean,
  enabled = true,
) {
  useEffect(() => {
    if (!visible || !path || !enabled) return;
    void requestNativeIcon(path, isDirectory, kind);
  }, [path, isDirectory, kind, visible, enabled]);
}
