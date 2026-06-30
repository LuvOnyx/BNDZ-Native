import React from 'react';
import type { LauncherCommand } from '../types';
import LauncherCommandIcon from './LauncherCommandIcon';
import { openBndzPath } from '../bridge/flowBridge';

type Props = {
  command: LauncherCommand | null;
  onExecute: (command: LauncherCommand, opts?: { openInBndz?: boolean }) => void;
  onOpenManager?: (command: LauncherCommand) => void;
};

function canOpenInBndz(cmd: LauncherCommand): boolean {
  return cmd.id.startsWith('bndz-openpath-')
    || cmd.category === 'file'
    || cmd.category === 'bndz'
    || !!cmd.openPath;
}

export default function LauncherDetailPanel({ command, onExecute, onOpenManager }: Props) {
  if (!command) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6 text-[var(--text-muted)]">
        <div className="text-4xl mb-3 opacity-40">⌘</div>
        <div className="text-[14px] font-medium text-[var(--text-secondary)]">BNDZ Launcher Hub</div>
        <p className="text-[12px] mt-2 leading-relaxed max-w-[280px]">
          Select a command to preview details. Press Enter to run, Ctrl+Enter to open in BNDZ File Manager.
        </p>
      </div>
    );
  }

  const canOpenManager =
    command.id === 'system-search-notes'
    || command.id === 'system-search-snippets'
    || command.id === 'system-search-quicklinks'
    || command.id === 'system-clipboard-manager'
    || command.id === 'system-open-extensions';

  const showBndz = canOpenInBndz(command);
  const bndzPath = command.openPath || command.subtitle;

  return (
    <div className="h-full flex flex-col min-h-0 p-4">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-[var(--command-item-selected-bg)] flex items-center justify-center text-xl shrink-0">
          <LauncherCommandIcon command={command} size={28} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold text-[var(--text-primary)] leading-tight">{command.title}</div>
          {command.subtitle ? (
            <div className="text-[12px] text-[var(--text-muted)] mt-1 break-all">{command.subtitle}</div>
          ) : null}
          {command.category ? (
            <span className="inline-block mt-2 bndz-chip capitalize">{command.category}</span>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar rounded-lg border border-[var(--footer-border)] bg-black/10 p-3 min-h-0">
        <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
          {command.detail || command.subtitle || 'Run this command from the launcher.'}
        </p>
      </div>

      <div className="pt-3 flex gap-2 shrink-0 flex-wrap">
        <button type="button" className="bndz-btn-primary flex-1 min-w-[80px]" onClick={() => onExecute(command)}>
          Run
        </button>
        {showBndz && bndzPath && (
          <button
            type="button"
            className="bndz-btn-ghost flex-1 min-w-[80px]"
            onClick={() => {
              if (command.id.startsWith('bndz-openpath-')) {
                void onExecute(command, { openInBndz: true });
              } else {
                openBndzPath(bndzPath);
              }
            }}
          >
            Open in BNDZ
          </button>
        )}
        {canOpenManager && onOpenManager ? (
          <button type="button" className="bndz-btn-ghost" onClick={() => onOpenManager(command)}>
            Open App
          </button>
        ) : null}
      </div>
      <div className="text-[10px] text-[var(--text-muted)] mt-2 text-center">Enter · Ctrl+Enter BNDZ · Esc hide</div>
    </div>
  );
}
