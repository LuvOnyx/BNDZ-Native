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
  /** File size in bytes (0 if unknown) */
  sourceSize?: number;
  sourceModifiedUtc?: number;
  destSize?: number;
  destModifiedUtc?: number;
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

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatModDate(utcSec: number | undefined): string {
  if (!utcSec) return '';
  const d = new Date(utcSec * 1000);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    + ' · '
    + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function ConflictFileCard({
  label,
  path,
  fileName,
  size,
  modUtc,
  badges,
}: {
  label: string;
  path?: string;
  fileName: string;
  size?: number;
  modUtc?: number;
  badges?: Array<{ text: string; color: string }>;
}) {
  const folderPath = path?.replace(/[/\\][^/\\]+$/, '').replace(/[/\\]+$/, '') || undefined;

  return (
    <div
      className="relative flex flex-col gap-2 rounded-[12px] border border-[#ffffff12] bg-[#16161a] px-3.5 py-3 min-w-0 overflow-hidden"
      style={{ boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.06), 0 2px 8px 0 rgba(0,0,0,0.35)' }}
    >
      {/* subtle top-edge glow */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent pointer-events-none" />

      <div className="flex items-center gap-2.5">
        <div
          className="shrink-0 w-11 h-11 rounded-[9px] overflow-hidden flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg,#1e1e24 0%,#29293a 100%)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <ThumbnailIcon
            entity={{ name: fileName, type: 'file' } as any}
            isDir={false}
            path={path || fileName}
            size={44}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div
            className="text-[9px] font-semibold uppercase tracking-widest mb-0.5"
            style={{ color: label === 'Incoming' ? 'rgb(139,183,255)' : 'rgb(180,180,200)', letterSpacing: '0.1em' }}
          >
            {label}
          </div>
          <div className="text-[12.5px] font-medium truncate leading-tight" style={{ color: '#e8e8f0' }}>
            {fileName}
          </div>
          {folderPath && (
            <div className="text-[10px] truncate mt-0.5" style={{ color: 'rgba(160,160,180,0.7)' }} title={folderPath}>
              {folderPath}
            </div>
          )}
        </div>
      </div>

      {/* metadata row */}
      <div className="flex items-center gap-2 flex-wrap">
        {size != null && size > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[10px] font-medium"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(200,200,220,0.85)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            {formatBytes(size)}
          </span>
        )}
        {modUtc != null && modUtc > 0 && (
          <span className="text-[10px]" style={{ color: 'rgba(150,150,170,0.7)' }}>
            {formatModDate(modUtc)}
          </span>
        )}
        {badges?.map(b => (
          <span
            key={b.text}
            className="inline-flex items-center rounded-[5px] px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide"
            style={{ background: b.color + '22', color: b.color, border: `1px solid ${b.color}44` }}
          >
            {b.text}
          </span>
        ))}
      </div>
    </div>
  );
}

function FileConflictModal({
  config,
  onClose,
}: {
  config: ModalConfig;
  onClose: () => void;
}) {
  const c = config.conflict!;
  const [applyToAll, setApplyToAll] = useState(false);

  const srcNewer = (c.sourceModifiedUtc ?? 0) > (c.destModifiedUtc ?? 0);
  const destNewer = (c.destModifiedUtc ?? 0) > (c.sourceModifiedUtc ?? 0);
  const srcLarger = (c.sourceSize ?? 0) > (c.destSize ?? 0) + 1024;
  const destLarger = (c.destSize ?? 0) > (c.sourceSize ?? 0) + 1024;

  const srcBadges: Array<{ text: string; color: string }> = [];
  const destBadges: Array<{ text: string; color: string }> = [];
  if (srcNewer) srcBadges.push({ text: 'Newer', color: 'rgb(139,183,255)' });
  if (srcLarger) srcBadges.push({ text: 'Larger', color: 'rgb(160,220,160)' });
  if (destNewer) destBadges.push({ text: 'Newer', color: 'rgb(220,180,255)' });
  if (destLarger) destBadges.push({ text: 'Larger', color: 'rgb(160,220,160)' });

  // Cancel = skip ALL remaining conflicts in this operation; Skip = skip just this one.
  const cancel = () => {
    config.onConflictResolve?.('skip', true);
    onClose();
  };
  const resolve = (resolution: 'replace' | 'keepboth' | 'skip') => {
    onClose();
    config.onConflictResolve?.(resolution, applyToAll);
  };

  return (
    <BndzNativeDialog
      open
      title={config.title}
      subtitle="A file with this name already exists — choose how to proceed."
      tone="conflict"
      variant="sheet"
      size="lg"
      onClose={cancel}
      buttons={[
        { label: 'Cancel all', style: 'secondary', onClick: cancel },
        { label: 'Skip', style: 'secondary', onClick: () => resolve('skip') },
        { label: 'Keep both', style: 'secondary', onClick: () => resolve('keepboth') },
        { label: 'Replace', style: 'primary', onClick: () => resolve('replace') },
      ]}
    >
      <div className="space-y-3 -mt-0.5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <ConflictFileCard
            label="Incoming"
            path={c.sourcePath}
            fileName={c.fileName}
            size={c.sourceSize}
            modUtc={c.sourceModifiedUtc}
            badges={srcBadges}
          />
          <ConflictFileCard
            label="Existing"
            path={c.destPath}
            fileName={c.fileName}
            size={c.destSize}
            modUtc={c.destModifiedUtc}
            badges={destBadges}
          />
        </div>

        {/* VS divider hint */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
          <span className="text-[9.5px] font-bold tracking-widest uppercase" style={{ color: 'rgba(180,160,220,0.5)' }}>vs</span>
          <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
        </div>

        <NativeDialogCheckbox
          checked={applyToAll}
          onChange={setApplyToAll}
        >
          Apply to all remaining conflicts in this operation
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
