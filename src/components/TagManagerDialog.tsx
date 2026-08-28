import React, { useEffect, useMemo, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { TagGlyph } from './TagGlyph';
import { BndzWindowFrame } from './native/BndzWindowFrame';
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
    void (async () => {
      const { IPC } = await import('../lib/ipcBridge');
      IPC.purgeTagFromSidecar(name);
      await persist(tags.filter(t => t.name !== name));
      if (activeFilter === name) setActiveFilter(null);
    })();
  };

  const saveEdit = (name: string) => {
    const label = editLabel.trim();
    if (!label) return;
    void persist(tags.map(t => t.name === name ? { ...t, label } : t));
    setEditingId(null);
  };

  if (!isOpen) return null;

  return (
    <BndzWindowFrame
      title="Tag Manager"
      subtitle={`${tags.length} tag definitions · ${taggedItems.length} tagged items in browsed folders`}
      iconId="tag_manager"
      onClose={onClose}
      widthClass="w-[min(720px,calc(100vw-2rem))]"
      heightClass="h-[min(520px,calc(100vh-2rem))]"
      zIndexClass="z-[250]"
    >
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="w-[42%] border-r border-white/[0.06] flex flex-col min-h-0 bg-black/15">
          <div className="p-4 border-b border-white/[0.06] space-y-3 shrink-0">
            <div className="flex gap-2">
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addTag()}
                placeholder="New tag name..."
                className="bndz-native-input flex-1 text-sm"
              />
              <button type="button" onClick={addTag} className="bndz-hub-btn-primary px-3 py-2 text-sm font-semibold flex items-center gap-1 shrink-0">
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
          <div className="flex-1 overflow-y-auto bndz-scrollbar p-3 space-y-2 bndz-tag-manager-palette">
            {tags.map(tag => (
              <div
                key={tag.name}
                className={`bndz-plugin-card group flex items-center gap-3 !p-3 cursor-pointer transition-colors ${
                  activeFilter === tag.name ? 'ring-1 ring-[#0078d4]/45 bg-[#094771]/25' : ''
                }`}
                onClick={() => setActiveFilter(activeFilter === tag.name ? null : tag.name)}
              >
                <TagGlyph color={tag.color || '#FACC15'} size={18} />
                <div className="flex-1 min-w-0">
                  {editingId === tag.name ? (
                    <input
                      autoFocus
                      value={editLabel}
                      onChange={e => setEditLabel(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveEdit(tag.name); if (e.key === 'Escape') setEditingId(null); }}
                      onClick={e => e.stopPropagation()}
                      className="bndz-native-input w-full text-sm"
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
                    type="button"
                    className="p-1.5 rounded-md hover:bg-white/[0.08] text-gray-400 hover:text-white"
                    onClick={() => { setEditingId(tag.name); setEditLabel(tag.label); }}
                  >
                    <Icons8Icon id="pencil_ui" size={12} />
                  </button>
                  <button
                    type="button"
                    className="p-1.5 rounded-md hover:bg-red-950/50 text-gray-400 hover:text-red-400"
                    onClick={() => removeTag(tag.name)}
                  >
                    <Icons8Icon id="trash_ui" size={12} />
                  </button>
                </div>
              </div>
            ))}
            {tags.length === 0 && (
              <div className="bndz-plugin-card text-center text-gray-500 text-xs py-8">
                <Icons8Icon id="sparkles_ui" size={20} className="mx-auto mb-2 opacity-40" />
                Create your first tag above
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          <div className="bndz-plugin-section-title px-4 py-3 border-b border-white/[0.06] shrink-0">
            {activeFilter ? `Items tagged "${tags.find(t => t.name === activeFilter)?.label}"` : 'All tagged items'}
          </div>
          <div className="flex-1 overflow-y-auto bndz-scrollbar p-2">
            {filteredItems.length === 0 && (
              <div className="text-center text-gray-500 text-xs py-10">No tagged items in browsed folders yet</div>
            )}
            {filteredItems.map(item => (
              <div key={item.path} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/[0.04] text-[11px] font-mono">
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
    </BndzWindowFrame>
  );
}
