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
};

const accentClass: Record<string, string> = {
  sky: 'hover:bg-sky-500/15 hover:text-sky-300 hover:border-sky-500/30',
  amber: 'hover:bg-amber-500/15 hover:text-amber-300 hover:border-amber-500/30',
  rose: 'hover:bg-rose-500/15 hover:text-rose-300 hover:border-rose-500/30',
  emerald: 'hover:bg-emerald-500/15 hover:text-emerald-300 hover:border-emerald-500/30',
};

/** FilePilot / XYplorer-style selection action strip — fast access without opening context menu */
export default function QuickActionsBar({ count, actions }: Props) {
  return (
    <AnimatePresence initial={false}>
      {count > 0 && (
        <motion.div
          key="quick-actions"
          initial={{ height: 0, opacity: 0, y: -6 }}
          animate={{ height: 'auto', opacity: 1, y: 0 }}
          exit={{ height: 0, opacity: 0, y: -4 }}
          transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.85 }}
          className="shrink-0 overflow-hidden border-b border-sky-500/20 bg-gradient-to-r from-[#1a2a42]/95 via-[#162035]/95 to-[#141820]/95 backdrop-blur-sm"
        >
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
