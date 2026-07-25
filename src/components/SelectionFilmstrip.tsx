import React from 'react';
import { ShellNativeIcon } from './ShellNativeIcon';

type Props = {
  paths: string[];
  activePath?: string | null;
  onSelect?: (path: string) => void;
};

/** Multi-select filmstrip under preview — CAS thumbs, soft squircles. */
export function SelectionFilmstrip({ paths, activePath, onSelect }: Props) {
  if (!paths.length) return null;
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 overflow-x-auto bndz-scrollbar border-t border-white/[0.06] bg-[#1a1a1e]/80">
      {paths.slice(0, 48).map(p => {
        const name = p.split(/[/\\]/).pop() || p;
        const active = activePath && p.replace(/\\/g, '/').toLowerCase() === activePath.replace(/\\/g, '/').toLowerCase();
        return (
          <button
            key={p}
            type="button"
            title={p}
            onClick={() => onSelect?.(p)}
            className={`shrink-0 w-12 h-12 rounded-[10px] overflow-hidden flex items-center justify-center bg-black/30 ring-1 transition-shadow ${
              active ? 'ring-[#0078d4] shadow-[0_0_0_1px_rgba(0,120,212,0.35)]' : 'ring-white/10 hover:ring-white/25'
            }`}
          >
            <ShellNativeIcon path={p} size={40} preferThumbnail eager />
            <span className="sr-only">{name}</span>
          </button>
        );
      })}
      {paths.length > 48 && (
        <span className="text-[10px] text-gray-500 shrink-0 px-1">+{paths.length - 48}</span>
      )}
    </div>
  );
}
