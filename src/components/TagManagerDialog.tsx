import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { TagGlyph } from './TagGlyph';
import { BndzWindowFrame } from './native/BndzWindowFrame';
import { ShellNativeIcon } from './ShellNativeIcon';
import { tagKeysMatch } from '../lib/tagUtils';

const PRESET_COLORS = ['#EF4444', '#F97316', '#EAB308', '#22C55E', '#3B82F6', '#A855F7', '#EC4899', '#6B7280'];

export interface TagDefinition {
  name: string;
  label: string;
  color: string;
  icon?: string;
}

type TaggedItem = {
  path: string;
  name: string;
  tags: string[];
  label?: string;
  isDir: boolean;
};

interface TagManagerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  availableTags: TagDefinition[];
  onTagsUpdated: (tags: TagDefinition[]) => void;
  /** @deprecated Prefer global sidecar via GET_ALL_TAGGED — kept for navigate fallback. */
  pathContentsCache?: Record<string, any[]>;
  onOpenPath?: (path: string) => void;
}

export function TagManagerDialog({
  isOpen,
  onClose,
  availableTags,
  onTagsUpdated,
  onOpenPath,
}: TagManagerDialogProps) {
  const [tags, setTags] = useState<TagDefinition[]>(availableTags);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[4]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editKey, setEditKey] = useState('');
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [taggedItems, setTaggedItems] = useState<TaggedItem[]>([]);
  const [loadingTagged, setLoadingTagged] = useState(false);

  const loadTagged = useCallback(async () => {
    setLoadingTagged(true);
    try {
      const { IPC } = await import('../lib/ipcBridge');
      const entries = await IPC.getAllTagged();
      setTaggedItems(entries.map(e => {
        const path = String(e.path || '');
        const leaf = path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || path;
        const tagsArr = Array.isArray(e.tags) ? e.tags.map(String) : [];
        const looksDir = !leaf.includes('.');
        return {
          path,
          name: leaf,
          tags: tagsArr,
          label: e.label,
          isDir: looksDir,
        };
      }).filter(i => i.path && i.tags.length > 0));
    } catch {
      setTaggedItems([]);
    } finally {
      setLoadingTagged(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setTags(availableTags);
    void loadTagged();
  }, [isOpen, availableTags, loadTagged]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return taggedItems.filter(i => {
      if (activeFilter && !i.tags.some(t => tagKeysMatch(t, activeFilter))) return false;
      if (!q) return true;
      return i.name.toLowerCase().includes(q)
        || i.path.toLowerCase().includes(q)
        || i.tags.some(t => t.toLowerCase().includes(q))
        || (i.label || '').toLowerCase().includes(q);
    });
  }, [taggedItems, activeFilter, search]);

  const tagUsage = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of taggedItems) {
      for (const t of item.tags) {
        const key = tags.find(def => tagKeysMatch(def.name, t))?.name || t;
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    return counts;
  }, [taggedItems, tags]);

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
      await loadTagged();
    })();
  };

  const saveEdit = (oldName: string) => {
    const label = editLabel.trim();
    if (!label) return;
    const nextKey = (editKey.trim() || oldName).toLowerCase().replace(/\s+/g, '-');
    if (!nextKey) return;
    void (async () => {
      const { IPC } = await import('../lib/ipcBridge');
      if (nextKey !== oldName) {
        if (tags.some(t => t.name === nextKey && t.name !== oldName)) return;
        IPC.renameTagInSidecar(oldName, nextKey);
        const next = tags.map(t => (t.name === oldName ? { ...t, name: nextKey, label } : t));
        await persist(next);
        if (activeFilter === oldName) setActiveFilter(nextKey);
        setTaggedItems(prev => prev.map(item => ({
          ...item,
          tags: item.tags.map(t => (tagKeysMatch(t, oldName) ? nextKey : t)),
        })));
      } else {
        await persist(tags.map(t => (t.name === oldName ? { ...t, label } : t)));
      }
      setEditingId(null);
    })();
  };

  if (!isOpen) return null;

  return (
    <BndzWindowFrame
      title="Tag Manager"
      subtitle={`${tags.length} definitions · ${taggedItems.length} tagged files library-wide`}
      iconId="tag_manager"
      onClose={onClose}
      widthClass="w-[min(780px,calc(100vw-2rem))]"
      heightClass="h-[min(560px,calc(100vh-2rem))]"
      zIndexClass="z-[250]"
    >
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="w-[40%] border-r border-white/[0.06] flex flex-col min-h-0 bg-black/15">
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
                    <div className="space-y-1" onClick={e => e.stopPropagation()}>
                      <input
                        autoFocus
                        value={editLabel}
                        onChange={e => setEditLabel(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(tag.name); if (e.key === 'Escape') setEditingId(null); }}
                        className="bndz-native-input w-full text-sm"
                        placeholder="Display label"
                      />
                      <input
                        value={editKey}
                        onChange={e => setEditKey(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(tag.name); if (e.key === 'Escape') setEditingId(null); }}
                        className="bndz-native-input w-full text-[10px] font-mono"
                        placeholder="Tag key (rename cascades library-wide)"
                      />
                    </div>
                  ) : (
                    <>
                      <div className="text-sm font-medium text-gray-200 truncate">{tag.label}</div>
                      <div className="text-[10px] text-gray-500 font-mono">{tagUsage[tag.name] || 0} items · {tag.name}</div>
                    </>
                  )}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                  <button
                    type="button"
                    className="p-1.5 rounded-md hover:bg-white/[0.08] text-gray-400 hover:text-white"
                    onClick={() => { setEditingId(tag.name); setEditLabel(tag.label); setEditKey(tag.name); }}
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
          <div className="px-4 py-3 border-b border-white/[0.06] shrink-0 space-y-2">
            <div className="bndz-plugin-section-title">
              {activeFilter ? `Tagged “${tags.find(t => t.name === activeFilter)?.label || activeFilter}”` : 'Library tagged items'}
            </div>
            <div className="relative">
              <Icons8Icon id="search" size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-50" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search paths, names, tags…"
                className="bndz-native-input w-full !pl-8 !py-1.5 !text-[11px]"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto bndz-scrollbar p-2">
            {loadingTagged && (
              <div className="text-center text-gray-500 text-xs py-10">Loading tagged library…</div>
            )}
            {!loadingTagged && filteredItems.length === 0 && (
              <div className="text-center text-gray-500 text-xs py-10 px-4 leading-relaxed">
                No tagged files in the library sidecar yet. Tag items from the list, Properties, or Tag Assignment Mode.
              </div>
            )}
            {filteredItems.map(item => (
              <button
                key={item.path}
                type="button"
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/[0.04] text-[11px] font-mono text-left"
                onClick={() => onOpenPath?.(item.path)}
                title={item.path}
              >
                <ShellNativeIcon path={item.path} isDir={item.isDir} size={12} eager />
                <span className="flex-1 truncate text-gray-300">{item.name}</span>
                <div className="flex gap-1 shrink-0">
                  {item.tags.map(t => {
                    const meta = tags.find(x => tagKeysMatch(x.name, t));
                    return (
                      <span key={t} className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: meta?.color || '#666' }} title={meta?.label || t} />
                    );
                  })}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </BndzWindowFrame>
  );
}
