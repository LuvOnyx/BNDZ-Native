import { useEffect, useState } from 'react';
import {
  getCachedIcon,
  hasReadyCachedIcon,
  requestNativeIcon,
  subscribeIcon,
  LIST_THUMB_PX,
  type IconRequestKind,
} from './nativeIconService';

/** Subscribe to the global native icon cache without useSyncExternalStore (avoids React #185 loops). */
export function useNativeIcon(
  path: string | null | undefined,
  isDirectory: boolean,
  kind: IconRequestKind,
  enabled = true,
  thumbPx = LIST_THUMB_PX,
): string | null {
  const [src, setSrc] = useState<string | null>(() =>
    path && enabled ? getCachedIcon(path, isDirectory, kind, thumbPx) : null,
  );

  useEffect(() => {
    if (!path || !enabled) {
      setSrc(prev => (prev === null ? prev : null));
      return;
    }
    const apply = () => {
      const next = getCachedIcon(path, isDirectory, kind, thumbPx);
      setSrc(prev => (prev === next ? prev : next));
    };
    apply();
    return subscribeIcon(path, isDirectory, kind, apply, thumbPx);
  }, [path, isDirectory, kind, enabled, thumbPx]);

  return src;
}

export function useNativeIconFetch(
  path: string | null | undefined,
  isDirectory: boolean,
  kind: IconRequestKind,
  visible: boolean,
  enabled = true,
  thumbPx = LIST_THUMB_PX,
) {
  useEffect(() => {
    if (!visible || !path || !enabled) return;
    // Skip IPC when per-path cache is ready — provisional __folder__ must NOT block fetch.
    if (hasReadyCachedIcon(path, isDirectory, kind, thumbPx)) return;
    void requestNativeIcon(path, isDirectory, kind, thumbPx);
  }, [path, isDirectory, kind, visible, enabled, thumbPx]);
}
