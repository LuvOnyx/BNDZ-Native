import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface QuitConfirmDialogProps {
  open: boolean;
  source?: string;
  onCancel: () => void;
  onQuit: () => void;
  onMinimizeToTray: (remember: boolean) => void;
}

export default function QuitConfirmDialog({
  open,
  source = 'x',
  onCancel,
  onQuit,
  onMinimizeToTray,
}: QuitConfirmDialogProps) {
  const [minimizeToTray, setMinimizeToTray] = useState(false);

  if (!open) return null;

  const fromTray = source === 'tray';
  const fromMenu = source === 'menu';

  return createPortal(
    <div
      className="fixed inset-0 z-[650] flex items-center justify-center p-6"
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="bndz-quit-dialog relative w-full max-w-[420px] rounded-2xl overflow-hidden shadow-2xl"
        role="dialog"
        aria-modal="true"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="bndz-quit-dialog-header px-5 py-4 flex items-center justify-between">
          <h2 className="text-[15px] font-bold">
            {fromTray ? 'Quit BNDZ?' : 'Close BNDZ?'}
          </h2>
          <button type="button" className="bndz-quit-dialog-icon-btn p-1.5 rounded-md" onClick={onCancel} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4">
          <p className="text-[13px] bndz-quit-dialog-muted leading-relaxed">
            {fromTray || fromMenu
              ? 'BNDZ can keep running in the system tray with quick access to the launcher and file manager.'
              : 'Are you sure you want to close? BNDZ can stay in the system tray so you can open it again quickly.'}
          </p>
          <label className="mt-4 flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              className="accent-[var(--accent,#0ea5e9)]"
              checked={minimizeToTray}
              onChange={e => setMinimizeToTray(e.target.checked)}
            />
            <span className="text-[12px]">Minimize to system tray instead</span>
          </label>
        </div>
        <div className="bndz-quit-dialog-footer px-5 py-4 flex items-center justify-end gap-2">
          <button type="button" className="bndz-quit-dialog-cancel px-4 py-2 rounded-lg text-[12px] font-semibold" onClick={onCancel}>
            No, stay open
          </button>
          <button
            type="button"
            className="bndz-quit-dialog-confirm px-4 py-2 rounded-lg text-[12px] font-bold"
            onClick={() => {
              if (minimizeToTray) onMinimizeToTray(true);
              else onQuit();
            }}
          >
            Yes, {fromTray ? 'quit' : 'close'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
