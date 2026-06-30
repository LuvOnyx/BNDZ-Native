import React, { useEffect, useMemo, useRef, useState } from 'react';
import { animate } from 'animejs';
import type { LauncherCommand } from '../types';
import { openBndzPath } from '../bridge/flowBridge';
import { looksLikeWindowsPath, resolvePreviewForCommand } from '../utils/launcherPreview';

export type LauncherAction = {
  id: string;
  title: string;
  section: string;
  shortcut?: string;
  run: () => void;
};

type Props = {
  open: boolean;
  command: LauncherCommand | null;
  onClose: () => void;
  onExecute: (command: LauncherCommand, opts?: { openInBndz?: boolean }) => void;
};

const PINNED_KEY = 'bndz_launcher_pinned_commands';

function getPinnedIds(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function togglePin(commandId: string) {
  const ids = getPinnedIds();
  const next = ids.includes(commandId) ? ids.filter(id => id !== commandId) : [...ids, commandId];
  localStorage.setItem(PINNED_KEY, JSON.stringify(next));
}

function buildActions(command: LauncherCommand | null, onExecute: Props['onExecute']): LauncherAction[] {
  if (!command) return [];
  const preview = resolvePreviewForCommand(command);
  const path = command.openPath || preview.path || (looksLikeWindowsPath(command.subtitle) ? command.subtitle : null);
  const pinned = getPinnedIds().includes(command.id);
  const actions: LauncherAction[] = [
    { id: 'run', title: 'Run Command', section: 'Command', shortcut: '↵', run: () => onExecute(command) },
    {
      id: 'pin',
      title: pinned ? 'Unpin Command' : 'Pin Command',
      section: 'Command',
      run: () => togglePin(command.id),
    },
  ];

  if (path) {
    actions.push({
      id: 'bndz',
      title: 'Open in BNDZ',
      section: 'File',
      shortcut: '⌃↵',
      run: () => {
        if (command.id.startsWith('bndz-openpath-')) onExecute(command, { openInBndz: true });
        else openBndzPath(path);
      },
    });
    actions.push({
      id: 'reveal',
      title: 'Reveal in Explorer',
      section: 'File',
      run: () => {
        void import('../../lib/ipcBridge').then(({ IPC }) => {
          if (IPC.isNative) IPC.shellExecute('openExplorer', path);
        });
      },
    });
    actions.push({
      id: 'copy',
      title: 'Copy Path',
      section: 'File',
      run: () => { void navigator.clipboard.writeText(path); },
    });
  }

  if (command.subtitle && command.subtitle !== path) {
    actions.push({
      id: 'copy-sub',
      title: 'Copy Subtitle',
      section: 'Clipboard',
      run: () => { void navigator.clipboard.writeText(command.subtitle!); },
    });
  }

  return actions;
}

export default function LauncherActionsOverlay({ open, command, onClose, onExecute }: Props) {
  const actions = useMemo(() => buildActions(command, onExecute), [command, onExecute]);
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    animate(sheet, {
      opacity: [0, 1],
      translateY: [14, 0],
      scale: [0.98, 1],
      duration: 240,
      ease: 'outCubic',
    });
  }, [open, command?.id]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(a =>
      a.title.toLowerCase().includes(q) || a.section.toLowerCase().includes(q),
    );
  }, [actions, filter]);

  const sections = useMemo(() => {
    const map = new Map<string, LauncherAction[]>();
    for (const a of filtered) {
      const list = map.get(a.section) ?? [];
      list.push(a);
      map.set(a.section, list);
    }
    return [...map.entries()];
  }, [filtered]);

  const flatFiltered = useMemo(() => sections.flatMap(([, items]) => items), [sections]);

  useEffect(() => {
    if (!open) return;
    setFilter('');
    setSelectedIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, command?.id]);

  useEffect(() => {
    if (selectedIndex >= flatFiltered.length) setSelectedIndex(flatFiltered.length > 0 ? 0 : 0);
  }, [flatFiltered.length, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown' && flatFiltered.length) {
        e.preventDefault();
        setSelectedIndex(i => (i + 1) % flatFiltered.length);
      }
      if (e.key === 'ArrowUp' && flatFiltered.length) {
        e.preventDefault();
        setSelectedIndex(i => (i - 1 + flatFiltered.length) % flatFiltered.length);
      }
      if (e.key === 'Enter' && flatFiltered[selectedIndex]) {
        e.preventDefault();
        flatFiltered[selectedIndex].run();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose, flatFiltered, selectedIndex]);

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-action-selected="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, flatFiltered.length]);

  if (!open || !command) return null;

  let flatIdx = 0;

  return (
    <div className="launcher-actions-overlay launcher-actions-overlay-enter" onClick={onClose}>
      <div ref={sheetRef} className="launcher-actions-sheet" onClick={e => e.stopPropagation()}>
        <div className="px-3 py-2 border-b border-[var(--footer-border)]">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-subtle)] mb-1.5">
            Actions — {command.title}
          </div>
          <input
            ref={inputRef}
            className="bndz-search-input text-[0.9rem]"
            placeholder="Filter actions…"
            value={filter}
            onChange={e => { setFilter(e.target.value); setSelectedIndex(0); }}
          />
        </div>
        <ul ref={listRef} className="py-1 max-h-[280px] overflow-y-auto custom-scrollbar">
          {sections.length === 0 ? (
            <li className="px-3 py-4 text-center text-[var(--text-muted)] text-[12px]">No matching actions</li>
          ) : sections.map(([section, items]) => (
            <li key={section}>
              <div className="bndz-section-label">{section}</div>
              {items.map(action => {
                const idx = flatIdx++;
                const selected = idx === selectedIndex;
                return (
                  <button
                    key={action.id}
                    type="button"
                    data-action-selected={selected ? 'true' : undefined}
                    className={`launcher-actions-item w-full ${selected ? 'selected' : ''}`}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() => { action.run(); onClose(); }}
                  >
                    <span>{action.title}</span>
                    {action.shortcut ? <kbd className="bndz-kbd">{action.shortcut}</kbd> : null}
                  </button>
                );
              })}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function useLauncherActions(selected: LauncherCommand | null, onExecute: Props['onExecute']) {
  const [open, setOpen] = React.useState(false);
  const selectedAction = buildActions(selected, onExecute)[0];

  return {
    actionsOpen: open,
    setActionsOpen: setOpen,
    selectedAction,
    overlay: (
      <LauncherActionsOverlay
        open={open}
        command={selected}
        onClose={() => setOpen(false)}
        onExecute={onExecute}
      />
    ),
  };
}
