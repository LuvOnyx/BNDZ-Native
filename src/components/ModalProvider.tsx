import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ThumbnailIcon } from './ThumbnailIcon';
import { registerEscapeLayer } from '../lib/globalEscape';
import { BndzNativeDialog } from './BndzNativeDialog';
import { NativeDialogCheckbox } from './native/NativeDialogShell';
import {
  subscribeNativeConfirm,
  subscribeNativePrompt,
  type NativeConfirmOptions,
  type NativePromptOptions,
} from '../lib/nativeDialog';

export type ModalAction = {
  label: string;
  style?: 'primary' | 'secondary' | 'destructive';
  action: () => void | Promise<void>;
};

export type ConflictDetails = {
  opId: string;
  fileName: string;
  sourcePath?: string;
  destPath?: string;
};

export type ModalConfig = {
  type?: 'destructive' | 'conflict' | 'info' | 'warning';
  title: string;
  message: string;
  actions: ModalAction[];
  conflict?: ConflictDetails;
  onConflictResolve?: (resolution: 'replace' | 'keepboth' | 'skip', applyToAll: boolean) => void;
  neverShowAgain?: {
    label?: string;
    onConfirm: () => void;
  };
};

type ConfirmOptions = NativeConfirmOptions;

type PromptState = NativePromptOptions & {
  resolve: (value: string | null) => void;
};

type ModalContextValue = {
  showModal: (config: ModalConfig) => void;
  closeModal: () => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: NativePromptOptions) => Promise<string | null>;
};

const ModalContext = createContext<ModalContextValue | null>(null);

function FileConflictModal({
  config,
  onClose,
}: {
  config: ModalConfig;
  onClose: () => void;
}) {
  const c = config.conflict!;
  const [applyToAll, setApplyToAll] = useState(false);
  const destFolder = c.destPath?.replace(/[/\\][^/\\]+$/, '').replace(/[/\\]+$/, '') || 'destination folder';

  const resolve = (resolution: 'replace' | 'keepboth' | 'skip') => {
    onClose();
    config.onConflictResolve?.(resolution, applyToAll);
  };

  return (
    <BndzNativeDialog
      open
      title={config.title}
      subtitle="Choose what to do with this file."
      tone="conflict"
      variant="sheet"
      size="lg"
      onClose={onClose}
      buttons={[
        { label: 'Cancel', style: 'secondary', onClick: () => resolve('skip') },
        { label: 'Skip', style: 'secondary', onClick: () => resolve('skip') },
        { label: 'Keep both', style: 'secondary', onClick: () => resolve('keepboth') },
        { label: 'Replace', style: 'primary', onClick: () => resolve('replace') },
      ]}
    >
      <div className="space-y-3 -mt-1">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="bndz-native-dialog-panel flex items-start gap-3 px-3 py-3 min-w-0">
            <div className="shrink-0 w-12 h-12 rounded-[10px] overflow-hidden bg-[#1e1e1e] border border-[#3a3a3a] flex items-center justify-center">
              <ThumbnailIcon
                entity={{ name: c.fileName, type: 'file' } as any}
                isDir={false}
                path={c.sourcePath || c.fileName}
                size={48}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-wide bndz-native-dialog-muted">Source</div>
              <div className="text-[12px] font-medium truncate mt-0.5">{c.fileName}</div>
              {c.sourcePath && <div className="text-[10px] bndz-native-dialog-muted truncate mt-0.5" title={c.sourcePath}>{c.sourcePath}</div>}
            </div>
          </div>
          <div className="bndz-native-dialog-panel flex items-start gap-3 px-3 py-3 min-w-0">
            <div className="shrink-0 w-12 h-12 rounded-[10px] overflow-hidden bg-[#1e1e1e] border border-[#3a3a3a] flex items-center justify-center">
              <ThumbnailIcon
                entity={{ name: c.fileName, type: 'file' } as any}
                isDir={false}
                path={c.destPath || c.fileName}
                size={48}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-wide bndz-native-dialog-muted">Destination</div>
              <div className="text-[12px] font-medium truncate mt-0.5">{c.fileName}</div>
              <div className="text-[10px] bndz-native-dialog-muted truncate mt-0.5" title={destFolder}>{destFolder}</div>
            </div>
          </div>
        </div>

        <NativeDialogCheckbox
          checked={applyToAll}
          onChange={setApplyToAll}
          className="mt-1"
        >
          Apply to all conflicts in this operation
        </NativeDialogCheckbox>
      </div>
    </BndzNativeDialog>
  );
}

function ConfirmModal({ config, onClose }: { config: ModalConfig; onClose: () => void }) {
  const type = config.type || 'info';
  const [neverAgain, setNeverAgain] = useState(false);

  const runAction = (action: ModalAction, isPrimary: boolean) => {
    if (isPrimary && neverAgain && config.neverShowAgain) {
      try { config.neverShowAgain.onConfirm(); } catch { /* noop */ }
    }
    onClose();
    try { void action.action(); } catch { /* noop */ }
  };

  const buttons = config.actions.map((action, i) => {
    const style = action.style || (i === 0 ? 'primary' : 'secondary');
    const isPrimary = style === 'primary' || style === 'destructive';
    return {
      label: action.label,
      style,
      onClick: () => runAction(action, isPrimary),
    };
  });

  return (
    <BndzNativeDialog
      open
      title={config.title}
      tone={type === 'destructive' ? 'destructive' : type === 'warning' ? 'warning' : type === 'conflict' ? 'conflict' : 'info'}
      message={config.message}
      onClose={onClose}
      buttons={buttons}
    >
      {config.neverShowAgain && (
        <NativeDialogCheckbox
          checked={neverAgain}
          onChange={setNeverAgain}
        >
          {config.neverShowAgain.label || "Don't ask again"}
        </NativeDialogCheckbox>
      )}
    </BndzNativeDialog>
  );
}

function PromptModal({
  state,
  onClose,
}: {
  state: PromptState;
  onClose: () => void;
}) {
  const [value, setValue] = useState(state.defaultValue ?? '');
  const multiline = (state.defaultValue ?? '').includes('\n');
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const submit = () => {
    state.resolve(value);
    onClose();
  };

  const cancel = () => {
    state.resolve(null);
    onClose();
  };

  return (
    <BndzNativeDialog
      open
      title={state.title}
      tone="info"
      variant="sheet"
      size={multiline ? 'md' : 'sm'}
      message={state.message}
      onClose={cancel}
      buttons={[
        { label: state.cancelLabel || 'Cancel', style: 'secondary', onClick: cancel },
        { label: state.confirmLabel || 'OK', style: 'primary', onClick: submit },
      ]}
    >
      {multiline ? (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          className="bndz-native-input w-full min-h-[120px] resize-y bndz-mono text-[12px]"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
        />
      ) : (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="text"
          className="bndz-native-input w-full"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
        />
      )}
    </BndzNativeDialog>
  );
}

export default function ModalProvider({ children }: { children: React.ReactNode }) {
  const [modal, setModal] = useState<ModalConfig | null>(null);
  const [promptState, setPromptState] = useState<PromptState | null>(null);
  const confirmQueueRef = useRef<((value: boolean) => void) | null>(null);
  const promptQueueRef = useRef<((value: string | null) => void) | null>(null);

  const closeModal = useCallback(() => setModal(null), []);
  const showModal = useCallback((config: ModalConfig) => setModal(config), []);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise(resolve => {
      confirmQueueRef.current = resolve;
      setPromptState(null);
      setModal({
        type: options.destructive ? 'destructive' : options.type || 'warning',
        title: options.title,
        message: options.message,
        actions: [
          {
            label: options.cancelLabel || 'Cancel',
            style: 'secondary',
            action: () => resolve(false),
          },
          {
            label: options.confirmLabel || 'Continue',
            style: options.destructive ? 'destructive' : 'primary',
            action: () => resolve(true),
          },
        ],
      });
    });
  }, []);

  const prompt = useCallback((options: NativePromptOptions): Promise<string | null> => {
    return new Promise(resolve => {
      promptQueueRef.current = resolve;
      setModal(null);
      setPromptState({ ...options, resolve });
    });
  }, []);

  const dismissAll = useCallback(() => {
    if (confirmQueueRef.current) {
      confirmQueueRef.current(false);
      confirmQueueRef.current = null;
    }
    if (promptQueueRef.current) {
      promptQueueRef.current(null);
      promptQueueRef.current = null;
    }
    closeModal();
    setPromptState(null);
  }, [closeModal]);

  useEffect(() => registerEscapeLayer({
    id: 'modal',
    priority: 1000,
    isActive: () => !!modal || !!promptState,
    dismiss: dismissAll,
  }), [modal, promptState, dismissAll]);

  useEffect(() => {
    if (!modal && !promptState) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismissAll();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, promptState, dismissAll]);

  useEffect(() => {
    return subscribeNativeConfirm(request => {
      confirm({
        title: request.title,
        message: request.message,
        type: request.type,
        confirmLabel: request.confirmLabel,
        cancelLabel: request.cancelLabel,
        destructive: request.destructive,
      }).then(request.resolve);
    });
  }, [confirm]);

  useEffect(() => {
    return subscribeNativePrompt(request => {
      prompt({
        title: request.title,
        message: request.message,
        defaultValue: request.defaultValue,
        confirmLabel: request.confirmLabel,
        cancelLabel: request.cancelLabel,
      }).then(request.resolve);
    });
  }, [prompt]);

  const handleClose = useCallback(() => {
    if (confirmQueueRef.current) {
      confirmQueueRef.current(false);
      confirmQueueRef.current = null;
    }
    closeModal();
  }, [closeModal]);

  return (
    <ModalContext.Provider value={{ showModal, closeModal, confirm, prompt }}>
      {children}
      {modal && (
        modal.type === 'conflict' && modal.conflict
          ? <FileConflictModal config={modal} onClose={handleClose} />
          : <ConfirmModal config={modal} onClose={handleClose} />
      )}
      {promptState && (
        <PromptModal
          state={promptState}
          onClose={() => {
            promptQueueRef.current = null;
            setPromptState(null);
          }}
        />
      )}
    </ModalContext.Provider>
  );
}

export function useModal() {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModal must be used within ModalProvider');
  return ctx;
}
