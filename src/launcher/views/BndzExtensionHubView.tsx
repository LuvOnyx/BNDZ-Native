import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icons8Icon } from '../../components/Icons8Icon';
import { listInstalledPlugins, openPluginStore } from '../bridge/flowBridge';
import { rebrandLauncherText } from '../../lib/rebrandLauncherText';
import type { PluginRecord } from '../types';

type Props = { onClose: () => void };

/** Phase D — Raycast-style extension hub listing Flow Launcher plugins. */
export default function BndzExtensionHubView({ onClose }: Props) {
  const [plugins, setPlugins] = useState<PluginRecord[]>([]);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setPlugins(await listInstalledPlugins());
  }, []);

  useEffect(() => { void load(); inputRef.current?.focus(); }, [load]);

  const filtered = plugins.filter(p => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const name = rebrandLauncherText(p.name).toLowerCase();
    const desc = rebrandLauncherText(p.description).toLowerCase();
    return name.includes(q) || desc.includes(q) || (p.actionKeyword || '').toLowerCase().includes(q);
  });

  const selected = filtered[selectedIndex];

  return (
    <div className="glass-effect h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--footer-border)]">
        <button type="button" className="bndz-icon-btn" onClick={onClose}><Icons8Icon id="chevron_left" size={14} /></button>
        <input
          ref={inputRef}
          className="bndz-search-input flex-1"
          value={query}
          onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
          placeholder="Search extensions…"
        />
        <button type="button" className="bndz-icon-btn" title="Plugin Store" onClick={() => void openPluginStore()}><Icons8Icon id="store" size={14} /></button>
      </div>
      <div className="flex-1 grid grid-cols-[2fr_3fr] min-h-0">
        <div className="border-r border-[var(--footer-border)] overflow-y-auto custom-scrollbar">
          {filtered.map((p, i) => (
            <div
              key={p.id}
              className={`px-3 py-2.5 cursor-pointer border-l-2 ${i === selectedIndex ? 'selected border-[var(--accent)] bg-[var(--command-item-selected-bg)]' : 'border-transparent command-item'}`}
              onClick={() => setSelectedIndex(i)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Icons8Icon id="puzzle_ui" size={14} className="shrink-0 opacity-70" />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium truncate">{rebrandLauncherText(p.name)}</div>
                  {p.actionKeyword ? <div className="text-[10px] font-mono text-[var(--text-subtle)]">{p.actionKeyword}</div> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-col min-h-0 p-4">
          {selected ? (
            <div className="space-y-3">
              <div className="text-[16px] font-semibold">{rebrandLauncherText(selected.name)}</div>
              <div className="text-[12px] text-[var(--text-muted)]">{rebrandLauncherText(selected.description) || 'No description'}</div>
              <div className="text-[11px] text-[var(--text-subtle)] space-y-1">
                {selected.version ? <div>Version {selected.version}</div> : null}
                {selected.author ? <div>By {selected.author}</div> : null}
                {selected.actionKeyword ? <div>Keyword: <span className="font-mono">{selected.actionKeyword}</span></div> : null}
              </div>
              {selected.actionKeyword ? (
                <button type="button" className="bndz-btn-primary mt-2" onClick={onClose}>
                  Search with "{selected.actionKeyword}"
                </button>
              ) : null}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] text-[13px]">Select an extension</div>
          )}
          <div className="mt-auto bndz-launcher-footer -mx-4 px-4 py-2.5 flex justify-between items-center">
            <span className="text-[11px] text-[var(--text-subtle)]">{filtered.length} installed</span>
            <button type="button" className="bndz-btn-ghost text-[11px]" onClick={() => void openPluginStore()}>
              <Icons8Icon id="external_link" size={12} /> Manage in Plugin Store
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
