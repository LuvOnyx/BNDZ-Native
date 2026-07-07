import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icons8Icon } from '../../components/Icons8Icon';
import type { SnippetRecord } from '../types';
import { deleteSnippet, listSnippets, upsertSnippet } from '../bridge/flowBridge';

type Props = {
  onClose: () => void;
  initialView: 'search' | 'create';
};

/** SuperCmd SnippetManager port — Raycast 40/60 split search + preview. */
export default function BndzSnippetManager({ onClose, initialView }: Props) {
  const [view, setView] = useState<'search' | 'create' | 'edit'>(initialView);
  const [snippets, setSnippets] = useState<SnippetRecord[]>([]);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editing, setEditing] = useState<SnippetRecord | undefined>();
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [keyword, setKeyword] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const list = await listSnippets();
    setSnippets(list);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (view === 'search') inputRef.current?.focus(); }, [view]);

  const filtered = snippets.filter(s => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return s.name.toLowerCase().includes(q) || s.content.toLowerCase().includes(q) || (s.keyword || '').toLowerCase().includes(q);
  });

  const selected = filtered[selectedIndex];

  const openCreate = () => {
    setEditing(undefined);
    setName('');
    setContent('');
    setKeyword('');
    setView('create');
  };

  const openEdit = (s: SnippetRecord) => {
    setEditing(s);
    setName(s.name);
    setContent(s.content);
    setKeyword(s.keyword || '');
    setView('edit');
  };

  const save = async () => {
    if (!name.trim() || !content.trim()) return;
    await upsertSnippet({ id: editing?.id, name: name.trim(), content: content.trim(), keyword: keyword.trim() || undefined });
    await load();
    setView('search');
  };

  const pasteSnippet = async (s: SnippetRecord) => {
    try { await navigator.clipboard.writeText(s.content); } catch { /* */ }
  };

  const remove = async (id: string) => {
    await deleteSnippet(id);
    await load();
    setSelectedIndex(0);
  };

  if (view === 'create' || view === 'edit') {
    return (
      <div className="glass-effect h-full flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--footer-border)]">
          <button type="button" className="bndz-icon-btn" onClick={() => setView('search')} title="Back"><Icons8Icon id="chevron_left" size={14} /></button>
          <span className="text-[14px] font-medium">{view === 'edit' ? 'Edit Snippet' : 'New Snippet'}</span>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
          <label className="block space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-[var(--text-subtle)]">Name</span>
            <input className="bndz-field" value={name} onChange={e => setName(e.target.value)} placeholder="Email signature" />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-[var(--text-subtle)]">Keyword (optional)</span>
            <input className="bndz-field" value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="sig" />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-[var(--text-subtle)]">Content</span>
            <textarea className="bndz-field min-h-[140px] font-mono text-[12px]" value={content} onChange={e => setContent(e.target.value)} placeholder="Hello {date}&#10;{clipboard}" />
          </label>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {['{clipboard}', '{date}', '{time}', '{date:YYYY-MM-DD}'].map(p => (
              <button key={p} type="button" className="bndz-chip-btn" onClick={() => setContent(c => c + p)}>{p}</button>
            ))}
          </div>
        </div>
        <div className="bndz-launcher-footer px-4 py-2.5 flex justify-between">
          <button type="button" className="bndz-btn-ghost" onClick={() => setView('search')}>Cancel</button>
          <button type="button" className="bndz-btn-primary" onClick={() => void save()}>Save Snippet</button>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-effect h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--footer-border)]">
        <button type="button" className="bndz-icon-btn" onClick={onClose} title="Back"><Icons8Icon id="chevron_left" size={14} /></button>
        <input
          ref={inputRef}
          className="bndz-search-input flex-1"
          value={query}
          onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
          placeholder="Search snippets…"
        />
        <button type="button" className="bndz-icon-btn" onClick={openCreate} title="New snippet"><Icons8Icon id="plus_ui" size={14} /></button>
      </div>
      <div className="flex-1 grid grid-cols-[2fr_3fr] min-h-0">
        <div className="border-r border-[var(--footer-border)] overflow-y-auto custom-scrollbar">
          {filtered.length === 0 ? (
            <div className="p-4 text-[12px] text-[var(--text-muted)]">No snippets yet. Press + to create one.</div>
          ) : filtered.map((s, i) => (
            <div
              key={s.id}
              className={`px-3 py-2.5 cursor-pointer border-l-2 ${i === selectedIndex ? 'selected border-[var(--accent)] bg-[var(--command-item-selected-bg)]' : 'border-transparent command-item'}`}
              onClick={() => setSelectedIndex(i)}
              onDoubleClick={() => void pasteSnippet(s)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Icons8Icon id="file_ui" size={14} className="shrink-0 opacity-70" />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium truncate">{s.name}</div>
                  {s.keyword ? <div className="text-[10px] text-[var(--text-subtle)] font-mono">{s.keyword}</div> : null}
                </div>
                {s.pinned ? <Icons8Icon id="pin_ui" size={10} className="shrink-0 opacity-50" /> : null}
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-col min-h-0">
          {selected ? (
            <>
              <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
                <div className="text-[11px] uppercase tracking-wider text-[var(--text-subtle)] mb-2">Preview</div>
                <pre className="text-[13px] leading-relaxed whitespace-pre-wrap text-[var(--text-primary)] font-sans">{selected.content}</pre>
              </div>
              <div className="bndz-launcher-footer px-3 py-2 flex gap-1 justify-end">
                <button type="button" className="bndz-btn-ghost text-[11px]" onClick={() => void pasteSnippet(selected)}><Icons8Icon id="clipboard" size={12} /> Paste</button>
                <button type="button" className="bndz-btn-ghost text-[11px]" onClick={() => void navigator.clipboard.writeText(selected.content)}><Icons8Icon id="copy" size={12} /> Copy</button>
                <button type="button" className="bndz-btn-ghost text-[11px]" onClick={() => openEdit(selected)}><Icons8Icon id="pencil_ui" size={12} /> Edit</button>
                <button type="button" className="bndz-btn-ghost text-[11px] text-red-400" onClick={() => void remove(selected.id)}><Icons8Icon id="trash_ui" size={12} /> Delete</button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] text-[13px]">Select a snippet</div>
          )}
        </div>
      </div>
    </div>
  );
}
