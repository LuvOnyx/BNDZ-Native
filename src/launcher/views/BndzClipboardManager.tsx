import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icons8Icon } from '../../components/Icons8Icon';
import { deleteClipboardItem, listClipboardHistory, pasteClipboardItem } from '../bridge/flowBridge';
import type { ClipboardRecord } from '../types';

type Props = { onClose: () => void };

function ClipboardPreview({ item }: { item: ClipboardRecord }) {
  if (item.kind === 'image' && item.imagePath) {
    return (
      <div className="flex flex-col items-center gap-3 p-4">
        <img
          src={`file:///${item.imagePath.replace(/\\/g, '/')}`}
          alt="Clipboard"
          className="max-w-full max-h-[280px] rounded-lg border border-[var(--border-subtle)] object-contain"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        <p className="text-[11px] text-[var(--text-muted)]">{item.preview}</p>
      </div>
    );
  }
  if (item.kind === 'files' && item.filePaths?.length) {
    return (
      <div className="p-4 space-y-2">
        <div className="flex items-center gap-2 text-[var(--text-muted)] text-[11px] uppercase tracking-wide">
          <Icons8Icon id="folder_open_ui" size={14} /> {item.filePaths.length} file(s)
        </div>
        <ul className="space-y-1 font-mono text-[12px] text-[var(--text-primary)]">
          {item.filePaths.map(p => (
            <li key={p} className="truncate border-b border-[var(--border-subtle)]/40 pb-1" title={p}>{p}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <pre className="text-[13px] leading-relaxed whitespace-pre-wrap break-words text-[var(--text-primary)] font-sans p-4">{item.content}</pre>
  );
}

/** SuperCmd ClipboardManager port — Raycast 40/60 split with rich preview. */
export default function BndzClipboardManager({ onClose }: Props) {
  const [items, setItems] = useState<ClipboardRecord[]>([]);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setItems(await listClipboardHistory());
  }, []);

  useEffect(() => { void load(); inputRef.current?.focus(); }, [load]);

  const filtered = items.filter(i => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return i.preview.toLowerCase().includes(q)
      || i.content.toLowerCase().includes(q)
      || (i.filePaths || []).some(p => p.toLowerCase().includes(q));
  });

  const selected = filtered[selectedIndex];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!filtered.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && selected) {
        e.preventDefault();
        void pasteClipboardItem(selected.id);
      } else if (e.key === 'Delete' && selected) {
        e.preventDefault();
        void deleteClipboardItem(selected.id).then(load);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, selected, load]);

  const kindIcon = (item: ClipboardRecord) => {
    if (item.kind === 'image') return <Icons8Icon id="picture_ui" size={14} className="shrink-0 mt-0.5 opacity-70" />;
    if (item.kind === 'files') return <Icons8Icon id="folder_open_ui" size={14} className="shrink-0 mt-0.5 opacity-70" />;
    return <Icons8Icon id="clipboard" size={14} className="shrink-0 mt-0.5 opacity-70" />;
  };

  return (
    <div className="glass-effect h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--footer-border)]">
        <button type="button" className="bndz-icon-btn" onClick={onClose}><Icons8Icon id="chevron_left" size={14} /></button>
        <input
          ref={inputRef}
          className="bndz-search-input flex-1"
          value={query}
          onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
          placeholder="Search clipboard history…"
        />
      </div>
      <div className="flex-1 grid grid-cols-[2fr_3fr] min-h-0">
        <div className="border-r border-[var(--footer-border)] overflow-y-auto custom-scrollbar">
          {filtered.map((item, i) => (
            <div
              key={item.id}
              className={`px-3 py-2.5 cursor-pointer border-l-2 ${i === selectedIndex ? 'selected border-[var(--accent)] bg-[var(--command-item-selected-bg)]' : 'border-transparent command-item'}`}
              onClick={() => setSelectedIndex(i)}
              onDoubleClick={() => void pasteClipboardItem(item.id)}
            >
              <div className="flex items-start gap-2 min-w-0">
                {kindIcon(item)}
                <div className="min-w-0">
                  <div className="text-[13px] font-medium truncate">{item.preview}</div>
                  <div className="text-[10px] text-[var(--text-subtle)]">{new Date(item.timestamp).toLocaleString()}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-col min-h-0">
          {selected ? (
            <>
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                <ClipboardPreview item={selected} />
              </div>
              <div className="bndz-launcher-footer px-3 py-2 flex gap-1 justify-end">
                <button type="button" className="bndz-btn-ghost text-[11px]" onClick={() => void pasteClipboardItem(selected.id)}><Icons8Icon id="clipboard" size={12} /> Paste</button>
                <button type="button" className="bndz-btn-ghost text-[11px]" onClick={() => void navigator.clipboard.writeText(selected.content)}><Icons8Icon id="copy" size={12} /> Copy</button>
                <button type="button" className="bndz-btn-ghost text-[11px] text-red-400" onClick={() => void deleteClipboardItem(selected.id).then(load)}><Icons8Icon id="trash_ui" size={12} /> Delete</button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] text-[13px]">No clipboard items</div>
          )}
        </div>
      </div>
    </div>
  );
}
