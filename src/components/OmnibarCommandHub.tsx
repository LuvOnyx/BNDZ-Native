import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import type { RapidAccessItem } from '../lib/rapidAccessDefaults';
import type { NavVisit } from '../lib/navigationHistory';
import { formatUiPath } from '../lib/displayPath';
import { OMNIBAR_COMMANDS } from '../lib/omnibarCommands';

type Props = {
  open: boolean;
  places: RapidAccessItem[];
  recent?: NavVisit[];
  onClose: () => void;
  onNavigate: (path: string) => void;
  onRunCommand: (commandLine: string) => void;
  onInsert?: (text: string) => void;
};

type Row =
  | { key: string; kind: 'place'; path: string; name: string; sub: string }
  | { key: string; kind: 'recent'; path: string; name: string; sub: string }
  | { key: string; kind: 'command'; insert: string; name: string; sub: string; icon?: string };

/**
 * Omnibar Command Hub — double-click the fuzzy bar for places + commands.
 * Instrument plaque craft (not SaaS modal).
 */
export default function OmnibarCommandHub({
  open,
  places,
  recent = [],
  onClose,
  onNavigate,
  onRunCommand,
  onInsert,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  const rows = useMemo((): Row[] => {
    const q = query.trim().toLowerCase();
    const hit = (a: string, b: string) => !q || a.toLowerCase().includes(q) || b.toLowerCase().includes(q);

    const placeRows: Row[] = places
      .filter(p => hit(p.name, p.path))
      .slice(0, 10)
      .map(p => ({
        key: `p:${p.path}`,
        kind: 'place' as const,
        path: p.path,
        name: p.name,
        sub: formatUiPath(p.path),
      }));

    const recentRows: Row[] = recent
      .filter(v => hit(v.label, v.path))
      .slice(0, 6)
      .map(v => ({
        key: `r:${v.path}`,
        kind: 'recent' as const,
        path: v.path,
        name: v.label,
        sub: formatUiPath(v.path),
      }));

    const cmdRows: Row[] = OMNIBAR_COMMANDS
      .filter(c => hit(c.label, c.name) || hit(c.hint, c.name))
      .map(c => ({
        key: `c:${c.id}`,
        kind: 'command' as const,
        insert: `>${c.name}`,
        name: c.label,
        sub: `>${c.name} — ${c.hint}`,
        icon: c.icon,
      }));

    if (q.startsWith('>') || q.startsWith('::')) {
      return [...cmdRows, ...placeRows, ...recentRows];
    }
    if (q.includes(':') || q.includes('\\') || q.includes('/') || q.startsWith('%')) {
      return [...placeRows, ...recentRows, ...cmdRows];
    }
    return [...placeRows, ...recentRows, ...cmdRows];
  }, [places, recent, query]);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(i => (rows.length ? (i + 1) % rows.length : 0));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(i => (rows.length ? (i - 1 + rows.length) % rows.length : 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const row = rows[active];
        if (row) activate(row);
        else if (query.trim()) {
          if (query.trimStart().startsWith('>')) onRunCommand(query.trim());
          else onNavigate(query.trim());
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, rows, active, query, onClose, onNavigate, onRunCommand]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onPointer);
    return () => window.removeEventListener('mousedown', onPointer);
  }, [open, onClose]);

  const activate = (row: Row) => {
    if (row.kind === 'command') {
      onRunCommand(row.insert);
    } else {
      onNavigate(row.path);
    }
    onClose();
  };

  if (!open) return null;

  const placesCount = rows.filter(r => r.kind === 'place').length;
  const recentCount = rows.filter(r => r.kind === 'recent').length;
  const cmdCount = rows.filter(r => r.kind === 'command').length;

  return (
    <div className="fixed inset-0 z-[12000] flex items-start justify-center pt-[10vh] bg-black/40">
      <div
        ref={panelRef}
        className="bndz-omnibar-hub w-[min(520px,94vw)] max-h-[min(580px,78vh)] flex flex-col overflow-hidden"
        role="dialog"
        aria-label="Omnibar command hub"
      >
        <div className="bndz-omnibar-hub-head shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="bndz-omnibar-hub-mark" aria-hidden>
              <Icons8Icon id="search" size={14} />
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-[#e8eef6] tracking-wide">Command Hub</div>
              <div className="text-[10px] text-white/35 truncate">
                Places · paths · &gt;commands — double-click the fuzzy bar anytime
              </div>
            </div>
          </div>
          <button type="button" className="bndz-omnibar-hub-esc" onClick={onClose} title="Close">
            Esc
          </button>
        </div>

        <div className="bndz-omnibar-hub-search shrink-0">
          <Icons8Icon id="zap_ui" size={13} className="opacity-55 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="bndz-omnibar-hub-input"
            placeholder="Jump to folder, type a path, or >command…"
            spellCheck={false}
            autoComplete="off"
          />
          {onInsert && (
            <button
              type="button"
              className="bndz-omnibar-hub-chip"
              title="Insert into fuzzy bar"
              onClick={() => {
                onInsert(query || '>');
                onClose();
              }}
            >
              Insert
            </button>
          )}
        </div>

        <div className="bndz-omnibar-hub-meta shrink-0">
          <span>{placesCount} places</span>
          <span>{recentCount} recent</span>
          <span>{cmdCount} commands</span>
        </div>

        <div className="overflow-y-auto styled-scrollbar flex-1 px-2 pb-2">
          {rows.length === 0 ? (
            <p className="text-[12px] text-white/35 px-3 py-8 text-center leading-relaxed">
              Pin folders from the sidebar, or type a path / &gt;command.
            </p>
          ) : (
            <ul className="space-y-[2px]">
              {rows.map((row, i) => {
                const isActive = i === active;
                const icon =
                  row.kind === 'place' ? 'folder'
                    : row.kind === 'recent' ? 'clock_ui'
                      : (row.icon || 'command');
                return (
                  <li key={row.key}>
                    <button
                      type="button"
                      className={`bndz-omnibar-hub-row ${isActive ? 'is-active' : ''}`}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => activate(row)}
                    >
                      <span className={`bndz-omnibar-hub-row-ico bndz-omnibar-hub-row-ico--${row.kind}`}>
                        <Icons8Icon id={icon} size={13} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] font-medium truncate text-[#e8eef6]">{row.name}</span>
                        <span className="block text-[10px] text-white/35 truncate font-mono">{row.sub}</span>
                      </span>
                      <span className="bndz-omnibar-hub-kind">
                        {row.kind === 'place' ? 'Place' : row.kind === 'recent' ? 'Recent' : 'Cmd'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="bndz-omnibar-hub-foot shrink-0">
          <span><kbd>↑↓</kbd> move</span>
          <span><kbd>Enter</kbd> go</span>
          <span><kbd>Esc</kbd> close</span>
          <span className="ml-auto opacity-50">Also: %AppData% · C:\ · shell: · &gt;find</span>
        </div>
      </div>
    </div>
  );
}
