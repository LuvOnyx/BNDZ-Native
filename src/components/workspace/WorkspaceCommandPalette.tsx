import React, { useEffect, useMemo, useState } from 'react';

export type PaletteCommand = {
  id: string;
  label: string;
  group: string;
  shortcut?: string;
  onRun: () => void;
};

type Props = {
  open: boolean;
  commands: PaletteCommand[];
  onClose: () => void;
};

export default function WorkspaceCommandPalette({ open, commands, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [idx, setIdx] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(c =>
      c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q),
    );
  }, [commands, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setIdx(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, filtered.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
      if (e.key === 'Enter' && filtered[idx]) {
        e.preventDefault();
        filtered[idx].onRun();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, idx, onClose]);

  if (!open) return null;

  return (
    <div className="bndz-ws-palette-backdrop" role="presentation" onClick={onClose}>
      <div
        className="bndz-ws-palette"
        role="dialog"
        aria-label="Workspace commands"
        onClick={e => e.stopPropagation()}
      >
        <input
          className="bndz-ws-palette-input"
          autoFocus
          placeholder="Type a command…"
          value={query}
          onChange={e => { setQuery(e.target.value); setIdx(0); }}
        />
        <ul className="bndz-ws-palette-list" role="listbox">
          {filtered.map((cmd, i) => (
            <li key={cmd.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === idx}
                className={`bndz-ws-palette-item${i === idx ? ' is-active' : ''}`}
                onClick={() => { cmd.onRun(); onClose(); }}
              >
                <span className="bndz-ws-palette-label">{cmd.label}</span>
                <span className="bndz-ws-palette-group">{cmd.group}</span>
                {cmd.shortcut ? <kbd className="bndz-ws-palette-kbd">{cmd.shortcut}</kbd> : null}
              </button>
            </li>
          ))}
          {!filtered.length && <li className="bndz-ws-palette-empty">No matching commands</li>}
        </ul>
      </div>
    </div>
  );
}
