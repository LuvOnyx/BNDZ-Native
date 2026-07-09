import React from 'react';
import { createPortal } from 'react-dom';
import { CloseGlyph } from '../ChromeGlyphs';
import { Icons8Icon } from '../Icons8Icon';
import type { NativeDialogButton, NativeDialogTone } from '../BndzNativeDialog';

export type NativeDialogSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';

const SIZE_CLASS: Record<NativeDialogSize, string> = {
  sm: 'max-w-[420px]',
  md: 'max-w-[480px]',
  lg: 'max-w-[640px]',
  xl: 'max-w-2xl',
  '2xl': 'max-w-4xl',
  full: 'max-w-[min(1000px,calc(100vw-3rem))]',
};

export type NativeDialogShellProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  tone?: NativeDialogTone;
  iconId?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  footerButtons?: NativeDialogButton[];
  onClose?: () => void;
  showCloseButton?: boolean;
  zIndexClass?: string;
  size?: NativeDialogSize;
  maxHeightClass?: string;
  bodyClassName?: string;
  panelClassName?: string;
};

const TONE_ICON: Record<NativeDialogTone, string> = {
  info: 'help_ui',
  warning: 'warning',
  destructive: 'delete',
  conflict: 'copy',
};

export function NativeDialogShell({
  open,
  title,
  subtitle,
  tone = 'info',
  iconId,
  children,
  footer,
  footerButtons,
  onClose,
  showCloseButton = true,
  zIndexClass = 'z-[500]',
  size = 'md',
  maxHeightClass = 'max-h-[85vh]',
  bodyClassName = '',
  panelClassName = '',
}: NativeDialogShellProps) {
  if (!open) return null;

  const resolvedIcon = iconId ?? TONE_ICON[tone];
  const showFooter = footer != null || (footerButtons && footerButtons.length > 0);

  return createPortal(
    <div
      className={`bndz-native-scrim fixed inset-0 ${zIndexClass} flex items-center justify-center p-4 sm:p-6`}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        className={`bndz-native-dialog relative w-full ${SIZE_CLASS[size]} ${maxHeightClass} rounded-2xl overflow-hidden shadow-2xl flex flex-col ${panelClassName}`}
        role="dialog"
        aria-modal="true"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="bndz-native-dialog-header px-5 py-4 flex items-start gap-3 shrink-0">
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

        <div className={`flex-1 min-h-0 overflow-y-auto bndz-scrollbar px-5 py-4 ${bodyClassName}`}>
          {children}
        </div>

        {showFooter && (
          <div className="bndz-native-dialog-footer px-5 py-4 flex flex-wrap items-center justify-end gap-2 shrink-0">
            {footer ?? footerButtons?.map((btn, i) => {
              const style = btn.style || (i === (footerButtons!.length - 1) ? 'primary' : 'secondary');
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
        )}
      </div>
    </div>,
    document.body,
  );
}
