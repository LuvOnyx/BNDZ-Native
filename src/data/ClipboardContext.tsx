import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { toWindowsPath } from '../lib/pathUtils';
import { isBndzVirtualPath } from '../lib/bndzVirtualViews';

const CLIPBOARD_STORAGE_KEY = 'bndz-clipboard-v1';

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

function persistClipboard(state: ClipboardState) {
  try {
    if (!state.items.length || !state.action) {
      sessionStorage.removeItem(CLIPBOARD_STORAGE_KEY);
    } else {
      sessionStorage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify(state));
    }
  } catch { /* best effort */ }
}

export type ClipboardAction = 'copy' | 'cut' | '';

export interface ClipboardState {
  items: string[];
  action: ClipboardAction;
}

interface ClipboardContextValue {
  clipboard: ClipboardState;
  copyToClipboard: (items: string[]) => void;
  setClipboardState: (items: string[], action: ClipboardAction) => void;
  executePaste: (targetDir: string) => Promise<void>;
  clearClipboard: () => void;
}

const ClipboardContext = createContext<ClipboardContextValue | null>(null);

export function ClipboardProvider({ children }: { children: React.ReactNode }) {
  const [clipboard, setClipboard] = useState<ClipboardState>(loadStoredClipboard);

  const setClipboardState = useCallback((items: string[], action: ClipboardAction) => {
    const normalized = items.map(p => toWindowsPath(p)).filter(Boolean);
    const next = { items: normalized, action };
    persistClipboard(next);
    setClipboard(next);
  }, []);

  const copyToClipboard = useCallback((items: string[]) => {
    setClipboardState(items, 'copy');
  }, [setClipboardState]);

  const clearClipboard = useCallback(() => {
    const empty = { items: [], action: '' as ClipboardAction };
    persistClipboard(empty);
    setClipboard(empty);
  }, []);

  useEffect(() => {
    persistClipboard(clipboard);
  }, [clipboard]);

  useEffect(() => {
    const onBlur = () => persistClipboard(clipboard);
    const onFocus = () => {
      const stored = loadStoredClipboard();
      if (stored.items.length && stored.action) {
        setClipboard(prev => {
          if (prev.items.length === stored.items.length
            && prev.action === stored.action
            && prev.items.every((p, i) => p === stored.items[i])) {
            return prev;
          }
          return stored;
        });
      }
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [clipboard]);

  const executePaste = useCallback(async (targetDir: string) => {
    if (!clipboard.items.length || !clipboard.action) return;
    const panePath = targetDir.replace(/\\/g, '/');
    if (isBndzVirtualPath(panePath)) return;
    const dest = toWindowsPath(targetDir).replace(/\\$/, '');
    if (!dest) return;

    const { IPC } = await import('../lib/ipcBridge');
    const op = clipboard.action === 'cut' ? 'move' : 'copy';
    const winSources = clipboard.items.map(p => toWindowsPath(p));
    const label = winSources.length === 1
      ? (winSources[0].split('\\').pop() || 'item')
      : `${winSources.length} items`;
    const opId = `paste-${Date.now()}`;

    await IPC.executeFsOperation(opId, op, winSources, dest, false, label);

    if (clipboard.action === 'cut') {
      clearClipboard();
    }
  }, [clipboard, clearClipboard]);

  return (
    <ClipboardContext.Provider value={{ clipboard, copyToClipboard, setClipboardState, executePaste, clearClipboard }}>
      {children}
    </ClipboardContext.Provider>
  );
}

export function useClipboard(): ClipboardContextValue {
  const ctx = useContext(ClipboardContext);
  if (!ctx) {
    return {
      clipboard: { items: [], action: '' },
      copyToClipboard: () => {},
      setClipboardState: () => {},
      executePaste: async () => {},
      clearClipboard: () => {},
    };
  }
  return ctx;
}
