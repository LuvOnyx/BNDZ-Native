import React, { useEffect, useRef } from 'react';
import { Icons8Icon } from './Icons8Icon';
import type { RapidAccessItem } from '../lib/rapidAccessDefaults';
import { formatUiPath } from '../lib/displayPath';

type Props = {
  open: boolean;
  items: RapidAccessItem[];
  onClose: () => void;
  onNavigate: (path: string) => void;
};

export default function RapidAccessPopup({ open, items, onClose, onNavigate }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onPointer = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointer);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[12000] flex items-start justify-center pt-[12vh] bg-black/45 backdrop-blur-[2px]">
      <div
        ref={panelRef}
        className="bndz-rapid-access-popup w-[min(420px,92vw)] max-h-[min(520px,70vh)] flex flex-col border border-[#3a3a3a] bg-[#141418] shadow-[0_24px_64px_rgba(0,0,0,0.55)] rounded-md overflow-hidden"
        role="dialog"
        aria-label="Rapid access"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2e2e2e] bg-[#1a1a1f]">
          <div className="flex items-center gap-2">
            <Icons8Icon id="zap_ui" size={16} />
            <span className="text-[13px] font-semibold text-white tracking-wide">Rapid access</span>
          </div>
          <button
            type="button"
            className="text-gray-400 hover:text-white text-[11px] px-2 py-1 rounded hover:bg-white/10"
            onClick={onClose}
          >
            Esc
          </button>
        </div>
        <div className="overflow-y-auto styled-scrollbar flex-1 p-2">
          {items.length === 0 ? (
            <p className="text-[12px] text-gray-500 px-3 py-6 text-center">
              Pin folders from the sidebar or add the current folder from the Rapid access menu.
            </p>
          ) : (
            <ul className="space-y-[2px]">
              {items.map(item => (
                <li key={item.path}>
                  <button
                    type="button"
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded text-left hover:bg-[#0078d4]/20 hover:text-white text-gray-200 transition-colors"
                    onClick={() => {
                      onNavigate(item.path);
                      onClose();
                    }}
                  >
                    <Icons8Icon id="folder" size={14} className="shrink-0 opacity-90" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-medium truncate">{item.name}</span>
                      <span className="block text-[10px] text-gray-500 truncate font-mono">{formatUiPath(item.path)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
