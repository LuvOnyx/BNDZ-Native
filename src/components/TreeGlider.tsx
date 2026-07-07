import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icons8Icon } from './Icons8Icon';

export type TreeGliderAnchor = {
  path: string;
  top: number;
  left: number;
  height: number;
};

type Props = {
  anchor: TreeGliderAnchor | null;
  canPaste: boolean;
  onCopy: (path: string) => void;
  onMove: (path: string) => void;
  onPaste: (path: string) => void;
  onDismiss: () => void;
};

/** XYplorer-style floating tree mini-toolbar — copy, move, paste on folder hover. */
export default function TreeGlider({ anchor, canPaste, onCopy, onMove, onPaste, onDismiss }: Props) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!anchor) return;
    const onDocDown = (e: MouseEvent) => {
      if (barRef.current?.contains(e.target as Node)) return;
      onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchor, onDismiss]);

  if (!anchor || typeof document === 'undefined') return null;

  const top = Math.max(4, anchor.top + (anchor.height - 24) / 2);
  const left = anchor.left + 8;

  return createPortal(
    <div
      ref={barRef}
      className="tree-glider fixed z-[9999] flex items-center gap-0.5 px-1 py-0.5 rounded-md border border-sky-500/40 bg-[#1a1f2e]/95 shadow-lg shadow-black/40 backdrop-blur-sm"
      style={{ top, left }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <button
        type="button"
        title="Copy to glider clipboard"
        className="tree-glider-btn p-1 rounded hover:bg-sky-500/20 text-sky-300"
        onClick={() => { onCopy(anchor.path); onDismiss(); }}
      >
        <Icons8Icon id="copy" size={13} />
      </button>
      <button
        type="button"
        title="Cut (move) to glider clipboard"
        className="tree-glider-btn p-1 rounded hover:bg-amber-500/20 text-amber-300"
        onClick={() => { onMove(anchor.path); onDismiss(); }}
      >
        <Icons8Icon id="cut" size={13} />
      </button>
      <button
        type="button"
        title="Paste into this folder"
        disabled={!canPaste}
        className={`tree-glider-btn p-1 rounded ${canPaste ? 'hover:bg-emerald-500/20 text-emerald-300' : 'opacity-30 cursor-not-allowed text-gray-500'}`}
        onClick={() => { if (canPaste) { onPaste(anchor.path); onDismiss(); } }}
      >
        <Icons8Icon id="paste" size={13} />
      </button>
    </div>,
    document.body,
  );
}
