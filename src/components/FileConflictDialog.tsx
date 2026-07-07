import React, { useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { ShellNativeIcon } from './ShellNativeIcon';

export type FileConflictDialogProps = {
  fileName: string;
  destPath?: string;
  onReplace: (applyToAll: boolean) => void;
  onKeepBoth: (applyToAll: boolean) => void;
  onSkip: (applyToAll: boolean) => void;
  onClose: () => void;
};

export default function FileConflictDialog({
  fileName,
  destPath,
  onReplace,
  onKeepBoth,
  onSkip,
  onClose,
}: FileConflictDialogProps) {
  const [applyToAll, setApplyToAll] = useState(false);
  const destFolder = destPath?.replace(/[/\\][^/\\]+$/, '').replace(/[/\\]+$/, '') || 'destination folder';

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" />
      <div
        className="relative w-full max-w-[480px] rounded-[var(--bndz-radius-lg)] border border-white/10 shadow-2xl overflow-hidden bg-[#16181f]"
        role="dialog"
        aria-modal="true"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-5 py-4 border-b border-white/[0.08] bg-[#1a1d26]">
          <div className="w-9 h-9 rounded-[var(--bndz-radius-md)] bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0">
            <Icons8Icon id="warning" size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[14px] font-semibold text-white">File already exists</h2>
            <p className="text-[11px] text-white/45 mt-0.5">Choose what to do with this file.</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-[var(--bndz-radius-sm)] text-white/45 hover:text-white hover:bg-white/10" aria-label="Close">
            <Icons8Icon id="close" size={14} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-2.5 rounded-[var(--bndz-radius-md)] border border-white/[0.08] bg-black/25 px-3 py-2.5">
            <ShellNativeIcon path={destPath || fileName} size={22} eager />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-white/90 truncate">{fileName}</div>
              <div className="text-[10px] text-white/40 truncate">{destFolder}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-1.5">
            <button
              type="button"
              className="w-full flex items-center gap-2.5 text-left px-3 py-2 rounded-[var(--bndz-radius-md)] border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/18 text-[12px] font-medium text-sky-100 transition-colors"
              onClick={() => onReplace(applyToAll)}
            >
              <Icons8Icon id="check" size={14} />
              Replace the file in the destination
            </button>
            <button
              type="button"
              className="w-full flex items-center gap-2.5 text-left px-3 py-2 rounded-[var(--bndz-radius-md)] border border-white/10 bg-white/[0.04] hover:bg-white/[0.07] text-[12px] font-medium text-white/90 transition-colors"
              onClick={() => onKeepBoth(applyToAll)}
            >
              <Icons8Icon id="copy" size={14} />
              Keep both <span className="text-white/40">(rename the new copy)</span>
            </button>
            <button
              type="button"
              className="w-full flex items-center gap-2.5 text-left px-3 py-2 rounded-[var(--bndz-radius-md)] border border-white/10 bg-transparent hover:bg-white/[0.04] text-[12px] font-medium text-white/65 transition-colors"
              onClick={() => onSkip(applyToAll)}
            >
              <Icons8Icon id="close" size={14} />
              Skip this file
            </button>
          </div>

          <label className="flex items-center gap-2 pt-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={e => setApplyToAll(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-white/20 bg-black/30 accent-sky-500"
            />
            <span className="text-[11px] text-white/55">Do this for the remaining conflicts in this operation</span>
          </label>
        </div>
      </div>
    </div>
  );
}
