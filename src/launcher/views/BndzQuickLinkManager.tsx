import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icons8Icon } from '../../components/Icons8Icon';
import type { QuickLinkRecord } from '../types';
import { deleteQuickLink, listQuickLinks, upsertQuickLink } from '../bridge/flowBridge';

type Props = {
  onClose: () => void;
  initialView: 'search' | 'create';
};

/** SuperCmd QuickLinkManager port — Raycast-style link browser. */
export default function BndzQuickLinkManager({ onClose, initialView }: Props) {
  const [view, setView] = useState<'search' | 'create' | 'edit'>(initialView);
  const [links, setLinks] = useState<QuickLinkRecord[]>([]);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editing, setEditing] = useState<QuickLinkRecord | undefined>();
  const [name, setName] = useState('');
  const [urlTemplate, setUrlTemplate] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLinks(await listQuickLinks());
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (view === 'search') inputRef.current?.focus(); }, [view]);

  const filtered = links.filter(l => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return l.name.toLowerCase().includes(q) || l.urlTemplate.toLowerCase().includes(q);
  });

  const selected = filtered[selectedIndex];

  const openCreate = () => {
    setEditing(undefined);
    setName('');
    setUrlTemplate('https://');
    setView('create');
  };

  const openEdit = (l: QuickLinkRecord) => {
    setEditing(l);
    setName(l.name);
    setUrlTemplate(l.urlTemplate);
    setView('edit');
  };

  const save = async () => {
    if (!name.trim() || !urlTemplate.trim()) return;
    await upsertQuickLink({ id: editing?.id, name: name.trim(), urlTemplate: urlTemplate.trim() });
    await load();
    setView('search');
  };

  const openLink = (l: QuickLinkRecord) => {
    const url = l.urlTemplate.replace(/\{query\}/gi, encodeURIComponent(query.trim()));
    window.open(url, '_blank');
  };

  const remove = async (id: string) => {
    await deleteQuickLink(id);
    await load();
    setSelectedIndex(0);
  };

  if (view === 'create' || view === 'edit') {
    return (
      <div className="glass-effect h-full flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--footer-border)]">
          <button type="button" className="bndz-icon-btn" onClick={() => setView('search')}><Icons8Icon id="chevron_left" size={14} /></button>
          <span className="text-[14px] font-medium">{view === 'edit' ? 'Edit Quick Link' : 'New Quick Link'}</span>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
          <label className="block space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-[var(--text-subtle)]">Name</span>
            <input className="bndz-field" value={name} onChange={e => setName(e.target.value)} placeholder="Google Search" />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-[var(--text-subtle)]">URL template</span>
            <input className="bndz-field font-mono text-[12px]" value={urlTemplate} onChange={e => setUrlTemplate(e.target.value)} placeholder="https://google.com/search?q={query}" />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {['{query}', '{clipboard}', '{date}'].map(p => (
              <button key={p} type="button" className="bndz-chip-btn" onClick={() => setUrlTemplate(u => u + p)}>{p}</button>
            ))}
          </div>
        </div>
        <div className="bndz-launcher-footer px-4 py-2.5 flex justify-between">
          <button type="button" className="bndz-btn-ghost" onClick={() => setView('search')}>Cancel</button>
          <button type="button" className="bndz-btn-primary" onClick={() => void save()}>Save Link</button>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-effect h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--footer-border)]">
        <button type="button" className="bndz-icon-btn" onClick={onClose}><Icons8Icon id="chevron_left" size={14} /></button>
        <input
          ref={inputRef}
          className="bndz-search-input flex-1"
          value={query}
          onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
          placeholder="Search quick links…"
        />
        <button type="button" className="bndz-icon-btn" onClick={openCreate}><Icons8Icon id="plus_ui" size={14} /></button>
      </div>
      <div className="flex-1 grid grid-cols-[2fr_3fr] min-h-0">
        <div className="border-r border-[var(--footer-border)] overflow-y-auto custom-scrollbar">
          {filtered.map((l, i) => (
            <div
              key={l.id}
              className={`px-3 py-2.5 cursor-pointer border-l-2 ${i === selectedIndex ? 'selected border-[var(--accent)] bg-[var(--command-item-selected-bg)]' : 'border-transparent command-item'}`}
              onClick={() => setSelectedIndex(i)}
              onDoubleClick={() => openLink(l)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Icons8Icon id="globe_ui" size={14} className="shrink-0 opacity-70" />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium truncate">{l.name}</div>
                  <div className="text-[10px] text-[var(--text-subtle)] truncate font-mono">{l.urlTemplate}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-col min-h-0">
          {selected ? (
            <>
              <div className="flex-1 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Icons8Icon id="link" size={16} />
                  <div className="text-[15px] font-semibold">{selected.name}</div>
                </div>
                <div className="text-[12px] font-mono text-[var(--text-muted)] break-all bg-black/20 rounded-lg p-3 border border-white/8">
                  {selected.urlTemplate}
                </div>
              </div>
              <div className="bndz-launcher-footer px-3 py-2 flex gap-1 justify-end">
                <button type="button" className="bndz-btn-ghost text-[11px]" onClick={() => openLink(selected)}><Icons8Icon id="external_link" size={12} /> Open</button>
                <button type="button" className="bndz-btn-ghost text-[11px]" onClick={() => openEdit(selected)}><Icons8Icon id="pencil_ui" size={12} /> Edit</button>
                <button type="button" className="bndz-btn-ghost text-[11px] text-red-400" onClick={() => void remove(selected.id)}><Icons8Icon id="trash_ui" size={12} /> Delete</button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] text-[13px]">Select a quick link</div>
          )}
        </div>
      </div>
    </div>
  );
}
