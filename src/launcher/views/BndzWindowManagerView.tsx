import React from 'react';
import { ArrowLeft, LayoutGrid } from 'lucide-react';

const TILES = [
  { id: 'system-window-management-left', label: 'Left Half', hint: 'Snap left' },
  { id: 'system-window-management-right', label: 'Right Half', hint: 'Snap right' },
  { id: 'system-window-management-top', label: 'Top Half', hint: 'Snap top' },
  { id: 'system-window-management-bottom', label: 'Bottom Half', hint: 'Snap bottom' },
  { id: 'system-window-management-top-left', label: 'Top Left', hint: 'Quarter' },
  { id: 'system-window-management-top-right', label: 'Top Right', hint: 'Quarter' },
  { id: 'system-window-management-bottom-left', label: 'Bottom Left', hint: 'Quarter' },
  { id: 'system-window-management-bottom-right', label: 'Bottom Right', hint: 'Quarter' },
  { id: 'system-window-management-center', label: 'Center', hint: 'Center window' },
  { id: 'system-window-management-fill', label: 'Maximize', hint: 'Fill screen' },
  { id: 'system-window-management-center-80', label: 'Almost Max', hint: '80% area' },
  { id: 'system-window-management-maximize-width', label: 'Max Width', hint: 'Full width' },
];

type Props = { onClose: () => void };

export default function BndzWindowManagerView({ onClose }: Props) {
  const run = (id: string) => {
    void import('../bridge/flowBridge').then(m => m.executeCommand({ id, title: id, category: 'system' }));
  };

  return (
    <div className="glass-effect h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--footer-border)]">
        <button type="button" className="bndz-icon-btn" onClick={onClose} title="Back"><ArrowLeft size={14} /></button>
        <LayoutGrid size={16} className="text-[var(--text-muted)]" />
        <span className="text-[14px] font-medium">Window Management</span>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        <p className="text-[12px] text-[var(--text-muted)] mb-4">Snap and resize the foreground window — SuperCmd / Raycast style tiling.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {TILES.map(t => (
            <button
              key={t.id}
              type="button"
              className="command-item px-3 py-3 rounded-lg text-left hover:selected"
              onClick={() => run(t.id)}
            >
              <div className="text-[13px] font-medium text-[var(--text-primary)]">{t.label}</div>
              <div className="text-[11px] text-[var(--text-muted)]">{t.hint}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
