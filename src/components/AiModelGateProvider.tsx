import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AiDownloadConsentModal, { type AiDownloadModalPhase } from './AiDownloadConsentModal';
import { IPC } from '../lib/ipcBridge';
import { setAiModelGateHandler } from '../lib/aiModelGate';

type AiModelGateContextValue = {
  ensureAiModelReady: () => Promise<boolean>;
};

const AiModelGateContext = createContext<AiModelGateContextValue | null>(null);

export function AiModelGateProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<AiDownloadModalPhase>('prompt');
  const [progress, setProgress] = useState(0);
  const [modelName, setModelName] = useState('Qwen2.5-1.5B-Instruct');
  const [sizeLabel, setSizeLabel] = useState('~1 GB');
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const resolverRef = useRef<((granted: boolean) => void) | null>(null);
  const unsubProgressRef = useRef<(() => void) | null>(null);
  const pollRef = useRef<number | null>(null);

  const cleanupWaiters = useCallback(() => {
    unsubProgressRef.current?.();
    unsubProgressRef.current = null;
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const finish = useCallback((granted: boolean) => {
    cleanupWaiters();
    resolverRef.current?.(granted);
    resolverRef.current = null;
    setOpen(false);
    setPhase('prompt');
    setProgress(0);
    setErrorMessage(undefined);
  }, [cleanupWaiters]);

  const watchDownloadUntilReady = useCallback(() => {
    cleanupWaiters();
    setPhase('downloading');
    setOpen(true);
    unsubProgressRef.current = IPC.onAiDownloadProgress(p => setProgress(p.percent ?? 0));
    pollRef.current = window.setInterval(async () => {
      try {
        const s = await IPC.getAiModelStatus();
        if (s.present) finish(true);
      } catch { /* keep polling */ }
    }, 1500);
  }, [cleanupWaiters, finish]);

  const ensureAiModelReady = useCallback(async (): Promise<boolean> => {
    if (!IPC.isNative) return false;
    try {
      const status = await IPC.getAiModelStatus();
      setModelName(status.modelName || 'Qwen2.5-1.5B-Instruct');
      setSizeLabel(status.sizeLabel || '~1 GB');
      if (status.present) return true;

      if (status.downloading) {
        return new Promise<boolean>(resolve => {
          resolverRef.current = resolve;
          watchDownloadUntilReady();
        });
      }
    } catch {
      return false;
    }

    return new Promise<boolean>(resolve => {
      resolverRef.current = resolve;
      setPhase('prompt');
      setProgress(0);
      setErrorMessage(undefined);
      setOpen(true);
    });
  }, [watchDownloadUntilReady]);

  useEffect(() => {
    setAiModelGateHandler(ensureAiModelReady);
    return () => setAiModelGateHandler(null);
  }, [ensureAiModelReady]);

  const startDownload = useCallback(async () => {
    watchDownloadUntilReady();
    try {
      const ok = await IPC.downloadAiModel();
      if (ok) {
        finish(true);
      } else {
        cleanupWaiters();
        setPhase('error');
        setErrorMessage('Download failed. Check your internet connection and try again.');
      }
    } catch (err: unknown) {
      cleanupWaiters();
      setPhase('error');
      setErrorMessage(err instanceof Error ? err.message : 'Download failed.');
    }
  }, [watchDownloadUntilReady, finish, cleanupWaiters]);

  const handleCancel = useCallback(() => {
    if (phase === 'downloading') return;
    finish(false);
  }, [phase, finish]);

  return (
    <AiModelGateContext.Provider value={{ ensureAiModelReady }}>
      {children}
      <AiDownloadConsentModal
        open={open}
        phase={phase}
        progress={progress}
        modelName={modelName}
        sizeLabel={sizeLabel}
        errorMessage={errorMessage}
        onConfirm={() => void startDownload()}
        onCancel={handleCancel}
      />
    </AiModelGateContext.Provider>
  );
}

export function useAiModelGate() {
  const ctx = useContext(AiModelGateContext);
  if (!ctx) throw new Error('useAiModelGate must be used within AiModelGateProvider');
  return ctx;
}
