import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LauncherSearchHeader from './components/LauncherSearchHeader';
import LauncherCommandList from './components/LauncherCommandList';
import LauncherFooter from './components/LauncherFooter';
import { executeCommand, notifyReady, onHostMessage, requestQuery } from './bridge/flowBridge';
import type { LauncherCommand } from './types';

/** SuperCmd LauncherMainView + App orchestration — adapted for BNDZ / Flow bridge */
export default function BndzLauncherApp() {
  const [query, setQuery] = useState('');
  const [commands, setCommands] = useState<LauncherCommand[]>([]);
  const [sections, setSections] = useState<{ title: string; items: LauncherCommand[] }[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flatCommands = useMemo(() => sections.flatMap(s => s.items), [sections]);
  const selected = flatCommands[selectedIndex] ?? commands[selectedIndex] ?? null;

  const runQuery = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const result = await requestQuery(q);
      const list = result.commands ?? [];
      setCommands(list);
      setSections(result.sections?.length ? result.sections : [{ title: 'Results', items: list }]);
      setSelectedIndex(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    notifyReady();
    void runQuery('');
    const off = onHostMessage(msg => {
      if (msg.type === 'THEME_SYNC') {
        document.documentElement.classList.toggle('dark', msg.dark);
      }
    });
    inputRef.current?.focus();
    return off;
  }, [runQuery]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runQuery(query), 80);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runQuery]);

  useEffect(() => {
    const el = itemRefs.current[selectedIndex];
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, flatCommands.length]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const count = flatCommands.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (count) setSelectedIndex(i => (i + 1) % count);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (count) setSelectedIndex(i => (i - 1 + count) % count);
    } else if (e.key === 'Enter' && selected) {
      e.preventDefault();
      executeCommand(selected);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setQuery('');
    }
  };

  return (
    <div className="w-full h-full p-2 box-border">
      <div className="glass-effect h-full flex flex-col">
        <LauncherSearchHeader
          value={query}
          placeholder={loading ? 'Searching…' : 'Search apps, files, clipboard, BNDZ…'}
          inputRef={inputRef}
          onChange={setQuery}
          onKeyDown={handleKeyDown}
        />
        <LauncherCommandList
          sections={sections}
          flatCommands={flatCommands}
          selectedIndex={selectedIndex}
          itemRefs={itemRefs}
          onSelect={(idx) => setSelectedIndex(idx)}
          onExecute={executeCommand}
        />
        <LauncherFooter selected={selected} />
      </div>
    </div>
  );
}
