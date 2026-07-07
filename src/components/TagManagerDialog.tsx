import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Icons8Icon } from './Icons8Icon';
import { CloseGlyph } from './ChromeGlyphs';
import { ShellNativeIcon } from './ShellNativeIcon';

const PRESET_COLORS = ['#EF4444', '#F97316', '#EAB308', '#22C55E', '#3B82F6', '#A855F7', '#EC4899', '#6B7280'];

export interface TagDefinition {
  name: string;
  label: string;
  color: string;
  icon?: string;
}

interface TagManagerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  availableTags: TagDefinition[];
  onTagsUpdated: (tags: TagDefinition[]) => void;
  pathContentsCache?: Record<string, any[]>;
}

export function TagManagerDialog({ isOpen, onClose, availableTags, onTagsUpdated, pathContentsCache = {} }: TagManagerDialogProps) {
  const [tags, setTags] = useState<TagDefinition[]>(availableTags);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[4]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) setTags(availableTags);
  }, [isOpen, availableTags]);

  const taggedItems = useMemo(() => {
    const items: { path: string; name: string; tags: string[]; isDir: boolean }[] = [];
    for (const [dir, entries] of Object.entries(pathContentsCache)) {
      for (const ent of entries || []) {
        const t: string[] = Array.isArray(ent.tags) ? ent.tags : [];
        if (!t.length) continue;
        items.push({
          path: `${dir}/${ent.name}`.replace(/\/+/g, '/'),
          name: ent.name,
          tags: t,
          isDir: ent.type === 'directory',
        });
      }
    }
    return items;
  }, [pathContentsCache]);

  const filteredItems = activeFilter
    ? taggedItems.filter(i => i.tags.includes(activeFilter))
    : taggedItems;

  const tagUsage = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of taggedItems) {
      for (const t of item.tags) counts[t] = (counts[t] || 0) + 1;
    }
    return counts;
  }, [taggedItems]);

  const persist = async (next: TagDefinition[]) => {
    setTags(next);
    onTagsUpdated(next);
    const { IPC } = await import('../lib/ipcBridge');
    await IPC.saveTagsConfig(next);
  };

  const addTag = () => {
    const label = newName.trim();
    if (!label) return;
    const name = label.toLowerCase().replace(/\s+/g, '-');
    if (tags.some(t => t.name === name)) return;
    void persist([...tags, { name, label, color: newColor, icon: 'Circle' }]);
    setNewName('');
  };

  const removeTag = (name: string) => {
    void persist(tags.filter(t => t.name !== name));
    if (activeFilter === name) setActiveFilter(null);
  };

  const saveEdit = (name: string) => {
    const label = editLabel.trim();
    if (!label) return;
    void persist(tags.map(t => t.name === name ? { ...t, label } : t));
    setEditingId(null);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[250] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.96, opacity: 0, y: 12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.96, opacity: 0, y: 12 }}
          className="w-full max-w-2xl bg-[#121212] border border-[#333] shadow-2xl rounded-2xl flex flex-col overflow-hidden max-h-[85vh]"
          onClick={e => e.stopPropagation()}
        >
          <div className="px-6 py-4 border-b border-[#2a2a2a] bg-gradient-to-r from-[#1a1030] via-[#141414] to-[#0f1a28] flex justify-between items-center shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-pink-600/20 border border-pink-500/30 flex items-center justify-center">
                <Icons8Icon id="tag_manager" size={18} />
              </div>
              <div>
                <h2 className="text-base font-bold text-white tracking-tight">Tag Manager</h2>
                <p className="text-[11px] text-gray-500">{tags.length} tags · {taggedItems.length} tagged items in cache</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 text-gray-500 hover:text-white rounded-lg hover:bg-[#222]">
              <CloseGlyph size={18} />
            </button>
          </div>

          <div className="flex flex-1 min-h-0 overflow-hidden">
            <div className="w-[42%] border-r border-[#2a2a2a] flex flex-col min-h-0">
              <div className="p-4 border-b border-[#222] space-y-3 shrink-0">
                <div className="flex gap-2">
                  <input
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addTag()}
                    placeholder="New tag name..."
                    className="flex-1 bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-pink-500/60"
                  />
                  <button onClick={addTag} className="px-3 py-2 bg-pink-600 hover:bg-pink-500 text-white rounded-lg text-sm font-semibold flex items-center gap-1 shrink-0">
                    <Icons8Icon id="plus_ui" size={14} /> Add
                  </button>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewColor(c)}
                      className={`w-5 h-5 rounded-full border-2 transition-transform ${newColor === c ? 'border-white scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto bndz-scrollbar p-3 space-y-2">
                {tags.map(tag => (
                  <div
                    key={tag.name}
                    className={`group flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                      activeFilter === tag.name ? 'bg-pink-950/30 border-pink-500/40' : 'bg-[#0d0d0d] border-[#222] hover:border-[#444]'
                    }`}
                    onClick={() => setActiveFilter(activeFilter === tag.name ? null : tag.name)}
                  >
                    <span className="w-4 h-4 rounded-full shrink-0 ring-2 ring-white/10" style={{ backgroundColor: tag.color }} />
                    <div className="flex-1 min-w-0">
                      {editingId === tag.name ? (
                        <input
                          autoFocus
                          value={editLabel}
                          onChange={e => setEditLabel(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(tag.name); if (e.key === 'Escape') setEditingId(null); }}
                          onClick={e => e.stopPropagation()}
                          className="w-full bg-[#111] border border-[#444] rounded px-2 py-0.5 text-sm text-white"
                        />
                      ) : (
                        <>
                          <div className="text-sm font-medium text-gray-200 truncate">{tag.label}</div>
                          <div className="text-[10px] text-gray-500 font-mono">{tagUsage[tag.name] || 0} items</div>
                        </>
                      )}
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                      <button
                        className="p-1.5 rounded hover:bg-[#333] text-gray-400 hover:text-white"
                        onClick={() => { setEditingId(tag.name); setEditLabel(tag.label); }}
                      >
                        <Icons8Icon id="pencil_ui" size={12} />
                      </button>
                      <button
                        className="p-1.5 rounded hover:bg-red-950/50 text-gray-400 hover:text-red-400"
                        onClick={() => removeTag(tag.name)}
                      >
                        <Icons8Icon id="trash_ui" size={12} />
                      </button>
                    </div>
                  </div>
                ))}
                {tags.length === 0 && (
                  <div className="text-center text-gray-600 text-xs py-8">
                    <Icons8Icon id="sparkles_ui" size={20} className="mx-auto mb-2 opacity-40" />
                    Create your first tag above
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 flex flex-col min-h-0">
              <div className="px-4 py-3 border-b border-[#222] text-[11px] font-semibold uppercase tracking-wider text-gray-500 shrink-0">
                {activeFilter ? `Items tagged "${tags.find(t => t.name === activeFilter)?.label}"` : 'All tagged items'}
              </div>
              <div className="flex-1 overflow-y-auto bndz-scrollbar p-2">
                {filteredItems.length === 0 && (
                  <div className="text-center text-gray-600 text-xs py-10 italic">No tagged items in browsed folders yet</div>
                )}
                {filteredItems.map(item => (
                  <div key={item.path} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[#1a1a1a] text-[11px] font-mono">
                    <ShellNativeIcon path={item.path} isDir={item.isDir} size={12} eager />
                    <span className="flex-1 truncate text-gray-300">{item.name}</span>
                    <div className="flex gap-1 shrink-0">
                      {item.tags.map(t => {
                        const meta = tags.find(x => x.name === t);
                        return (
                          <span key={t} className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: meta?.color || '#666' }} title={meta?.label || t} />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
