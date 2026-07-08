import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { ShellNativeIcon } from './ShellNativeIcon';
import { registerEscapeLayer } from '../lib/globalEscape';
import { BndzNativeDialog } from './BndzNativeDialog';
import { subscribeNativeConfirm, type NativeConfirmOptions } from '../lib/nativeDialog';

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

type ModalContextValue = {
  showModal: (config: ModalConfig) => void;
  closeModal: () => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
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
      onClose={onClose}
      buttons={[
        { label: 'Cancel', style: 'secondary', onClick: onClose },
        { label: 'Skip', style: 'secondary', onClick: () => resolve('skip') },
        { label: 'Keep both', style: 'secondary', onClick: () => resolve('keepboth') },
        { label: 'Replace', style: 'primary', onClick: () => resolve('replace') },
      ]}
    >
      <div className="space-y-3 -mt-1">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="bndz-native-dialog-panel flex items-center gap-2.5 px-3 py-2.5 min-w-0">
            <ShellNativeIcon path={c.sourcePath || c.fileName} size={22} eager />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-wide bndz-native-dialog-muted">Source</div>
              <div className="text-[12px] font-medium truncate">{c.fileName}</div>
              {c.sourcePath && <div className="text-[10px] bndz-native-dialog-muted truncate">{c.sourcePath}</div>}
            </div>
          </div>
          <div className="bndz-native-dialog-panel flex items-center gap-2.5 px-3 py-2.5 min-w-0">
            <ShellNativeIcon path={c.destPath || c.fileName} size={22} eager />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-wide bndz-native-dialog-muted">Destination</div>
              <div className="text-[12px] font-medium truncate">{c.fileName}</div>
              <div className="text-[10px] bndz-native-dialog-muted truncate">{destFolder}</div>
            </div>
          </div>
        </div>

        <label className="flex items-center gap-2 pt-1 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={applyToAll}
            onChange={e => setApplyToAll(e.target.checked)}
            className="accent-[var(--accent,#0ea5e9)]"
          />
          <span className="text-[11px] bndz-native-dialog-muted">Apply to all conflicts in this operation</span>
        </label>
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
      subtitle="BNDZ"
      tone={type === 'destructive' ? 'destructive' : type === 'warning' ? 'warning' : type === 'conflict' ? 'conflict' : 'info'}
      message={config.message}
      onClose={onClose}
      buttons={buttons}
    >
      {config.neverShowAgain && (
        <label className="mt-4 flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={neverAgain}
            onChange={e => setNeverAgain(e.target.checked)}
            className="accent-[var(--accent,#0ea5e9)]"
          />
          <span className="text-[12px] bndz-native-dialog-muted">
            {config.neverShowAgain.label || "Don't ask again"}
          </span>
        </label>
      )}
    </BndzNativeDialog>
  );
}

export default function ModalProvider({ children }: { children: React.ReactNode }) {
  const [modal, setModal] = useState<ModalConfig | null>(null);
  const confirmQueueRef = useRef<((value: boolean) => void) | null>(null);

  const closeModal = useCallback(() => setModal(null), []);
  const showModal = useCallback((config: ModalConfig) => setModal(config), []);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise(resolve => {
      confirmQueueRef.current = resolve;
      setModal({
        type: options.destructive ? 'destructive' : options.type || 'warning',
        title: options.title,
        message: options.message,
        actions: [
          {
            label: options.confirmLabel || 'Continue',
            style: options.destructive ? 'destructive' : 'primary',
            action: () => resolve(true),
          },
          {
            label: options.cancelLabel || 'Cancel',
            style: 'secondary',
            action: () => resolve(false),
          },
        ],
      });
    });
  }, []);

  useEffect(() => registerEscapeLayer({
    id: 'modal',
    priority: 1000,
    isActive: () => !!modal,
    dismiss: () => {
      if (confirmQueueRef.current) {
        confirmQueueRef.current(false);
        confirmQueueRef.current = null;
      }
      closeModal();
    },
  }), [modal, closeModal]);

  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (confirmQueueRef.current) {
          confirmQueueRef.current(false);
          confirmQueueRef.current = null;
        }
        closeModal();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, closeModal]);

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

  const handleClose = useCallback(() => {
    if (confirmQueueRef.current) {
      confirmQueueRef.current(false);
      confirmQueueRef.current = null;
    }
    closeModal();
  }, [closeModal]);

  return (
    <ModalContext.Provider value={{ showModal, closeModal, confirm }}>
      {children}
      {modal && (
        modal.type === 'conflict' && modal.conflict
          ? <FileConflictModal config={modal} onClose={handleClose} />
          : <ConfirmModal config={modal} onClose={handleClose} />
      )}
    </ModalContext.Provider>
  );
}

export function useModal() {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModal must be used within ModalProvider');
  return ctx;
}
