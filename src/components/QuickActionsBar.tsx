import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Copy, Scissors, Clipboard, Trash2, Terminal, FolderOpen,
  Replace, Info, Link2, Eye,
} from 'lucide-react';

export type QuickAction = {
  id: string;
  label: string;
  icon: React.ElementType;
  onClick: () => void;
  disabled?: boolean;
  accent?: 'sky' | 'amber' | 'rose' | 'emerald';
};

type Props = {
  count: number;
  actions: QuickAction[];
  /** When false, bar stays hidden even if count > 0 (e.g. during double-click window). */
  visible?: boolean;
  /** dock = below omnibar in layout flow; float = bottom of file list; overlay = legacy top float */
  placement?: 'dock' | 'float' | 'overlay';
};

const accentClass: Record<string, string> = {
  sky: 'hover:bg-sky-500/15 hover:text-sky-300 hover:border-sky-500/30',
  amber: 'hover:bg-amber-500/15 hover:text-amber-300 hover:border-amber-500/30',
  rose: 'hover:bg-rose-500/15 hover:text-rose-300 hover:border-rose-500/30',
  emerald: 'hover:bg-emerald-500/15 hover:text-emerald-300 hover:border-emerald-500/30',
};

/** FilePilot / XYplorer-style selection action strip */
export default function QuickActionsBar({ count, actions, visible = true, placement = 'dock' }: Props) {
  const show = visible && count > 0;
  const isFloat = placement === 'float';
  const isOverlay = placement === 'overlay';

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key="quick-actions"
          initial={{ opacity: 0, y: isFloat || isOverlay ? 8 : -4, height: placement === 'dock' ? 0 : undefined }}
          animate={{ opacity: 1, y: 0, height: placement === 'dock' ? 'auto' : undefined }}
          exit={{ opacity: 0, y: isFloat || isOverlay ? 6 : -2, height: placement === 'dock' ? 0 : undefined }}
          transition={{ type: 'spring', stiffness: 480, damping: 34, mass: 0.75 }}
          className={
            isFloat
              ? 'absolute bottom-2 left-2 right-2 z-30 pointer-events-none bndz-quick-actions-bar'
              : isOverlay
                ? 'absolute top-0 left-0 right-0 z-40 pointer-events-none bndz-quick-actions-bar'
                : 'shrink-0 overflow-hidden border-t border-sky-500/15 bndz-quick-actions-bar'
          }
        >
          <div className={`pointer-events-auto bg-gradient-to-r from-[#1a2a42]/97 via-[#162035]/97 to-[#141820]/97 backdrop-blur-md ${
            placement === 'dock'
              ? 'border-b border-sky-500/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-md'
              : 'rounded-2xl border border-sky-500/20 shadow-[0_8px_28px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.06)] mx-2 my-1.5 backdrop-blur-md'
          }`}>
            <div className="flex items-center gap-1.5 px-2 py-1.5 overflow-x-auto scrollbar-hidden">
              <span className="text-[10px] font-bold uppercase tracking-wider text-sky-300/95 shrink-0 mr-1">
                {count} selected
              </span>
              <div className="h-4 w-px bg-sky-500/25 shrink-0" />
              {actions.map(a => {
                const Icon = a.icon;
                return (
                  <button
                    key={a.id}
                    type="button"
                    disabled={a.disabled}
                    title={a.label}
                    onClick={a.onClick}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium text-gray-400 border border-transparent transition-all disabled:opacity-30 disabled:pointer-events-none ${accentClass[a.accent || 'sky']}`}
                  >
                    <Icon size={13} />
                    <span className="hidden sm:inline">{a.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function buildDefaultQuickActions(handlers: {
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onCopyPath: () => void;
  onOpenTerminal: () => void;
  onOpenExplorer: () => void;
  onProperties: () => void;
  onBatchRename: () => void;
  onQuickLook: () => void;
  canPaste: boolean;
}): QuickAction[] {
  return [
    { id: 'quicklook', label: 'Quick Look', icon: Eye, onClick: handlers.onQuickLook, accent: 'sky' },
    { id: 'copy', label: 'Copy', icon: Copy, onClick: handlers.onCopy },
    { id: 'cut', label: 'Cut', icon: Scissors, onClick: handlers.onCut },
    { id: 'paste', label: 'Paste', icon: Clipboard, onClick: handlers.onPaste, disabled: !handlers.canPaste },
    { id: 'path', label: 'Copy Path', icon: Link2, onClick: handlers.onCopyPath },
    { id: 'rename', label: 'Batch Rename', icon: Replace, onClick: handlers.onBatchRename, accent: 'emerald' },
    { id: 'terminal', label: 'Terminal', icon: Terminal, onClick: handlers.onOpenTerminal },
    { id: 'explorer', label: 'Explorer', icon: FolderOpen, onClick: handlers.onOpenExplorer },
    { id: 'properties', label: 'Properties', icon: Info, onClick: handlers.onProperties },
    { id: 'delete', label: 'Delete', icon: Trash2, onClick: handlers.onDelete, accent: 'rose' },
  ];
}
