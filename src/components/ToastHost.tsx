import React, { useEffect, useState, useCallback } from 'react';
import { generateId } from '../lib/generateId';
import PhysicsToastCard from './PhysicsToastCard';
import {
  PHYSICS_TOAST_BLUR,
  PHYSICS_TOAST_FILTER_ID,
} from '../lib/physicsToast/theme';

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

/** Push a toast from anywhere — no React context required */
export function pushToast(payload: ToastPayload) {
  window.dispatchEvent(new CustomEvent('bndz-toast', { detail: payload }));
}

export function dismissToast(id: string) {
  window.dispatchEvent(new CustomEvent('bndz-toast-dismiss', { detail: { id } }));
}

function PhysicsToastFilter() {
  return (
    <svg aria-hidden className="bndz-pt-filter-defs" width={0} height={0}>
      <defs>
        <filter
          id={PHYSICS_TOAST_FILTER_ID}
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation={PHYSICS_TOAST_BLUR} result="blur" />
          <feColorMatrix
            in="blur"
            mode="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10"
            result="goo"
          />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter>
      </defs>
    </svg>
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
      if (item.native || item.kind === 'error' || item.kind === 'warning') {
        try {
          const chrome = (window as any)?.chrome?.webview;
          chrome?.postMessage?.({
            type: 'SHOW_APP_NOTIFICATION',
            payload: {
              title: item.title,
              message: item.message,
              tag: item.id,
            },
          });
        } catch {
          /* non-shell */
        }
      }
    };
    const onDismissEvt = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id) dismiss(id);
    };
    window.addEventListener('bndz-toast', onPush);
    window.addEventListener('bndz-toast-dismiss', onDismissEvt);
    const onNativeAlert = (e: Event) => {
      const d = (e as CustomEvent<{ title?: string; message: string }>).detail;
      if (!d?.message) return;
      const item: ToastItem = {
        id: generateId(),
        kind: 'warning',
        title: d.title || 'BNDZ',
        message: d.message,
        duration: 6000,
        sticky: false,
      };
      setToasts(prev => [...prev.slice(-4), item]);
    };
    window.addEventListener('bndz-native-alert', onNativeAlert);
    return () => {
      window.removeEventListener('bndz-toast', onPush);
      window.removeEventListener('bndz-toast-dismiss', onDismissEvt);
      window.removeEventListener('bndz-native-alert', onNativeAlert);
    };
  }, [dismiss]);

  return (
    <>
      <PhysicsToastFilter />
      {toasts.length > 0 && (
        <div className="bndz-pt-viewport" data-position="top-right">
          {toasts.map(t => (
            <PhysicsToastCard
              key={t.id}
              id={t.id}
              kind={t.kind}
              title={t.title}
              message={t.message}
              progress={t.progress}
              duration={t.duration}
              sticky={t.sticky}
              onDismiss={dismiss}
            />
          ))}
        </div>
      )}
    </>
  );
}
