import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icons8Icon } from '../../components/Icons8Icon';
import { listInstalledPlugins, openPluginStore } from '../bridge/flowBridge';
import { rebrandLauncherText } from '../../lib/rebrandLauncherText';
import type { PluginRecord } from '../types';

type Props = {
  onClose: () => void;
  onRunKeyword?: (keyword: string) => void;
};

/** Dedicated Raycast-style Plugin Store hub — browse installed Flow plugins and open the store. */
export default function BndzPluginStoreView({ onClose, onRunKeyword }: Props) {
  const [plugins, setPlugins] = useState<PluginRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPlugins(await listInstalledPlugins());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    inputRef.current?.focus();
  }, [load]);

  const filtered = plugins.filter(p => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const name = rebrandLauncherText(p.name).toLowerCase();
    const desc = rebrandLauncherText(p.description).toLowerCase();
    return name.includes(q) || desc.includes(q) || (p.actionKeyword || '').toLowerCase().includes(q);
  });

  const selected = filtered[selectedIndex];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, Math.max(0, filtered.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && selected?.actionKeyword) {
      e.preventDefault();
      onRunKeyword?.(selected.actionKeyword);
      onClose();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="glass-effect h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--footer-border)] shrink-0">
        <button type="button" className="bndz-icon-btn" onClick={onClose} aria-label="Back">
          <Icons8Icon id="chevron_left" size={14} />
        </button>
        <Icons8Icon id="store" size={16} className="shrink-0" />
        <span className="text-[14px] font-semibold shrink-0">Plugin Store</span>
        <div className="flex-1 relative min-w-0">
          <Icons8Icon id="search" size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-60" />
          <input
            ref={inputRef}
            className="bndz-search-input w-full pl-8"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Search installed plugins…"
          />
        </div>
        <button type="button" className="bndz-icon-btn" title="Refresh" onClick={() => void load()} disabled={loading}>
          <Icons8Icon id="refresh" size={14} spin={loading} />
        </button>
        <button
          type="button"
          className="bndz-btn-primary text-[11px] px-3 py-1.5 flex items-center gap-1.5 shrink-0"
          onClick={() => void openPluginStore()}
        >
          <Icons8Icon id="external_link" size={12} /> Browse Store
        </button>
      </div>

      <div className="flex-1 grid grid-cols-[2fr_3fr] min-h-0">
        <div className="border-r border-[var(--footer-border)] overflow-y-auto custom-scrollbar">
          {loading && filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-[var(--text-muted)] text-[12px]">Loading plugins…</div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-[var(--text-muted)] text-[12px]">
              {query.trim() ? 'No plugins match your search.' : 'No plugins installed yet.'}
            </div>
          ) : (
            filtered.map((p, i) => (
              <div
                key={p.id}
                className={`px-3 py-2.5 cursor-pointer border-l-2 ${i === selectedIndex ? 'selected border-[var(--accent)] bg-[var(--command-item-selected-bg)]' : 'border-transparent command-item'}`}
                onClick={() => setSelectedIndex(i)}
                onDoubleClick={() => {
                  if (p.actionKeyword) {
                    onRunKeyword?.(p.actionKeyword);
                    onClose();
                  }
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Icons8Icon id="puzzle_ui" size={14} className="shrink-0 opacity-70" />
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium truncate">{rebrandLauncherText(p.name)}</div>
                    {p.actionKeyword ? (
                      <div className="text-[10px] font-mono text-[var(--text-subtle)]">{p.actionKeyword}</div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex flex-col min-h-0 p-4">
          {selected ? (
            <div className="space-y-3">
              <div className="text-[16px] font-semibold">{rebrandLauncherText(selected.name)}</div>
              <div className="text-[12px] text-[var(--text-muted)] leading-relaxed">
                {rebrandLauncherText(selected.description) || 'No description provided.'}
              </div>
              <div className="text-[11px] text-[var(--text-subtle)] space-y-1">
                {selected.version ? <div>Version {selected.version}</div> : null}
                {selected.author ? <div>By {selected.author}</div> : null}
                {selected.actionKeyword ? (
                  <div>Keyword: <span className="font-mono text-[var(--text-muted)]">{selected.actionKeyword}</span></div>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                {selected.actionKeyword ? (
                  <button
                    type="button"
                    className="bndz-btn-primary"
                    onClick={() => { onRunKeyword?.(selected.actionKeyword!); onClose(); }}
                  >
                    Run "{selected.actionKeyword}"
                  </button>
                ) : null}
                <button type="button" className="bndz-btn-ghost text-[11px]" onClick={() => void openPluginStore()}>
                  <Icons8Icon id="external_link" size={12} /> Manage in Flow Store
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 px-6">
              <Icons8Icon id="store" size={32} className="opacity-40" />
              <p className="text-[var(--text-muted)] text-[13px]">Select a plugin or open the Flow Plugin Store to install more.</p>
              <button type="button" className="bndz-btn-primary" onClick={() => void openPluginStore()}>
                <Icons8Icon id="external_link" size={12} /> Open Flow Plugin Store
              </button>
            </div>
          )}
          <div className="mt-auto bndz-launcher-footer -mx-4 px-4 py-2.5 flex justify-between items-center">
            <span className="text-[11px] text-[var(--text-subtle)]">{filtered.length} installed</span>
            <span className="text-[10px] text-[var(--text-subtle)]">↑↓ navigate · Enter run · Esc back</span>
          </div>
        </div>
      </div>
    </div>
  );
}
