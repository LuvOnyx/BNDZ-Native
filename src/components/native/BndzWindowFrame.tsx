import React from 'react';
import { createPortal } from 'react-dom';
import { CloseGlyph } from '../ChromeGlyphs';
import { Icons8Icon } from '../Icons8Icon';

export type BndzWindowFrameProps = {
  title: string;
  subtitle?: string;
  iconId?: string;
  onClose: () => void;
  children: React.ReactNode;
  widthClass?: string;
  heightClass?: string;
  zIndexClass?: string;
  /** Settings → Modeless dialog — allow interacting with the FM behind Configuration. */
  modelessDialog?: boolean;
};

/** Large app-style window (Configuration, Extension Hub) with flat native title bar. */
export function BndzWindowFrame({
  title,
  subtitle,
  iconId = 'config',
  onClose,
  children,
  widthClass = 'w-[min(850px,calc(100vw-2rem))]',
  heightClass = 'h-[min(650px,calc(100vh-2rem))]',
  zIndexClass = 'z-50',
  modelessDialog = false,
}: BndzWindowFrameProps) {
  return createPortal(
    <div
      className={`fixed inset-0 ${zIndexClass} flex items-center justify-center p-3 sm:p-4 overflow-hidden ${
        modelessDialog ? 'pointer-events-none bg-transparent' : 'bndz-native-scrim'
      }`}
    >
      <div
        className={`bndz-native-window pointer-events-auto ${widthClass} ${heightClass} flex flex-col overflow-hidden select-none ${
          modelessDialog ? 'shadow-2xl ring-1 ring-white/10' : ''
        }`}
        role="dialog"
        aria-modal={modelessDialog ? false : true}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="bndz-native-window-titlebar px-3 py-2 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Icons8Icon id={iconId} size={14} className="shrink-0 opacity-80" />
            <div className="min-w-0">
              <div className="text-[13px] font-semibold truncate">{title}</div>
              {subtitle && <div className="text-[10px] bndz-native-dialog-muted truncate">{subtitle}</div>}
            </div>
          </div>
          <button
            type="button"
            className="bndz-native-window-close p-1.5 rounded-md shrink-0"
            onClick={onClose}
            aria-label="Close"
          >
            <CloseGlyph size={14} />
          </button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
