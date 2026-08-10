import { useEffect, useLayoutEffect } from 'react';
import {
  isNativeShellHostBoot,
  postNativeListSlotBounds,
  subscribeNativeShellListing,
} from '../lib/nativeShellHostBoot';
import { normalizePanePath } from '../lib/pathUtils';
import { normalizeDirEntries } from '../lib/normalizeDirEntry';

type BridgeOpts = {
  activePaneId: string;
  paneScrollElsRef: React.MutableRefObject<Record<string, HTMLElement | null>>;
  cachePathContents: (path: string, items: unknown[], opts?: { retainLarger?: boolean }) => void;
  filesFedPathsRef: React.MutableRefObject<Set<string>>;
  resolveFilesHostListingWaiters: (path: string) => void;
  dirFetchInFlightRef: React.MutableRefObject<Set<string>>;
  setLoadingPaths: React.Dispatch<React.SetStateAction<Set<string>>>;
  setPathLoadErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
};

/** WinUI native-list overlay bridge — bounds only; listing is React+IPC (WebView2 HWND airspace). */
export function useNativeShellHostBridge(opts: BridgeOpts): void {
  const {
    activePaneId,
    paneScrollElsRef,
    cachePathContents,
    filesFedPathsRef,
    resolveFilesHostListingWaiters,
    dirFetchInFlightRef,
    setLoadingPaths,
    setPathLoadErrors,
  } = opts;

  // Keep overlay collapsed so it never covers the React list / workspace tools.
  useLayoutEffect(() => {
    if (!isNativeShellHostBoot()) return;
    postNativeListSlotBounds({ x: 0, y: 0, width: 0, height: 0 }, false);
  }, [activePaneId, paneScrollElsRef]);

  useEffect(() => {
    if (!isNativeShellHostBoot()) return;
    return subscribeNativeShellListing((path, items, complete) => {
      const norm = normalizePanePath(path);
      if (!norm) return;
      filesFedPathsRef.current.add(norm);
      dirFetchInFlightRef.current.delete(norm);
      const normalized = normalizeDirEntries(items as any[]);
      cachePathContents(norm, normalized, { retainLarger: true });
      resolveFilesHostListingWaiters(norm);
      setLoadingPaths((prev) => {
        if (!prev.has(norm)) return prev;
        const next = new Set(prev);
        next.delete(norm);
        return next;
      });
      setPathLoadErrors((prev) => {
        if (!(norm in prev)) return prev;
        const next = { ...prev };
        delete next[norm];
        return next;
      });
      if (!complete) return;
    });
  }, [
    cachePathContents,
    dirFetchInFlightRef,
    filesFedPathsRef,
    resolveFilesHostListingWaiters,
    setLoadingPaths,
    setPathLoadErrors,
  ]);
}
