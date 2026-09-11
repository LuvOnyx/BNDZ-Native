import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { generateId } from '../lib/generateId';
import PhysicsToastCard from './PhysicsToastCard';
import {
  PHYSICS_TOAST_BLUR,
  PHYSICS_TOAST_FILTER_ID,
} from '../lib/physicsToast/theme';
import { useAppConfig } from '../data/configContext';
import { IPC } from '../lib/ipcBridge';

export type ToastKind = 'success' | 'error' | 'info' | 'warning' | 'progress';
export type ToastDelivery = 'inApp' | 'windows' | 'both';
export type ToastPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
export type ToastNotifyCategory =
  | 'transfers'
  | 'errors'
  | 'filesystem'
  | 'plugins'
  | 'mesh'
  | 'system'
  | 'progress';

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
  /** Windows category gate (Settings → Notifications). */
  category?: ToastNotifyCategory;
}

interface ToastItem extends Required<Pick<ToastPayload, 'message'>> {
  id: string;
  kind: ToastKind;
  title: string;
  progress?: number;
  duration: number;
  sticky: boolean;
  native?: boolean;
  category: ToastNotifyCategory;
}

const DEFAULT_WINDOWS_CATS: Record<ToastNotifyCategory, boolean> = {
  transfers: true,
  errors: true,
  filesystem: true,
  plugins: false,
  mesh: true,
  system: true,
  progress: false,
};

function inferToastCategory(kind: ToastKind, explicit?: ToastNotifyCategory): ToastNotifyCategory {
  if (explicit) return explicit;
  if (kind === 'error') return 'errors';
  if (kind === 'progress') return 'progress';
  if (kind === 'warning') return 'errors';
  return 'system';
}

function windowsCategoryAllowed(config: Record<string, unknown>, category: ToastNotifyCategory): boolean {
  const raw = (config.windowsNotificationCategories || {}) as Partial<Record<ToastNotifyCategory, boolean>>;
  const merged = { ...DEFAULT_WINDOWS_CATS, ...raw };
  return merged[category] !== false;
}

/** Push a toast from anywhere — no React context required */
export function pushToast(payload: ToastPayload | string, kind?: ToastKind) {
  if (typeof payload === 'string') {
    window.dispatchEvent(new CustomEvent('bndz-toast', {
      detail: { message: payload, kind: kind || 'info' } satisfies ToastPayload,
    }));
    return;
  }
  window.dispatchEvent(new CustomEvent('bndz-toast', { detail: payload }));
}

export function dismissToast(id: string) {
  window.dispatchEvent(new CustomEvent('bndz-toast-dismiss', { detail: { id } }));
}

function resolveToastDelivery(config: Record<string, unknown>): ToastDelivery {
  const raw = String(config.toastDelivery || '').toLowerCase();
  if (raw === 'inapp' || raw === 'in-app') return 'inApp';
  if (raw === 'windows' || raw === 'native') return 'windows';
  if (raw === 'both') return 'both';
  // Legacy: nativeActionCenterToasts / useNativeWindowsNotifications
  if (config.nativeActionCenterToasts === false || config.useNativeWindowsNotifications === false) {
    return 'inApp';
  }
  return IPC.isNative ? 'both' : 'inApp';
}

function resolveToastPosition(config: Record<string, unknown>): ToastPosition {
  const raw = String(config.toastPosition || 'top-right').toLowerCase();
  if (raw === 'top-left' || raw === 'bottom-right' || raw === 'bottom-left' || raw === 'top-right') {
    return raw;
  }
  return 'top-right';
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

function postWindowsNotification(item: ToastItem) {
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

export default function ToastHost() {
  const { config } = useAppConfig();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const delivery = useMemo(() => resolveToastDelivery(config as Record<string, unknown>), [config]);
  const position = useMemo(() => resolveToastPosition(config as Record<string, unknown>), [config]);

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
        category: inferToastCategory(d.kind || 'success', d.category),
      };

      const wantWindows = (delivery === 'windows' || delivery === 'both' || item.native === true)
        && windowsCategoryAllowed(config as Record<string, unknown>, item.category);
      const wantInApp = delivery === 'inApp' || delivery === 'both';

      if (wantWindows) {
        postWindowsNotification(item);
      }

      if (!wantInApp) return;

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
        category: 'system',
      };
      if ((delivery === 'windows' || delivery === 'both')
        && windowsCategoryAllowed(config as Record<string, unknown>, 'system')) {
        postWindowsNotification(item);
      }
      if (delivery === 'windows') return;
      setToasts(prev => [...prev.slice(-4), item]);
    };
    window.addEventListener('bndz-native-alert', onNativeAlert);
    return () => {
      window.removeEventListener('bndz-toast', onPush);
      window.removeEventListener('bndz-toast-dismiss', onDismissEvt);
      window.removeEventListener('bndz-native-alert', onNativeAlert);
    };
  }, [dismiss, delivery, config]);

  return (
    <>
      <PhysicsToastFilter />
      {toasts.length > 0 && (
        <div className="bndz-pt-viewport" data-position={position}>
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
