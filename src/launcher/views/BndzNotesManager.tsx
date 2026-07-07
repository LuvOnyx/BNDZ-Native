import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icons8Icon } from '../../components/Icons8Icon';
import type { NoteRecord } from '../types';
import { deleteNote, listNotes, upsertNote } from '../bridge/flowBridge';

type Props = {
  onClose: () => void;
  initialView: 'search' | 'create';
};

export default function BndzNotesManager({ onClose, initialView }: Props) {
  const [view, setView] = useState<'search' | 'create' | 'edit'>(initialView);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editing, setEditing] = useState<NoteRecord | undefined>();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setNotes(await listNotes());
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (view === 'search') inputRef.current?.focus(); }, [view]);

  const filtered = notes.filter(n => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q);
  });

  const selected = filtered[selectedIndex];

  const openCreate = () => {
    setEditing(undefined);
    setTitle('');
    setContent('');
    setView('create');
  };

  const openEdit = (n: NoteRecord) => {
    setEditing(n);
    setTitle(n.title);
    setContent(n.content);
    setView('edit');
  };

  const save = async () => {
    if (!title.trim()) return;
    await upsertNote({ id: editing?.id, title: title.trim(), content: content.trim() });
    await load();
    setView('search');
  };

  const copyNote = async (n: NoteRecord) => {
    try { await navigator.clipboard.writeText(n.content); } catch { /* */ }
  };

  const remove = async (id: string) => {
    await deleteNote(id);
    await load();
    setSelectedIndex(0);
  };

  if (view === 'create' || view === 'edit') {
    return (
      <div className="glass-effect h-full flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--footer-border)]">
          <button type="button" className="bndz-icon-btn" onClick={() => setView('search')} title="Back"><Icons8Icon id="chevron_left" size={14} /></button>
          <span className="text-[14px] font-medium">{view === 'edit' ? 'Edit Note' : 'New Note'}</span>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
          <label className="block space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-[var(--text-subtle)]">Title</span>
            <input className="bndz-field" value={title} onChange={e => setTitle(e.target.value)} placeholder="Meeting notes" />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-[var(--text-subtle)]">Content (Markdown)</span>
            <textarea className="bndz-field min-h-[220px] font-mono text-[12px]" value={content} onChange={e => setContent(e.target.value)} placeholder="# Heading&#10;&#10;- Item one" />
          </label>
        </div>
        <div className="bndz-launcher-footer px-4 py-2.5 flex justify-between">
          <button type="button" className="bndz-btn-ghost" onClick={() => setView('search')}>Cancel</button>
          <button type="button" className="bndz-btn-primary" onClick={() => void save()}>Save Note</button>
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
          placeholder="Search notes…"
        />
        <button type="button" className="bndz-icon-btn" title="New note" onClick={openCreate}><Icons8Icon id="plus_ui" size={14} /></button>
      </div>
      <div className="flex-1 grid grid-cols-[2fr_3fr] min-h-0">
        <div className="border-r border-[var(--footer-border)] overflow-y-auto custom-scrollbar">
          {filtered.map((n, i) => (
            <div
              key={n.id}
              className={`px-3 py-2.5 cursor-pointer border-l-2 ${i === selectedIndex ? 'selected border-[var(--accent)] bg-[var(--command-item-selected-bg)]' : 'border-transparent command-item'}`}
              onClick={() => setSelectedIndex(i)}
            >
              <div className="text-[13px] font-medium truncate">{n.title}</div>
              <div className="text-[11px] text-[var(--text-subtle)] truncate">{n.content.split('\n')[0] || 'Empty note'}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-col min-h-0 p-4">
          {selected ? (
            <>
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="text-[16px] font-semibold">{selected.title}</div>
                <div className="flex gap-1">
                  <button type="button" className="bndz-icon-btn" title="Copy" onClick={() => void copyNote(selected)}><Icons8Icon id="copy" size={14} /></button>
                  <button type="button" className="bndz-icon-btn" title="Edit" onClick={() => openEdit(selected)}><Icons8Icon id="pencil_ui" size={14} /></button>
                  <button type="button" className="bndz-icon-btn" title="Delete" onClick={() => void remove(selected.id)}><Icons8Icon id="trash_ui" size={14} /></button>
                </div>
              </div>
              <pre className="flex-1 overflow-y-auto custom-scrollbar text-[12px] text-[var(--text-secondary)] whitespace-pre-wrap font-mono leading-relaxed">{selected.content}</pre>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] text-[13px]">Select or create a note</div>
          )}
        </div>
      </div>
    </div>
  );
}
