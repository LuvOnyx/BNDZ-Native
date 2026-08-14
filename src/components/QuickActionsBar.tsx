import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icons8Icon } from './Icons8Icon';

export type QuickAction = {
  id: string;
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: 'sky' | 'amber' | 'rose' | 'emerald';
};

type Props = {
  count: number;
  actions: QuickAction[];
  /** Master settings toggle — when false, bar never renders. */
  enabled?: boolean;
  /** When false, bar stays hidden even if count > 0 (e.g. during double-click window). */
  visible?: boolean;
  placement?: 'dock';
};

const accentClass: Record<string, string> = {
  sky: 'hover:bg-[#094771]/40 hover:text-[#cce4f7] hover:border-[#0078d4]/35',
  amber: 'hover:bg-amber-500/15 hover:text-amber-300 hover:border-amber-500/30',
  rose: 'hover:bg-rose-500/15 hover:text-rose-300 hover:border-rose-500/30',
  emerald: 'hover:bg-emerald-500/15 hover:text-emerald-300 hover:border-emerald-500/30',
};

/** FilePilot / XYplorer-style selection action strip (docked below omnibar). */
export default function QuickActionsBar({
  count,
  actions,
  enabled = true,
  visible = true,
  placement = 'dock',
}: Props) {
  if (!enabled) return null;
  const show = visible && count > 1;

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key="quick-actions"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -2 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className="shrink-0 overflow-hidden border-b border-[#454545] bndz-quick-actions-bar"
        >
          <div className="pointer-events-auto bg-[#2b2b2b] border-b border-[#454545]">
            <div className="flex items-center gap-1.5 px-2 py-1.5 overflow-x-auto scrollbar-hidden">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#cce4f7] shrink-0 mr-1">
                {count} selected
              </span>
              <div className="h-4 w-px bg-[#555] shrink-0" />
              {(actions || []).map((a, i) => (
                <motion.button
                  key={a.id}
                  type="button"
                  disabled={a.disabled}
                  title={a.label}
                  onClick={a.onClick}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.028, duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-[var(--bndz-radius-sm)] text-[11px] font-medium text-gray-400 border border-transparent transition-all disabled:opacity-30 disabled:pointer-events-none ${accentClass[a.accent || 'sky']}`}
                >
                  <Icons8Icon id={a.icon} size={13} disabled={a.disabled} />
                  <span className="hidden sm:inline">{a.label}</span>
                </motion.button>
              ))}
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
  onMeshDrop?: () => void;
  onRamStaging?: () => void;
  onGhostLink?: () => void;
  onTag?: () => void;
  onCompare?: () => void;
  canPaste: boolean;
}): QuickAction[] {
  const extra: QuickAction[] = [];
  if (handlers.onMeshDrop) extra.push({ id: 'meshdrop', label: 'Mesh Drop', icon: 'emblem-shared', onClick: handlers.onMeshDrop, accent: 'sky' });
  if (handlers.onRamStaging) extra.push({ id: 'ram', label: 'RAM Stage', icon: 'hard_drive_ui', onClick: handlers.onRamStaging, accent: 'amber' });
  if (handlers.onGhostLink) extra.push({ id: 'ghost', label: 'Ghost-Link', icon: 'emblem-symbolic-link', onClick: handlers.onGhostLink });
  if (handlers.onTag) extra.push({ id: 'tag', label: 'Tag', icon: 'tag_manager', onClick: handlers.onTag, accent: 'emerald' });
  if (handlers.onCompare) extra.push({ id: 'compare', label: 'Compare', icon: 'compare', onClick: handlers.onCompare });

  return [
    { id: 'quicklook', label: 'Quick Look', icon: 'toggle_preview', onClick: handlers.onQuickLook, accent: 'sky' },
    { id: 'copy', label: 'Copy', icon: 'copy', onClick: handlers.onCopy },
    { id: 'cut', label: 'Cut', icon: 'cut', onClick: handlers.onCut },
    { id: 'paste', label: 'Paste', icon: 'paste', onClick: handlers.onPaste, disabled: !handlers.canPaste },
    { id: 'path', label: 'Copy Path', icon: 'copy_path', onClick: handlers.onCopyPath },
    { id: 'rename', label: 'Batch Rename', icon: 'batch_rename', onClick: handlers.onBatchRename, accent: 'emerald' },
    ...extra,
    { id: 'terminal', label: 'Terminal', icon: 'terminal', onClick: handlers.onOpenTerminal },
    { id: 'explorer', label: 'Explorer', icon: 'explorer', onClick: handlers.onOpenExplorer },
    { id: 'properties', label: 'Properties', icon: 'sys_properties', onClick: handlers.onProperties },
    { id: 'delete', label: 'Delete', icon: 'delete', onClick: handlers.onDelete, accent: 'rose' },
  ];
}
