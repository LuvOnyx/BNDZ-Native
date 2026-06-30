import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FileSearch } from 'lucide-react';
import type { LauncherCommand } from '../types';
import { executeCommand, requestQueryStreaming } from '../bridge/flowBridge';
import LauncherPreviewPanel from '../components/LauncherPreviewPanel';

type Props = { onClose: () => void; initialQuery?: string };

export default function BndzFileSearchView({ onClose, initialQuery = '' }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [items, setItems] = useState<LauncherCommand[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const genRef = useRef(0);

  const runSearch = useCallback(async (q: string) => {
    const gen = ++genRef.current;
    await requestQueryStreaming(q, (result, partial) => {
      if (genRef.current !== gen) return;
      const files = (result.commands ?? []).filter(c =>
        c.category === 'extension' && (c.subtitle?.toLowerCase().includes('file') || c.title.includes('\\') || c.title.includes('/'))
      );
      const list = files.length > 0 ? files : (result.commands ?? []).filter(c => c.id.startsWith('flow-Flow.Launcher.Plugin.Explorer'));
      setItems(list);
      if (!partial) setSelectedIndex(0);
    });
  }, []);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const t = setTimeout(() => void runSearch(query), query ? 40 : 0);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  const selected = items[selectedIndex];

  const autocompleteSuffix = useMemo(() => {
    if (!query.trim() || !selected?.title) return '';
    const q = query.toLowerCase();
    const title = selected.title;
    if (title.toLowerCase().startsWith(q) && title.length > query.length) {
      return title.slice(query.length);
    }
    return '';
  }, [query, selected?.title]);

  const handleExecute = useCallback((cmd: LauncherCommand) => {
    void executeCommand(cmd);
  }, []);

  return (
    <div className="glass-effect h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--footer-border)]">
        <button type="button" className="bndz-icon-btn" onClick={onClose} title="Back"><ArrowLeft size={14} /></button>
        <FileSearch size={16} className="text-[var(--text-muted)]" />
        <div className="relative min-w-0 flex-1">
          {autocompleteSuffix && query ? (
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center text-[13px] font-medium whitespace-pre overflow-hidden">
              <span className="invisible">{query}</span>
              <span className="text-[color:var(--text-subtle)]">{autocompleteSuffix}</span>
            </div>
          ) : null}
          <input
            ref={inputRef}
            className="bndz-search-input flex-1 relative z-[1] text-[13px]"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
            placeholder="Search files and folders…"
            onKeyDown={e => {
              if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); setSelectedIndex(i => (i + 1) % items.length); }
              if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); setSelectedIndex(i => (i - 1 + items.length) % items.length); }
              if (e.key === 'Enter' && selected) { e.preventDefault(); void executeCommand(selected); }
            }}
          />
        </div>
      </div>
      <div className="flex-1 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] min-h-0">
        <div className="border-r border-[var(--footer-border)] overflow-y-auto custom-scrollbar">
          {items.map((item, i) => (
            <div
              key={item.id}
              className={`px-3 py-2.5 cursor-pointer border-l-2 transition-colors duration-120 ${i === selectedIndex ? 'selected border-[var(--accent)] bg-[var(--command-item-selected-bg)]' : 'border-transparent command-item'}`}
              onClick={() => setSelectedIndex(i)}
              onDoubleClick={() => void executeCommand(item)}
            >
              <div className="text-[13px] font-medium truncate">{item.title}</div>
              <div className="text-[11px] text-[var(--text-subtle)] truncate">{item.subtitle}</div>
            </div>
          ))}
          {items.length === 0 && (
            <div className="p-6 text-center text-[var(--text-muted)] text-[13px]">Type to search indexed files (Flow Explorer plugin)</div>
          )}
        </div>
        <div className="min-h-0 border-l border-[var(--footer-border)] bg-black/5">
          <LauncherPreviewPanel
            command={selected}
            onExecute={handleExecute}
          />
        </div>
      </div>
    </div>
  );
}
