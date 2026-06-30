import React from 'react';
import type { LauncherCommand } from '../types';
import type { CalcResult } from '../smart-calculator';
import LauncherCalculatorCard from './LauncherCalculatorCard';
import LauncherCommandRow from './LauncherCommandRow';

type Section = { title: string; items: LauncherCommand[] };

type Props = {
  sections: Section[];
  flatCommands: LauncherCommand[];
  selectedIndex: number;
  itemRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  onSelect: (index: number, command: LauncherCommand) => void;
  onExecute: (command: LauncherCommand) => void;
  calcResult?: CalcResult | null;
  onCalculatorCopy?: () => void;
};

/** Ported from SuperCmd LauncherCommandList.tsx */
export default function LauncherCommandList({
  sections,
  flatCommands,
  selectedIndex,
  itemRefs,
  onSelect,
  onExecute,
  calcResult,
  onCalculatorCopy,
}: Props) {
  let flat = calcResult ? 1 : 0;
  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-1.5 min-h-0">
      {calcResult && (
        <LauncherCalculatorCard
          result={calcResult}
          selected={selectedIndex === 0}
          itemRef={el => { itemRefs.current[0] = el; }}
          onCopy={() => onCalculatorCopy?.()}
        />
      )}
      {sections.map(section => (
        <div key={section.title}>
          <div className="bndz-section-label">{section.title}</div>
          {section.items.map(cmd => {
            const idx = flat++;
            const absoluteIndex = idx;
            return (
              <LauncherCommandRow
                key={cmd.id}
                command={cmd}
                selected={selectedIndex === absoluteIndex}
                itemRef={el => { itemRefs.current[absoluteIndex] = el; }}
                onClick={() => onSelect(absoluteIndex, cmd)}
                onDoubleClick={() => onExecute(cmd)}
              />
            );
          })}
        </div>
      ))}
      {flatCommands.length === 0 && !calcResult && (
        <div className="px-6 py-10 text-center">
          <div className="text-[var(--text-muted)] text-sm font-medium">No matching commands</div>
          <div className="text-[var(--text-subtle)] text-xs mt-2 leading-relaxed">
            Try a different query, or type <span className="bndz-kbd">?</span> for help
          </div>
        </div>
      )}
    </div>
  );
}
