import React, { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, Info, Loader2, X, Trash2, FolderSync, Copy } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { generateId } from '../lib/generateId';

export type ToastKind = 'success' | 'error' | 'info' | 'warning' | 'progress';

export interface ToastPayload {
  id?: string;
  kind?: ToastKind;
  title?: string;
  message: string;
  progress?: number;
  duration?: number;
  sticky?: boolean;
  /** Mirror to Windows Action Center when native notifications are enabled */
  native?: boolean;
}

interface ToastItem extends Required<Pick<ToastPayload, 'message'>> {
  id: string;
  kind: ToastKind;
  title: string;
  progress?: number;
  duration: number;
  sticky: boolean;
  native?: boolean;
}

const KIND_STYLES: Record<ToastKind, { accent: string; glow: string; icon: React.ReactNode }> = {
  success: {
    accent: 'from-emerald-500/20 to-teal-600/10 border-emerald-500/35',
    glow: 'shadow-[0_8px_32px_rgba(16,185,129,0.15)]',
    icon: <CheckCircle2 size={18} className="text-emerald-400" />,
  },
  error: {
    accent: 'from-rose-500/20 to-red-600/10 border-rose-500/35',
    glow: 'shadow-[0_8px_32px_rgba(244,63,94,0.18)]',
    icon: <AlertCircle size={18} className="text-rose-400" />,
  },
  warning: {
    accent: 'from-amber-500/20 to-orange-600/10 border-amber-500/35',
    glow: 'shadow-[0_8px_32px_rgba(245,158,11,0.15)]',
    icon: <AlertCircle size={18} className="text-amber-400" />,
  },
  info: {
    accent: 'from-sky-500/20 to-indigo-600/10 border-sky-500/35',
    glow: 'shadow-[0_8px_32px_rgba(56,189,248,0.12)]',
    icon: <Info size={18} className="text-sky-400" />,
  },
  progress: {
    accent: 'from-violet-500/20 to-fuchsia-600/10 border-violet-500/35',
    glow: 'shadow-[0_8px_32px_rgba(139,92,246,0.15)]',
    icon: <Loader2 size={18} className="text-violet-400 animate-spin" />,
  },
};

/** Push a toast from anywhere — no React context required */
export function pushToast(payload: ToastPayload) {
  window.dispatchEvent(new CustomEvent('bndz-toast', { detail: payload }));
}

export function dismissToast(id: string) {
  window.dispatchEvent(new CustomEvent('bndz-toast-dismiss', { detail: { id } }));
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const style = KIND_STYLES[toast.kind];

  useEffect(() => {
    if (toast.sticky || toast.kind === 'progress') return;
    const t = setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 28, y: -8, scale: 0.94, filter: 'blur(4px)' }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, x: 20, y: -6, scale: 0.96, filter: 'blur(2px)' }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className={`relative overflow-hidden rounded-xl border backdrop-blur-xl bg-gradient-to-br ${style.accent} ${style.glow}
        min-w-[300px] max-w-[420px]`}
      role="status"
    >
      <div className="flex items-start gap-3 px-4 py-3.5 pr-10">
        <div className="mt-0.5 shrink-0 w-8 h-8 rounded-lg bg-black/25 flex items-center justify-center ring-1 ring-white/5">
          {toast.kind === 'progress' && toast.title.toLowerCase().includes('delet') ? <Trash2 size={16} className="text-violet-400" /> :
           toast.kind === 'progress' && toast.title.toLowerCase().includes('copy') ? <Copy size={16} className="text-violet-400 animate-pulse" /> :
           toast.kind === 'progress' && toast.title.toLowerCase().includes('size') ? <FolderSync size={16} className="text-violet-400 animate-spin" style={{ animationDuration: '2s' }} /> :
           style.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-white/95 leading-tight">{toast.title}</div>
          {toast.message && (
            <div className="text-[11px] text-gray-400 mt-1 leading-relaxed break-words">{toast.message}</div>
          )}
          {toast.kind === 'progress' && toast.progress != null && (
            <div className="mt-2.5 h-1.5 rounded-full bg-black/30 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400 transition-all duration-300 ease-out"
                style={{ width: `${Math.min(100, Math.max(0, toast.progress))}%` }}
              />
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          className="absolute right-2.5 top-2.5 p-1 rounded-md text-gray-500 hover:text-white hover:bg-white/5 transition-colors"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
      {toast.kind !== 'progress' && !toast.sticky && (
        <motion.div
          className="absolute bottom-0 left-0 h-[2px] bg-white/25 origin-left"
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: toast.duration / 1000, ease: 'linear' }}
        />
      )}
    </motion.div>
  );
}

export default function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    const onPush = (e: Event) => {
      const d = (e as CustomEvent<ToastPayload>).detail;
      if (!d?.message) return;
      const item: ToastItem = {
        id: d.id || generateId(),
        kind: d.kind || 'success',
        title: d.title || (d.kind === 'error' ? 'Error' : d.kind === 'warning' ? 'Notice' : d.kind === 'progress' ? 'Working…' : 'Done'),
        message: d.message,
        progress: d.progress,
        duration: d.duration ?? (d.kind === 'error' ? 6000 : 4000),
        sticky: !!d.sticky || d.kind === 'progress',
        native: d.native,
      };
      setToasts(prev => {
        if (d.id) return prev.map(t => t.id === d.id ? { ...t, ...item } : t);
        return [...prev.slice(-4), item];
      });
    };
    const onDismissEvt = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id) dismiss(id);
    };
    window.addEventListener('bndz-toast', onPush);
    window.addEventListener('bndz-toast-dismiss', onDismissEvt);
    return () => {
      window.removeEventListener('bndz-toast', onPush);
      window.removeEventListener('bndz-toast-dismiss', onDismissEvt);
    };
  }, [dismiss]);

  if (!toasts.length) return null;

  return (
    <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2.5 pointer-events-none max-w-[min(420px,calc(100vw-2rem))]">
      <AnimatePresence mode="popLayout">
        {toasts.map(t => (
          <div key={t.id} className="pointer-events-auto">
            <ToastCard toast={t} onDismiss={dismiss} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
