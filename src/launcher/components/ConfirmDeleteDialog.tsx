import React from 'react';

type Props = {
  title: string;
  target?: string;
  message?: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Raycast-style confirm dialog (SuperCmd ConfirmDeleteDialog pattern). */
export default function ConfirmDeleteDialog({ title, target, message, confirmLabel, onConfirm, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-[100000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-[340px] mx-4 glass-effect p-4 flex flex-col gap-3">
        <div className="text-[15px] font-semibold text-[var(--text-primary)]">{title}</div>
        {target ? (
          <div className="text-[13px] text-[var(--text-muted)] truncate">"{target}"</div>
        ) : null}
        {message ? <div className="text-[12px] text-[var(--text-muted)] leading-relaxed">{message}</div> : null}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="bndz-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="bndz-btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
