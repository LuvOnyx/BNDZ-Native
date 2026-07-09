import React from 'react';
import { createPortal } from 'react-dom';
import { CloseGlyph } from '../ChromeGlyphs';
import { Icons8Icon } from '../Icons8Icon';
import type { NativeDialogButton, NativeDialogTone } from '../BndzNativeDialog';

export type NativeDialogSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';

const SIZE_CLASS: Record<NativeDialogSize, string> = {
  sm: 'max-w-[400px]',
  md: 'max-w-[440px]',
  lg: 'max-w-[520px]',
  xl: 'max-w-2xl',
  '2xl': 'max-w-4xl',
  full: 'max-w-[min(1000px,calc(100vw-3rem))]',
};

export type NativeDialogVariant = 'alert' | 'sheet';

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
  /** alert = compact message box; sheet = forms / multi-section content */
  variant?: NativeDialogVariant;
};

const TONE_ICON: Record<NativeDialogTone, string> = {
  info: 'info_ui',
  warning: 'warning',
  destructive: 'error_ui',
  conflict: 'copy',
};

export function NativeDialogCheckbox({
  checked,
  onChange,
  children,
  className = '',
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`bndz-native-checkbox ${className}`}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="bndz-native-checkbox-box" aria-hidden />
      <span className="bndz-native-checkbox-label">{children}</span>
    </label>
  );
}

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
  showCloseButton = false,
  zIndexClass = 'z-[500]',
  size = 'md',
  maxHeightClass = 'max-h-[85vh]',
  bodyClassName = '',
  panelClassName = '',
  variant = 'alert',
}: NativeDialogShellProps) {
  if (!open) return null;

  const resolvedIcon = iconId ?? TONE_ICON[tone];
  const showFooter = footer != null || (footerButtons && footerButtons.length > 0);
  const isAlert = variant === 'alert';

  return createPortal(
    <div
      className={`bndz-native-scrim fixed inset-0 ${zIndexClass} flex items-center justify-center p-4`}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        className={`bndz-native-dialog bndz-native-dialog--${variant} relative w-full ${SIZE_CLASS[size]} ${maxHeightClass} flex flex-col ${panelClassName}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bndz-native-dialog-title"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="bndz-native-dialog-titlebar">
          <h2 id="bndz-native-dialog-title" className="bndz-native-dialog-title">{title}</h2>
          {showCloseButton && onClose && (
            <button type="button" className="bndz-native-dialog-titlebar-close" onClick={onClose} aria-label="Close">
              <CloseGlyph size={12} />
            </button>
          )}
        </div>

        {isAlert ? (
          <div className={`bndz-native-alert-body ${bodyClassName}`}>
            <div className={`bndz-native-alert-glyph bndz-native-alert-glyph--${tone}`} aria-hidden>
              <Icons8Icon id={resolvedIcon} size={32} />
            </div>
            <div className="bndz-native-alert-content min-w-0 flex-1">
              {subtitle && <p className="bndz-native-alert-lead">{subtitle}</p>}
              {children}
            </div>
          </div>
        ) : (
          <div className={`bndz-native-sheet-body bndz-scrollbar flex-1 min-h-0 overflow-y-auto ${bodyClassName}`}>
            {subtitle && <p className="bndz-native-sheet-lead">{subtitle}</p>}
            {children}
          </div>
        )}

        {showFooter && (
          <div className="bndz-native-dialog-commandbar">
            {footer ?? (
              <div className="bndz-native-dialog-actions">
                {footerButtons?.map((btn, i) => {
                  const style = btn.style || (i === (footerButtons!.length - 1) ? 'primary' : 'secondary');
                  const cls =
                    style === 'destructive' ? 'bndz-native-btn bndz-native-btn--destructive' :
                    style === 'primary' ? 'bndz-native-btn bndz-native-btn--primary' :
                    'bndz-native-btn bndz-native-btn--secondary';
                  return (
                    <button
                      key={`${btn.label}-${i}`}
                      type="button"
                      className={cls}
                      onMouseDown={e => { e.preventDefault(); btn.onClick?.(); }}
                    >
                      {btn.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
