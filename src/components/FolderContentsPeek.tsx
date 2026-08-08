import React from 'react';
import ClampedFixedMenu from './ClampedFixedMenu';

export type FolderContentsPeekEntry = {
  name: string;
  isDir: boolean;
};

export type FolderContentsPeekState = {
  x: number;
  y: number;
  path: string;
  name: string;
  entries: FolderContentsPeekEntry[];
};

type Props = {
  peek: FolderContentsPeekState;
  onClose: () => void;
  onOpen: (path: string) => void;
};

/** Lightweight folder-contents blow-up (Settings → Mouse Up on Folder Icons). */
export default function FolderContentsPeek({ peek, onClose, onOpen }: Props) {
  return (
    <ClampedFixedMenu
      x={peek.x}
      y={peek.y}
      className="z-[99980] min-w-[220px] max-w-[320px] max-h-[280px] overflow-hidden rounded-xl border border-white/12 bg-[#161a22]/96 shadow-[0_18px_48px_rgba(0,0,0,0.55)] backdrop-blur-md"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/8 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold text-[#f2f4f8]">{peek.name}</div>
          <div className="truncate text-[10px] text-[#8b93a7]">{peek.path}</div>
        </div>
        <button
          type="button"
          className="rounded-md px-1.5 py-0.5 text-[11px] text-[#9aa3b5] hover:bg-white/8 hover:text-white"
          onClick={onClose}
        >
          Esc
        </button>
      </div>
      <div className="max-h-[220px] overflow-y-auto py-1">
        {peek.entries.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-[#8b93a7]">Empty folder</div>
        ) : (
          peek.entries.map((ent) => (
            <button
              key={`${ent.isDir ? 'd' : 'f'}:${ent.name}`}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1 text-left text-[11px] text-[#e8ecf4] hover:bg-[#2a3344]"
              onClick={() => {
                const child = peek.path.replace(/[/\\]+$/, '') + '\\' + ent.name;
                onOpen(child);
              }}
            >
              <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${ent.isDir ? 'bg-sky-400' : 'bg-zinc-500'}`} />
              <span className="truncate">{ent.name}{ent.isDir ? '\\' : ''}</span>
            </button>
          ))
        )}
      </div>
      <div className="border-t border-white/8 px-3 py-1.5 text-[10px] text-[#7d8699]">
        {peek.entries.length} item{peek.entries.length === 1 ? '' : 's'}
      </div>
    </ClampedFixedMenu>
  );
}
