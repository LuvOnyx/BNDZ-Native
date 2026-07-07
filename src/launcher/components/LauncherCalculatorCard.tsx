import React from 'react';
import { Icons8Icon } from '../../components/Icons8Icon';
import type { CalcResult } from '../smart-calculator';

type Props = {
  result: CalcResult;
  selected?: boolean;
  itemRef?: (el: HTMLDivElement | null) => void;
  onCopy: () => void;
};

export default function LauncherCalculatorCard({ result, selected, itemRef, onCopy }: Props) {
  return (
    <div
      ref={itemRef}
      className={`mx-1 mb-1 rounded-lg border px-3 py-2.5 flex items-center justify-between gap-3 transition-colors ${
        selected
          ? 'bg-[var(--accent-soft)] border-[var(--accent)]'
          : 'bg-[var(--surface-elevated)] border-[var(--border-subtle)]'
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <Icons8Icon id="calculator" size={18} className="shrink-0" />
        <div className="min-w-0">
          <div className="text-[11px] text-[var(--text-muted)] font-mono truncate">{result.expression}</div>
          <div className="text-lg font-semibold text-[var(--text-primary)] tabular-nums">{result.formatted}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onCopy(); }}
        className="shrink-0 p-1.5 rounded-md hover:bg-white/10 text-[var(--text-muted)]"
        title="Copy result"
      >
        <Icons8Icon id="copy" size={14} />
      </button>
    </div>
  );
}
