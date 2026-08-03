import { useCallback, useEffect, useRef, useState } from 'react';
import { IPC } from './ipcBridge';
import { toWindowsPath } from './pathUtils';

export interface LiveSharePeer {
  peerId: string;
  machineName: string;
  folderPath: string;
  selectionPaths: string[];
  cursorPath?: string;
  updatedUtc: string;
}

const POLL_MS = 800;

export function useLiveShareCursor(folderPanePath: string | undefined, enabled: boolean) {
  const [peers, setPeers] = useState<LiveSharePeer[]>([]);
  const [active, setActive] = useState(false);
  const folderWin = folderPanePath ? toWindowsPath(folderPanePath) : '';
  const lastUpdateRef = useRef<{ selection: string[]; cursor?: string }>({ selection: [] });

  useEffect(() => {
    if (!enabled || !folderWin) {
      setPeers([]);
      setActive(false);
      return;
    }
    let cancelled = false;
    void IPC.liveShareStart(folderWin).then(() => {
      if (!cancelled) setActive(true);
    });
    const poll = window.setInterval(() => {
      void IPC.liveShareGetPeers(folderWin).then(r => {
        if (!cancelled) setPeers(r.peers || []);
      });
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      void IPC.liveShareStop(folderWin);
      setActive(false);
      setPeers([]);
    };
  }, [enabled, folderWin]);

  const publish = useCallback((selectionPaths: string[], cursorPath?: string) => {
    if (!enabled || !folderWin || !active) return;
    const sel = selectionPaths.map(p => toWindowsPath(p));
    const cur = cursorPath ? toWindowsPath(cursorPath) : undefined;
    const prev = lastUpdateRef.current;
    if (prev.selection.join('|') === sel.join('|') && prev.cursor === cur) return;
    lastUpdateRef.current = { selection: sel, cursor: cur };
    void IPC.liveShareUpdate(folderWin, sel, cur);
  }, [enabled, folderWin, active]);

  return { peers, active, publish };
}

export function isPathInPeerSelection(
  entityPath: string,
  peers: LiveSharePeer[],
): LiveSharePeer | null {
  const win = toWindowsPath(entityPath).toLowerCase();
  for (const peer of peers) {
    for (const p of peer.selectionPaths) {
      if (toWindowsPath(p).toLowerCase() === win) return peer;
    }
    if (peer.cursorPath && toWindowsPath(peer.cursorPath).toLowerCase() === win) return peer;
  }
  return null;
}
