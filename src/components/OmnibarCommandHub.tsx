import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { TreeShellIcon } from './TreeShellIcon';
import type { RapidAccessItem } from '../lib/rapidAccessDefaults';
import type { NavVisit } from '../lib/navigationHistory';
import { formatUiPath } from '../lib/displayPath';
import {
  OMNIBAR_COMMANDS,
  OMNIBAR_GROUP_LABELS,
  OMNIBAR_GROUP_ORDER,
  type OmnibarCommandGroup,
} from '../lib/omnibarCommands';

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
  | { key: string; kind: 'place'; path: string; name: string; sub: string; iconPath?: string }
  | { key: string; kind: 'recent'; path: string; name: string; sub: string }
  | {
      key: string;
      kind: 'command';
      insert: string;
      name: string;
      sub: string;
      icon?: string;
      group: OmnibarCommandGroup;
      token: string;
    };

type ListEntry =
  | { type: 'header'; key: string; title: string }
  | { type: 'row'; key: string; row: Row; index: number };

const PLACE_NAME_ICON: Record<string, string> = {
  desktop: 'folder_open_ui',
  documents: 'emblem_documents',
  downloads: 'download',
  pictures: 'picture_ui',
  music: 'music_ui',
  videos: 'film_ui',
  home: 'home',
  gallery: 'images_ui',
  profile: 'home',
};

function placeFallbackIcon(name: string): string {
  return PLACE_NAME_ICON[name.trim().toLowerCase()] || 'folder';
}

/**
 * Omnibar Command Hub -- double-click the fuzzy bar for places + commands.
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
      .slice(0, 12)
      .map(p => ({
        key: `p:${p.path}`,
        kind: 'place' as const,
        path: p.path,
        name: p.name,
        sub: formatUiPath(p.path),
        iconPath: p.iconPath,
      }));

    const recentRows: Row[] = recent
      .filter(v => hit(v.label, v.path))
      .slice(0, 8)
      .map(v => ({
        key: `r:${v.path}`,
        kind: 'recent' as const,
        path: v.path,
        name: v.label,
        sub: formatUiPath(v.path),
      }));

    const cmdRows: Row[] = OMNIBAR_COMMANDS
      .filter(c => {
        if (!q) return true;
        const blob = [c.label, c.name, c.hint, ...(c.aliases || [])].join(' ');
        return hit(blob, c.name) || hit(c.hint, c.label);
      })
      .slice()
      .sort((a, b) => {
        const ga = OMNIBAR_GROUP_ORDER.indexOf(a.group || 'system');
        const gb = OMNIBAR_GROUP_ORDER.indexOf(b.group || 'system');
        return ga - gb;
      })
      .map(c => ({
        key: `c:${c.id}`,
        kind: 'command' as const,
        insert: `>${c.name}`,
        name: c.label,
        sub: `>${c.name}${c.aliases?.length ? ` · ${c.aliases.map(a => `>${a}`).join(' ')}` : ''} — ${c.hint}`,
        icon: c.icon,
        group: (c.group || 'system') as OmnibarCommandGroup,
        token: c.name,
      }));

    const cmdFirst = q.startsWith('>') || q.startsWith('::');
    if (cmdFirst) return [...cmdRows, ...placeRows, ...recentRows];
    return [...placeRows, ...recentRows, ...cmdRows];
  }, [places, recent, query]);

  const listEntries = useMemo((): ListEntry[] => {
    const out: ListEntry[] = [];
    let lastSection = '';
    rows.forEach((row) => {
      let section = '';
      if (row.kind === 'place') section = 'Places';
      else if (row.kind === 'recent') section = 'Recent';
      else section = OMNIBAR_GROUP_LABELS[row.group] || 'Commands';
      if (section !== lastSection) {
        out.push({ type: 'header', key: `h:${section}`, title: section });
        lastSection = section;
      }
      out.push({ type: 'row', key: row.key, row, index: out.filter(e => e.type === 'row').length });
    });
    // Fix indices: recompute properly
    let idx = 0;
    return out.map(e => {
      if (e.type === 'header') return e;
      return { ...e, index: idx++ };
    });
  }, [rows]);

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

  useEffect(() => {
    if (!open) return;
    const el = panelRef.current?.querySelector<HTMLElement>(`[data-hub-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open, listEntries]);

  if (!open) return null;

  const placesCount = rows.filter(r => r.kind === 'place').length;
  const recentCount = rows.filter(r => r.kind === 'recent').length;
  const cmdCount = rows.filter(r => r.kind === 'command').length;

  const quickCmds = OMNIBAR_COMMANDS.filter(c =>
    ['refresh', 'dual', 'preview', 'find', 'newtab', 'settings', 'home', 'terminal'].includes(c.id),
  );

  return (
    <div className="fixed inset-0 z-[12000] flex items-start justify-center pt-[8vh] bg-black/40">
      <div
        ref={panelRef}
        className="bndz-omnibar-hub w-[min(580px,94vw)] max-h-[min(640px,82vh)] flex flex-col overflow-hidden"
        role="dialog"
        aria-label="Omnibar command hub"
      >
        <div className="bndz-omnibar-hub-head shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="bndz-omnibar-hub-mark" aria-hidden>
              <Icons8Icon id="command_ui" size={14} />
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-[#e8eef6] tracking-wide">Command Hub</div>
              <div className="text-[10px] text-white/35 truncate">
                Places · recent · &gt;commands — double-click the fuzzy bar
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
            placeholder="Jump to folder, type a path, or >command..."
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

        {!query.trim() && (
          <div className="bndz-omnibar-hub-quick shrink-0">
            {quickCmds.map(c => (
              <button
                key={c.id}
                type="button"
                className="bndz-omnibar-hub-quick-btn"
                title={c.hint}
                onClick={() => {
                  onRunCommand(`>${c.name}`);
                  onClose();
                }}
              >
                <Icons8Icon id={c.icon || 'command_ui'} size={12} />
                <span>{c.label}</span>
              </button>
            ))}
          </div>
        )}

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
              {listEntries.map(entry => {
                if (entry.type === 'header') {
                  return (
                    <li key={entry.key} className="bndz-omnibar-hub-section" aria-hidden>
                      {entry.title}
                    </li>
                  );
                }
                const { row, index } = entry;
                const isActive = index === active;
                const cmdIcon = row.kind === 'command' ? (row.icon || 'command_ui') : null;
                return (
                  <li key={row.key}>
                    <button
                      type="button"
                      data-hub-idx={index}
                      className={`bndz-omnibar-hub-row ${isActive ? 'is-active' : ''}`}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => activate(row)}
                    >
                      <span className={`bndz-omnibar-hub-row-ico bndz-omnibar-hub-row-ico--${row.kind}`}>
                        {row.kind === 'place' ? (
                          <TreeShellIcon
                            path={row.path}
                            iconPath={row.iconPath}
                            size={14}
                            fallbackIcon={placeFallbackIcon(row.name)}
                          />
                        ) : row.kind === 'recent' ? (
                          <Icons8Icon id="history_ui" size={13} />
                        ) : (
                          <Icons8Icon id={cmdIcon!} size={13} />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] font-medium truncate text-[#e8eef6]">{row.name}</span>
                        <span className="block text-[10px] text-white/35 truncate font-mono">{row.sub}</span>
                      </span>
                      <span className="bndz-omnibar-hub-kind">
                        {row.kind === 'place' ? 'Place' : row.kind === 'recent' ? 'Recent' : `>${row.token}`}
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
          <span className="ml-auto opacity-50">%AppData% · C:\ · shell: · &gt;find</span>
        </div>
      </div>
    </div>
  );
}
