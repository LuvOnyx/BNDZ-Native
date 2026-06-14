import React from 'react';
import type { LauncherCommand } from '../types';
import LauncherCommandRow from './LauncherCommandRow';

type Section = { title: string; items: LauncherCommand[] };

type Props = {
  sections: Section[];
  flatCommands: LauncherCommand[];
  selectedIndex: number;
  itemRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  onSelect: (index: number, command: LauncherCommand) => void;
  onExecute: (command: LauncherCommand) => void;
};

/** Ported from SuperCmd LauncherCommandList.tsx */
export default function LauncherCommandList({
  sections,
  flatCommands,
  selectedIndex,
  itemRefs,
  onSelect,
  onExecute,
}: Props) {
  let flat = 0;
  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-1.5 min-h-0">
      {sections.map(section => (
        <div key={section.title}>
          <div className="bndz-section-label">{section.title}</div>
          {section.items.map(cmd => {
            const idx = flat++;
            return (
              <LauncherCommandRow
                key={cmd.id}
                command={cmd}
                selected={selectedIndex === idx}
                itemRef={el => { itemRefs.current[idx] = el; }}
                onClick={() => {
                  onSelect(idx, cmd);
                  onExecute(cmd);
                }}
              />
            );
          })}
        </div>
      ))}
      {flatCommands.length === 0 && (
        <div className="px-3 py-8 text-center text-[var(--text-muted)] text-sm">No matching commands</div>
      )}
    </div>
  );
}
