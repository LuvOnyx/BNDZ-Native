import React from 'react';
import { createPortal } from 'react-dom';
import { CloseGlyph } from './ChromeGlyphs';
import { Icons8Icon } from './Icons8Icon';

export type NativeDialogTone = 'info' | 'warning' | 'destructive' | 'conflict';

export type NativeDialogButton = {
  label: string;
  style?: 'primary' | 'secondary' | 'destructive';
  onClick?: () => void;
};

export type BndzNativeDialogProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  message?: React.ReactNode;
  tone?: NativeDialogTone;
  iconId?: string;
  children?: React.ReactNode;
  buttons: NativeDialogButton[];
  onClose?: () => void;
  showCloseButton?: boolean;
  zIndexClass?: string;
};

const toneIcon: Record<NativeDialogTone, string> = {
  info: 'help_ui',
  warning: 'warning',
  destructive: 'delete',
  conflict: 'copy',
};

export function BndzNativeDialog({
  open,
  title,
  subtitle,
  message,
  tone = 'info',
  iconId,
  children,
  buttons,
  onClose,
  showCloseButton = true,
  zIndexClass = 'z-[500]',
}: BndzNativeDialogProps) {
  if (!open) return null;

  const resolvedIcon = iconId ?? toneIcon[tone];

  return createPortal(
    <div
      className={`fixed inset-0 ${zIndexClass} flex items-center justify-center p-6`}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="absolute inset-0 bg-black/70" />
      <div
        className="bndz-native-dialog relative w-full max-w-[480px] rounded-2xl overflow-hidden shadow-2xl"
        role="dialog"
        aria-modal="true"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="bndz-native-dialog-header px-5 py-4 flex items-start gap-3">
          <div className={`bndz-native-dialog-icon bndz-native-dialog-icon--${tone}`}>
            <Icons8Icon id={resolvedIcon} size={18} />
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <h2 className="text-[15px] font-bold leading-tight">{title}</h2>
            {subtitle && <p className="text-[11px] bndz-native-dialog-muted mt-0.5">{subtitle}</p>}
          </div>
          {showCloseButton && onClose && (
            <button type="button" className="bndz-native-dialog-icon-btn p-1.5 rounded-md shrink-0" onClick={onClose} aria-label="Close">
              <CloseGlyph size={16} />
            </button>
          )}
        </div>

        {(message || children) && (
          <div className="px-5 py-4">
            {message && (
              <p className="text-[13px] bndz-native-dialog-muted leading-relaxed whitespace-pre-wrap">{message}</p>
            )}
            {children}
          </div>
        )}

        <div className="bndz-native-dialog-footer px-5 py-4 flex flex-wrap items-center justify-end gap-2">
          {buttons.map((btn, i) => {
            const style = btn.style || (i === buttons.length - 1 ? 'primary' : 'secondary');
            const cls =
              style === 'destructive' ? 'bndz-native-dialog-destructive' :
              style === 'primary' ? 'bndz-native-dialog-primary' :
              'bndz-native-dialog-cancel';
            return (
              <button
                key={`${btn.label}-${i}`}
                type="button"
                className={`${cls} px-4 py-2 rounded-lg text-[12px] font-semibold`}
                onMouseDown={e => { e.preventDefault(); btn.onClick?.(); }}
              >
                {btn.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
