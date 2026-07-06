import React, { createContext, useCallback, useContext, useState } from 'react';
import { toWindowsPath } from '../lib/pathUtils';
import { isBndzVirtualPath } from '../lib/bndzVirtualViews';

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
  const [clipboard, setClipboard] = useState<ClipboardState>({ items: [], action: '' });

  const setClipboardState = useCallback((items: string[], action: ClipboardAction) => {
    const normalized = items.map(p => toWindowsPath(p)).filter(Boolean);
    setClipboard({ items: normalized, action });
  }, []);

  const copyToClipboard = useCallback((items: string[]) => {
    setClipboardState(items, 'copy');
  }, [setClipboardState]);

  const clearClipboard = useCallback(() => {
    setClipboard({ items: [], action: '' });
  }, []);

  const executePaste = useCallback(async (targetDir: string) => {
    if (!clipboard.items.length || !clipboard.action) return;
    const panePath = targetDir.replace(/\\/g, '/');
    if (isBndzVirtualPath(panePath)) return;
    const dest = toWindowsPath(targetDir).replace(/\\$/, '');
    if (!dest) return;

    const { IPC } = await import('../lib/ipcBridge');
    const op = clipboard.action === 'cut' ? 'move' : 'copy';

    for (const src of clipboard.items) {
      const winSrc = toWindowsPath(src);
      const name = winSrc.split('\\').pop() || 'item';
      const target = `${dest}\\${name}`;
      await IPC.executeFsOperation(
        `paste-${Date.now()}-${name}`,
        op,
        winSrc,
        target,
        false
      );
    }

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
