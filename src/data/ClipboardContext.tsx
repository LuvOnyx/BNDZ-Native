import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { toWindowsPath, normalizePanePath } from '../lib/pathUtils';
import { isBndzVirtualPath, isBndzRamWritablePath, isBndzRamPath, parseBndzRamZoneId, bndzRamVirtualPath } from '../lib/bndzVirtualViews';
import { resolvePanePathForFs } from '../lib/ramStagingPaths';
import { IPC } from '../lib/ipcBridge';
import { pushToast } from '../components/ToastHost';
import { useAppConfig } from './configContext';
import { resolveRecreateStructureForPasteAsync } from '../lib/pastePlanning';
import { requestNativeConfirm } from '../lib/nativeDialog';
import { isQueuedIpcResult } from '../lib/transferIpc';

const CLIPBOARD_STORAGE_KEY = 'bndz-clipboard-v1';
const CLIPBOARD_HISTORY_KEY = 'bndz-clipboard-history-v1';
const MAX_CLIPBOARD_HISTORY = 16;
const PERSIST_DEBOUNCE_MS = 400;
const HISTORY_PERSIST_DEBOUNCE_MS = 600;
const SHELL_IMPORT_COOLDOWN_MS = 2000;
const SHELL_IMPORT_DEBOUNCE_MS = 180;
const SHELL_PUSH_SKIP_MS = 900;

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

function isEmptyClipboard(state: ClipboardState): boolean {
  return !state.items.length || !state.action;
}

function persistClipboard(state: ClipboardState) {
  try {
    if (isEmptyClipboard(state)) {
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

function historySignature(history: ClipboardHistoryEntry[]): string {
  return history.slice(0, MAX_CLIPBOARD_HISTORY).map(e => `${e.at}:${e.action}:${e.items.join('|')}`).join('\n');
}

function sameClipboard(a: ClipboardState, b: ClipboardState): boolean {
  return a.action === b.action
    && a.items.length === b.items.length
    && a.items.every((p, i) => p === b.items[i]);
}

function pathsEqualIgnoreCase(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const norm = (p: string) => p.replace(/\//g, '\\').toLowerCase();
  const sa = a.map(norm).sort();
  const sb = b.map(norm).sort();
  return sa.every((p, i) => p === sb[i]);
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

async function resolveWinClipboardPaths(items: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of items) {
    if (!p) continue;
    if (isBndzRamPath(p) || p.startsWith('/bndz/')) {
      const resolved = await resolvePanePathForFs(p);
      if (resolved && !resolved.toLowerCase().startsWith('bndz\\') && /^[A-Za-z]:\\/.test(resolved)) {
        out.push(resolved);
      }
      continue;
    }
    const win = toWindowsPath(p);
    if (win && /^[A-Za-z]:\\/.test(win)) out.push(win);
  }
  return out;
}

export function ClipboardProvider({ children }: { children: React.ReactNode }) {
  const [clipboard, setClipboard] = useState<ClipboardState>(loadStoredClipboard);
  const [clipboardHistory, setClipboardHistory] = useState<ClipboardHistoryEntry[]>(loadClipboardHistory);
  const { config } = useAppConfig();
  const logClipboard = !!config.logClipboardContentsAndEnableRestore;
  const clipboardRef = useRef(clipboard);
  clipboardRef.current = clipboard;
  const clipboardHistoryRef = useRef(clipboardHistory);
  clipboardHistoryRef.current = clipboardHistory;
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPersistRef = useRef<ClipboardState | null>(null);
  const lastPersistedRef = useRef<ClipboardState>(loadStoredClipboard());
  const historyPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingHistoryRef = useRef<ClipboardHistoryEntry[] | null>(null);
  const lastHistorySigRef = useRef(historySignature(loadClipboardHistory()));
  const shellImportSkipUntilMs = useRef(0);
  const lastShellImportMs = useRef(0);
  const shellImportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shellPushInFlightRef = useRef(false);

  const writePersistIfChanged = useCallback((state: ClipboardState) => {
    const last = lastPersistedRef.current;
    const nextEmpty = isEmptyClipboard(state);
    const lastEmpty = isEmptyClipboard(last);
    if (nextEmpty && lastEmpty) return;
    if (!nextEmpty && !lastEmpty && sameClipboard(last, state)) return;
    lastPersistedRef.current = state;
    persistClipboard(state);
  }, []);

  const flushPersist = useCallback((state: ClipboardState) => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    pendingPersistRef.current = null;
    writePersistIfChanged(state);
  }, [writePersistIfChanged]);

  const schedulePersist = useCallback((state: ClipboardState) => {
    pendingPersistRef.current = state;
    if (persistTimerRef.current) return;
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      const next = pendingPersistRef.current;
      pendingPersistRef.current = null;
      if (next) writePersistIfChanged(next);
    }, PERSIST_DEBOUNCE_MS);
  }, [writePersistIfChanged]);

  const flushHistoryPersist = useCallback((history: ClipboardHistoryEntry[]) => {
    if (historyPersistTimerRef.current) {
      clearTimeout(historyPersistTimerRef.current);
      historyPersistTimerRef.current = null;
    }
    pendingHistoryRef.current = null;
    const sig = historySignature(history);
    if (sig === lastHistorySigRef.current) return;
    lastHistorySigRef.current = sig;
    persistClipboardHistory(history);
  }, []);

  const scheduleHistoryPersist = useCallback((history: ClipboardHistoryEntry[]) => {
    pendingHistoryRef.current = history;
    if (historyPersistTimerRef.current) return;
    historyPersistTimerRef.current = setTimeout(() => {
      historyPersistTimerRef.current = null;
      const next = pendingHistoryRef.current;
      pendingHistoryRef.current = null;
      if (next) flushHistoryPersist(next);
    }, HISTORY_PERSIST_DEBOUNCE_MS);
  }, [flushHistoryPersist]);

  const pushHistory = useCallback((prev: ClipboardState) => {
    if (!logClipboard || !prev.items.length || !prev.action) return;
    setClipboardHistory(h => {
      const entry: ClipboardHistoryEntry = { ...prev, at: Date.now() };
      const next = [entry, ...h.filter(e => !sameClipboard(e, prev))].slice(0, MAX_CLIPBOARD_HISTORY);
      scheduleHistoryPersist(next);
      return next;
    });
  }, [logClipboard, scheduleHistoryPersist]);

  const applyLocalClipboard = useCallback((items: string[], action: ClipboardAction) => {
    const normalized = items.map(p => {
      const t = (p || '').trim();
      if (!t) return '';
      if (isBndzRamPath(t) || t.startsWith('/bndz/')) return normalizePanePath(t);
      return toWindowsPath(t);
    }).filter(Boolean);
    if (!normalized.length || !action) return null;
    const next = { items: normalized, action };
    const cur = clipboardRef.current;
    if (sameClipboard(cur, next)) return next;
    setClipboard(prev => {
      pushHistory(prev);
      return next;
    });
    schedulePersist(next);
    return next;
  }, [pushHistory, schedulePersist]);

  const setClipboardState = useCallback((items: string[], action: ClipboardAction) => {
    if (IPC.isNative) {
      shellImportSkipUntilMs.current = Date.now() + SHELL_PUSH_SKIP_MS;
    }
    const next = applyLocalClipboard(items, action);
    if (!next || !IPC.isNative) return;

    if (shellPushInFlightRef.current) return;
    shellPushInFlightRef.current = true;
    void (async () => {
      try {
        const winPaths = await resolveWinClipboardPaths(next.items);
        if (!winPaths.length) return;
        shellImportSkipUntilMs.current = Date.now() + SHELL_PUSH_SKIP_MS;
        await IPC.setShellClipboard(winPaths, next.action === 'cut' ? 'cut' : 'copy');
      } catch {
        /* local clipboard still works for in-app paste */
      } finally {
        shellPushInFlightRef.current = false;
      }
    })();
  }, [applyLocalClipboard]);

  const copyToClipboard = useCallback((items: string[]) => {
    setClipboardState(items, 'copy');
  }, [setClipboardState]);

  const clearClipboard = useCallback(() => {
    const empty = { items: [], action: '' as ClipboardAction };
    if (isEmptyClipboard(clipboardRef.current)) return;
    setClipboard(prev => {
      if (prev.items.length && prev.action) pushHistory(prev);
      return empty;
    });
    flushPersist(empty);
    if (IPC.isNative) {
      shellImportSkipUntilMs.current = Date.now() + SHELL_PUSH_SKIP_MS;
      void IPC.clearShellClipboard().catch(() => { /* best effort */ });
    }
  }, [pushHistory, flushPersist]);

  const restorePreviousClipboard = useCallback((): boolean => {
    if (!clipboardHistory.length) return false;
    const [entry, ...rest] = clipboardHistory;
    setClipboardHistory(rest);
    flushHistoryPersist(rest);
    setClipboardState([...entry.items], entry.action);
    return true;
  }, [clipboardHistory, setClipboardState, flushHistoryPersist]);

  const importShellClipboard = useCallback(async () => {
    if (!IPC.isNative) return;
    const now = Date.now();
    if (now < shellImportSkipUntilMs.current) return;
    if (now - lastShellImportMs.current < SHELL_IMPORT_COOLDOWN_MS) return;
    lastShellImportMs.current = now;

    try {
      const shell = await IPC.getShellClipboard();
      if (!shell?.ok || !shell.paths?.length) return;
      const action: ClipboardAction = shell.action === 'cut' || shell.cut ? 'cut' : 'copy';
      const items = shell.paths.map(p => toWindowsPath(p)).filter(Boolean);
      if (!items.length) return;
      const cur = clipboardRef.current;
      if (cur.items.length && cur.action && pathsEqualIgnoreCase(cur.items, items) && cur.action === action) {
        return;
      }
      applyLocalClipboard(items, action);
    } catch {
      /* ignore */
    }
  }, [applyLocalClipboard]);

  const requestShellImport = useCallback(() => {
    if (shellImportTimerRef.current) return;
    shellImportTimerRef.current = setTimeout(() => {
      shellImportTimerRef.current = null;
      void importShellClipboard();
    }, SHELL_IMPORT_DEBOUNCE_MS);
  }, [importShellClipboard]);

  useEffect(() => {
    if (logClipboard) {
      const loaded = loadClipboardHistory();
      lastHistorySigRef.current = historySignature(loaded);
      setClipboardHistory(loaded);
    } else {
      lastHistorySigRef.current = '';
      setClipboardHistory([]);
      flushHistoryPersist([]);
    }
  }, [logClipboard, flushHistoryPersist]);

  useEffect(() => {
    const onBlur = () => {
      const pending = pendingPersistRef.current ?? clipboardRef.current;
      flushPersist(pending);
      const pendingHistory = pendingHistoryRef.current ?? clipboardHistoryRef.current;
      flushHistoryPersist(pendingHistory);
    };
    const onFocus = () => {
      const stored = loadStoredClipboard();
      lastPersistedRef.current = stored;
      if (stored.items.length && stored.action) {
        setClipboard(prev => (sameClipboard(prev, stored) ? prev : stored));
      }
      requestShellImport();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') requestShellImport();
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    requestShellImport();
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      if (historyPersistTimerRef.current) clearTimeout(historyPersistTimerRef.current);
      if (shellImportTimerRef.current) clearTimeout(shellImportTimerRef.current);
    };
  }, [requestShellImport, flushPersist, flushHistoryPersist]);

  const executePaste = useCallback(async (targetDir: string, options?: PasteOptions) => {
    const panePath = targetDir.replace(/\\/g, '/');
    if (isBndzVirtualPath(panePath) && !isBndzRamWritablePath(panePath)) return;

    let sourceItems = clipboard.items;
    let sourceAction: ClipboardAction = clipboard.action;
    if (IPC.isNative) {
      try {
        const shell = await IPC.getShellClipboard();
        if (shell?.ok && shell.paths?.length) {
          const shellAction: ClipboardAction = shell.action === 'cut' || shell.cut ? 'cut' : 'copy';
          const shellItems = shell.paths.map(p => toWindowsPath(p)).filter(Boolean);
          if (shellItems.length) {
            const localEmpty = !clipboard.items.length || !clipboard.action;
            const sameAsShell = !localEmpty && pathsEqualIgnoreCase(clipboard.items, shellItems);
            if (localEmpty || sameAsShell) {
              sourceItems = shellItems;
              sourceAction = shellAction;
              if (localEmpty || clipboard.action !== shellAction) {
                applyLocalClipboard(shellItems, shellAction);
              }
            }
          }
        }
      } catch {
        /* fall back to in-app clipboard */
      }
    }

    if (!sourceItems.length || !sourceAction) return;

    const zoneId = parseBndzRamZoneId(panePath);
    const zoneRoot = zoneId ? bndzRamVirtualPath(zoneId) : null;
    const atZoneRoot = !!(zoneId && normalizePanePath(panePath) === zoneRoot);

    if (atZoneRoot && zoneId) {
      const winSources = (await Promise.all(sourceItems.map(async p => {
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
        if (options?.forceAction === 'cut' || sourceAction === 'cut') clearClipboard();
      } catch (e) {
        pushToast({ kind: 'error', title: 'Paste failed', message: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    const dest = (await resolvePanePathForFs(targetDir)).replace(/\\$/, '');
    if (!dest || dest.toLowerCase().startsWith('bndz\\')) return;

    const effectiveAction = options?.forceAction || sourceAction;
    const op = effectiveAction === 'cut' ? 'move' : 'copy';
    const winSources = (await Promise.all(sourceItems.map(async p => {
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
          ? await resolveRecreateStructureForPasteAsync(config, winSources, async (msg) =>
              requestNativeConfirm({
                title: 'Paste',
                message: msg,
                type: 'warning',
                confirmLabel: 'Recreate structure',
                cancelLabel: 'Paste flat',
              }))
          : false);

    // Cut paste: hide sources immediately (same optimistic path as drag-move / delete).
    if (op === 'move') {
      try {
        window.dispatchEvent(new CustomEvent('bndz-optimistic-fs-op', {
          detail: {
            opId,
            kind: 'move',
            winPaths: winSources,
            label,
          },
        }));
      } catch { /* ignore */ }
    }

    try {
      window.dispatchEvent(new CustomEvent('bndz-transfer-started', {
        detail: { opId, op, label, dest: panePath },
      }));
    } catch { /* ignore */ }

    const res = await IPC.executeFsOperation(opId, op, winSources, dest, false, label, 'high', recreateSourceStructure);
    if (res && res.ok === false) {
      pushToast({ kind: 'error', title: 'Paste failed', message: res.error || label });
      return;
    }

    // Always refresh the paste target so the list updates even if FS watch is quiet.
    window.dispatchEvent(new CustomEvent('bndz-refresh-path', { detail: { path: panePath } }));
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('bndz-refresh-path', { detail: { path: panePath } }));
    }, 500);

    // Background ack is not completion — leave list refresh to the transfer queue listener.
    // Cut clipboard still clears (Explorer clears Cut on paste start); do not toast “done”.
    if (isQueuedIpcResult(res)) {
      if (effectiveAction === 'cut') clearClipboard();
      return;
    }

    if (effectiveAction === 'cut') {
      clearClipboard();
    }
  }, [clipboard, clearClipboard, config, applyLocalClipboard]);

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
