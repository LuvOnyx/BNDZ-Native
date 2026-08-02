import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { toWindowsPath, normalizePanePath } from '../lib/pathUtils';
import { isBndzVirtualPath, isBndzRamWritablePath, isBndzRamPath, parseBndzRamZoneId, bndzRamVirtualPath } from '../lib/bndzVirtualViews';
import { resolvePanePathForFs } from '../lib/ramStagingPaths';
import { IPC } from '../lib/ipcBridge';
import { pushToast } from '../components/ToastHost';
import { useAppConfig } from './configContext';
import { resolveRecreateStructureForPaste } from '../lib/pastePlanning';

const CLIPBOARD_STORAGE_KEY = 'bndz-clipboard-v1';
const CLIPBOARD_HISTORY_KEY = 'bndz-clipboard-history-v1';
const MAX_CLIPBOARD_HISTORY = 16;

function loadStoredClipboard(): ClipboardState {
  try {
    const raw = sessionStorage.getItem(CLIPBOARD_STORAGE_KEY);
    if (!raw) return { items: [], action: '' };
    const parsed = JSON.parse(raw) as Partial<ClipboardState>;
    const items = Array.isArray(parsed.items)
      ? parsed.items.filter((p): p is string => typeof p === 'string').map(p => toWindowsPath(p)).filter(Boolean)
      : [];
    const action = parsed.action === 'copy' || parsed.action === 'cut' ? parsed.action : '';
    return items.length && action ? { items, action } : { items: [], action: '' };
  } catch {
    return { items: [], action: '' };
  }
}

function loadClipboardHistory(): ClipboardHistoryEntry[] {
  try {
    const raw = sessionStorage.getItem(CLIPBOARD_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ClipboardHistoryEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(e => e?.items?.length && (e.action === 'copy' || e.action === 'cut'));
  } catch {
    return [];
  }
}

function persistClipboard(state: ClipboardState) {
  try {
    if (!state.items.length || !state.action) {
      sessionStorage.removeItem(CLIPBOARD_STORAGE_KEY);
    } else {
      sessionStorage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify(state));
    }
  } catch { /* best effort */ }
}

function persistClipboardHistory(history: ClipboardHistoryEntry[]) {
  try {
    if (!history.length) sessionStorage.removeItem(CLIPBOARD_HISTORY_KEY);
    else sessionStorage.setItem(CLIPBOARD_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_CLIPBOARD_HISTORY)));
  } catch { /* best effort */ }
}

function sameClipboard(a: ClipboardState, b: ClipboardState): boolean {
  return a.action === b.action
    && a.items.length === b.items.length
    && a.items.every((p, i) => p === b.items[i]);
}

export type ClipboardAction = 'copy' | 'cut' | '';

export interface ClipboardState {
  items: string[];
  action: ClipboardAction;
}

export interface ClipboardHistoryEntry extends ClipboardState {
  at: number;
}

interface ClipboardContextValue {
  clipboard: ClipboardState;
  clipboardHistory: ClipboardHistoryEntry[];
  copyToClipboard: (items: string[]) => void;
  setClipboardState: (items: string[], action: ClipboardAction) => void;
  restorePreviousClipboard: () => boolean;
  executePaste: (targetDir: string, options?: PasteOptions) => Promise<void>;
  clearClipboard: () => void;
}

export type PasteOptions = {
  /** Override clipboard cut/copy for this paste only. */
  forceAction?: 'copy' | 'cut';
  /** Force recreating source folder structure under the destination. */
  recreateSourceStructure?: boolean;
};

const ClipboardContext = createContext<ClipboardContextValue | null>(null);

export function ClipboardProvider({ children }: { children: React.ReactNode }) {
  const [clipboard, setClipboard] = useState<ClipboardState>(loadStoredClipboard);
  const [clipboardHistory, setClipboardHistory] = useState<ClipboardHistoryEntry[]>(loadClipboardHistory);
  const { config } = useAppConfig();
  const logClipboard = !!config.logClipboardContentsAndEnableRestore;

  const pushHistory = useCallback((prev: ClipboardState) => {
    if (!logClipboard || !prev.items.length || !prev.action) return;
    setClipboardHistory(h => {
      const entry: ClipboardHistoryEntry = { ...prev, at: Date.now() };
      const next = [entry, ...h.filter(e => !sameClipboard(e, prev))].slice(0, MAX_CLIPBOARD_HISTORY);
      persistClipboardHistory(next);
      return next;
    });
  }, [logClipboard]);

  const setClipboardState = useCallback((items: string[], action: ClipboardAction) => {
    // Keep original path strings — resolve to Windows FS paths at paste time.
    // Blind toWindowsPath mangles /bndz/ram/... into bndz\ram\...
    const normalized = items.map(p => {
      const t = (p || '').trim();
      if (!t) return '';
      if (isBndzRamPath(t) || t.startsWith('/bndz/')) return normalizePanePath(t);
      return toWindowsPath(t);
    }).filter(Boolean);
    if (!normalized.length || !action) return;
    const next = { items: normalized, action };
    setClipboard(prev => {
      if (!sameClipboard(prev, next)) pushHistory(prev);
      return next;
    });
    persistClipboard(next);
  }, [pushHistory]);

  const copyToClipboard = useCallback((items: string[]) => {
    setClipboardState(items, 'copy');
  }, [setClipboardState]);

  const clearClipboard = useCallback(() => {
    const empty = { items: [], action: '' as ClipboardAction };
    setClipboard(prev => {
      if (prev.items.length && prev.action) pushHistory(prev);
      return empty;
    });
    persistClipboard(empty);
  }, [pushHistory]);

  const restorePreviousClipboard = useCallback((): boolean => {
    if (!clipboardHistory.length) return false;
    const [entry, ...rest] = clipboardHistory;
    setClipboardHistory(rest);
    persistClipboardHistory(rest);
    const restored = { items: [...entry.items], action: entry.action };
    setClipboard(restored);
    persistClipboard(restored);
    return true;
  }, [clipboardHistory]);

  useEffect(() => {
    persistClipboard(clipboard);
  }, [clipboard]);

  useEffect(() => {
    const onBlur = () => persistClipboard(clipboard);
    const onFocus = () => {
      const stored = loadStoredClipboard();
      if (stored.items.length && stored.action) {
        setClipboard(prev => (sameClipboard(prev, stored) ? prev : stored));
      }
      if (logClipboard) setClipboardHistory(loadClipboardHistory());
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [clipboard, logClipboard]);

  const executePaste = useCallback(async (targetDir: string, options?: PasteOptions) => {
    if (!clipboard.items.length || !clipboard.action) return;
    const panePath = targetDir.replace(/\\/g, '/');
    // Block smart-view / workspace virtual paths — RAM staging zone mounts are real disks.
    if (isBndzVirtualPath(panePath) && !isBndzRamWritablePath(panePath)) return;

    const zoneId = parseBndzRamZoneId(panePath);
    const zoneRoot = zoneId ? bndzRamVirtualPath(zoneId) : null;
    const atZoneRoot = !!(zoneId && normalizePanePath(panePath) === zoneRoot);

    // Zone root: use dedicated stage API (reliable folder trees into the mount).
    if (atZoneRoot && zoneId) {
      const winSources = (await Promise.all(clipboard.items.map(async p => {
        if (isBndzRamPath(p) || p.startsWith('/bndz/')) return (await resolvePanePathForFs(p)) || '';
        return toWindowsPath(p);
      }))).filter(s => s && !s.toLowerCase().startsWith('bndz\\'));
      if (!winSources.length) return;
      try {
        const r = await IPC.ramStagingStagePaths(zoneId, winSources);
        if ((r as { ok?: boolean }).ok === false) {
          throw new Error((r as { error?: string }).error || 'Stage failed');
        }
        window.dispatchEvent(new CustomEvent('bndz-refresh-path', { detail: { path: zoneRoot } }));
        if (options?.forceAction === 'cut' || clipboard.action === 'cut') clearClipboard();
      } catch (e) {
        pushToast({ kind: 'error', title: 'Paste failed', message: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    const dest = (await resolvePanePathForFs(targetDir)).replace(/\\$/, '');
    if (!dest || dest.toLowerCase().startsWith('bndz\\')) return;

    const effectiveAction = options?.forceAction || clipboard.action;
    const op = effectiveAction === 'cut' ? 'move' : 'copy';
    const winSources = (await Promise.all(clipboard.items.map(async p => {
      if (isBndzRamPath(p) || p.startsWith('/bndz/')) return (await resolvePanePathForFs(p)) || '';
      return toWindowsPath(p);
    }))).filter(s => s && !s.toLowerCase().startsWith('bndz\\'));
    if (!winSources.length) return;
    const label = winSources.length === 1
      ? (winSources[0].split('\\').pop() || 'item')
      : `${winSources.length} items`;
    const opId = `paste-${Date.now()}`;

    const recreateSourceStructure = options?.recreateSourceStructure === true
      ? true
      : options?.recreateSourceStructure === false
        ? false
        : (op === 'copy'
          ? resolveRecreateStructureForPaste(config, winSources, msg => window.confirm(msg))
          : false);

    const res = await IPC.executeFsOperation(opId, op, winSources, dest, false, label, 'high', recreateSourceStructure);
    if (res && res.ok === false) {
      pushToast({ kind: 'error', title: 'Paste failed', message: res.error || label });
      return;
    }

    if (isBndzRamPath(panePath)) {
      window.dispatchEvent(new CustomEvent('bndz-refresh-path', { detail: { path: panePath } }));
    }

    if (effectiveAction === 'cut') {
      clearClipboard();
    }
  }, [clipboard, clearClipboard, config]);

  return (
    <ClipboardContext.Provider value={{
      clipboard,
      clipboardHistory,
      copyToClipboard,
      setClipboardState,
      restorePreviousClipboard,
      executePaste,
      clearClipboard,
    }}>
      {children}
    </ClipboardContext.Provider>
  );
}

export function useClipboard(): ClipboardContextValue {
  const ctx = useContext(ClipboardContext);
  if (!ctx) {
    return {
      clipboard: { items: [], action: '' },
      clipboardHistory: [],
      copyToClipboard: () => {},
      setClipboardState: () => {},
      restorePreviousClipboard: () => false,
      executePaste: async () => {},
      clearClipboard: () => {},
    };
  }
  return ctx;
}
