import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, HelpCircle, X, Trash2, Copy } from 'lucide-react';
import { registerEscapeLayer } from '../lib/globalEscape';

export type ModalAction = {
  label: string;
  style?: 'primary' | 'secondary' | 'destructive';
  action: () => void | Promise<void>;
};

export type ModalConfig = {
  type?: 'destructive' | 'conflict' | 'info' | 'warning';
  title: string;
  message: string;
  actions: ModalAction[];
  /** Optional "Don't ask again" checkbox — calls onNeverShowAgain when primary action runs */
  neverShowAgain?: {
    label?: string;
    onConfirm: () => void;
  };
};

type ModalContextValue = {
  showModal: (config: ModalConfig) => void;
  closeModal: () => void;
};

const ModalContext = createContext<ModalContextValue | null>(null);

function ConfirmModal({ config, onClose }: { config: ModalConfig; onClose: () => void }) {
  const type = config.type || 'info';
  const [neverAgain, setNeverAgain] = useState(false);
  const headerGradient =
    type === 'destructive' ? 'from-rose-600/90 via-red-700/80 to-rose-900/90' :
    type === 'conflict' ? 'from-amber-600/90 via-orange-700/80 to-amber-900/90' :
    type === 'warning' ? 'from-yellow-600/80 via-amber-700/70 to-yellow-900/80' :
    'from-sky-600/90 via-indigo-700/80 to-violet-900/90';

  const Icon =
    type === 'destructive' ? Trash2 :
    type === 'conflict' ? Copy :
    type === 'warning' ? AlertTriangle :
    HelpCircle;

  const runAction = (action: ModalAction, isPrimary: boolean) => {
    if (isPrimary && neverAgain && config.neverShowAgain) {
      try { config.neverShowAgain.onConfirm(); } catch { /* noop */ }
    }
    onClose();
    try { void action.action(); } catch { /* noop */ }
  };

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/65 backdrop-blur-[3px]" />
      <div
        className="relative w-full max-w-[480px] rounded-xl border border-white/10 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className={`px-5 py-4 bg-gradient-to-r ${headerGradient} flex items-start gap-3`}>
          <div className="w-10 h-10 rounded-lg bg-black/25 flex items-center justify-center shrink-0">
            <Icon size={20} className="text-white" />
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <h2 className="text-[15px] font-bold text-white tracking-tight">{config.title}</h2>
            <p className="text-[11px] text-white/70 mt-0.5">BNDZ</p>
          </div>
          <button
            type="button"
            className="p-1 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="bg-[#1a1a1e] px-5 py-4">
          <p className="text-[13px] text-gray-300 leading-relaxed whitespace-pre-wrap">{config.message}</p>
          {config.neverShowAgain && (
            <label className="mt-4 flex items-center gap-2.5 cursor-pointer select-none group">
              <input
                type="checkbox"
                checked={neverAgain}
                onChange={e => setNeverAgain(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-[#555] bg-[#252528] accent-sky-500"
              />
              <span className="text-[12px] text-gray-400 group-hover:text-gray-300 transition-colors">
                {config.neverShowAgain.label || "Don't ask again"}
              </span>
            </label>
          )}
        </div>

        <div className="bg-[#141418] px-5 py-3.5 flex flex-wrap justify-end gap-2 border-t border-white/5">
          {config.actions.map((action, i) => {
            const style = action.style || (i === 0 ? 'primary' : 'secondary');
            const cls =
              style === 'destructive'
                ? 'bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-500 hover:to-red-600 text-white shadow-lg shadow-rose-900/30'
                : style === 'primary'
                ? 'bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white shadow-lg shadow-sky-900/25'
                : 'bg-[#2a2a30] hover:bg-[#35353d] text-gray-200 border border-[#444]';
            const isPrimary = style === 'primary' || style === 'destructive';
            return (
              <button
                key={i}
                type="button"
                className={`px-4 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${cls}`}
                onMouseDown={e => { e.preventDefault(); runAction(action, isPrimary); }}
              >
                {action.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function ModalProvider({ children }: { children: React.ReactNode }) {
  const [modal, setModal] = useState<ModalConfig | null>(null);

  const closeModal = useCallback(() => setModal(null), []);
  const showModal = useCallback((config: ModalConfig) => setModal(config), []);

  useEffect(() => registerEscapeLayer({
    id: 'modal',
    priority: 1000,
    isActive: () => !!modal,
    dismiss: closeModal,
  }), [modal, closeModal]);

  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, closeModal]);

  return (
    <ModalContext.Provider value={{ showModal, closeModal }}>
      {children}
      {modal && typeof document !== 'undefined' && createPortal(
        <ConfirmModal config={modal} onClose={closeModal} />,
        document.body
      )}
    </ModalContext.Provider>
  );
}

export function useModal() {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModal must be used within ModalProvider');
  return ctx;
}
