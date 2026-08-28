import React, { useMemo, useRef, useState } from 'react';
import { useAppConfig } from '../data/configContext';
import { tagChipId } from '../lib/tagUtils';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { launcherIconUrl } from '../lib/toolbarLauncherIcons';
import { TagGlyph } from './TagGlyph';
import { Icons8Icon } from './Icons8Icon';
import { BndzWindowFrame } from './native/BndzWindowFrame';

export type ToolbarItemDef = {
  id: string;
  label: string;
  color?: string;
  isStructure?: boolean;
  category?: string;
  description?: string;
};

export const TOOLBAR_CATEGORIES = [
  { id: 'navigation', label: 'Navigation', color: '#3b82f6' },
  { id: 'clipboard', label: 'Clipboard & Selection', color: '#eab308' },
  { id: 'files', label: 'Files & Folders', color: '#38bdf8' },
  { id: 'views', label: 'Views & Panels', color: '#a855f7' },
  { id: 'plugins', label: 'Plugins & Tools', color: '#ec4899' },
  { id: 'windows', label: 'Windows OS', color: '#10b981' },
  { id: 'tags', label: 'Tags', color: '#fbbf24' },
  { id: 'layout', label: 'Layout', color: '#6db4e6' },
  { id: 'structure', label: 'Layout Structure', color: '#94a3b8' },
] as const;

export const AVAILABLE_ITEMS: ToolbarItemDef[] = [
  { id: 'nav_back', label: 'Back', color: '#3b82f6', category: 'navigation' },
  { id: 'nav_forward', label: 'Forward', color: '#3b82f6', category: 'navigation' },
  { id: 'nav_up', label: 'Up One Level', color: '#10b981', category: 'navigation' },
  { id: 'go_home', label: 'Go Home', color: '#6db4e6', category: 'navigation' },
  { id: 'refresh', label: 'Refresh', color: '#10b981', category: 'navigation' },
  { id: 'folder_size_sync', label: 'Folder Size Map / Sync', color: '#34d399', category: 'navigation' },
  { id: 'go_recycle_bin', label: 'Open Recycle Bin', color: '#c084fc', category: 'navigation' },
  { id: 'go_network', label: 'Open Network', color: '#0078d4', category: 'navigation' },
  { id: 'new_tab', label: 'New Tab', color: '#fbbf24', category: 'navigation' },
  { id: 'cut', label: 'Cut', color: '#eab308', category: 'clipboard' },
  { id: 'copy', label: 'Copy', color: '#3b82f6', category: 'clipboard' },
  { id: 'paste', label: 'Paste', color: '#eab308', category: 'clipboard' },
  { id: 'delete', label: 'Delete', color: '#ef4444', category: 'clipboard' },
  { id: 'undo', label: 'Undo', color: '#3b82f6', category: 'clipboard' },
  { id: 'redo', label: 'Redo', color: '#3b82f6', category: 'clipboard' },
  { id: 'select_all', label: 'Select All', color: '#3b82f6', category: 'clipboard' },
  { id: 'invert_selection', label: 'Invert Selection', color: '#a855f7', category: 'clipboard' },
  { id: 'copy_path', label: 'Copy Path', color: '#93c5fd', category: 'clipboard' },
  { id: 'new_folder', label: 'New Folder', color: '#38bdf8', category: 'files' },
  { id: 'new_file', label: 'New File', color: '#cbd5e1', category: 'files' },
  { id: 'compress', label: 'Compress (Zip)', color: '#eab308', category: 'files' },
  { id: 'extract', label: 'Extract Archive', color: '#f59e0b', category: 'files' },
  { id: 'properties', label: 'Properties', color: '#888', category: 'files' },
  { id: 'sync_folders', label: 'Sync / Compare', color: '#9333ea', category: 'files' },
  { id: 'map_network_drive', label: 'Map Network Drive', color: '#10b981', category: 'files' },
  { id: 'share', label: 'Network Share', color: '#3b82f6', category: 'files' },
  { id: 'burn_disc', label: 'Burn to Disc', color: '#94a3b8', category: 'files' },
  { id: 'view_details', label: 'Details View', color: '#38bdf8', category: 'views' },
  { id: 'view_grid', label: 'Grid View', color: '#a855f7', category: 'views' },
  { id: 'view_list', label: 'List View', color: '#94a3b8', category: 'views' },
  { id: 'search', label: 'Focus Search', color: '#0078d4', category: 'views' },
  { id: 'toggle_dual_pane', label: 'Toggle Dual Pane', color: '#6db4e6', category: 'views' },
  { id: 'toggle_preview', label: 'Toggle Preview', color: '#6db4e6', category: 'views' },
  { id: 'toggle_bottom', label: 'Toggle Bottom Panel', color: '#6db4e6', category: 'views' },
  { id: 'smart_tools', label: 'Smart Tools', color: '#f472b6', category: 'plugins' },
  { id: 'tag_manager', label: 'Tag Manager', color: '#fbbf24', category: 'plugins' },
  { id: 'icon_studio', label: 'Icon Studio', color: '#ec4899', category: 'plugins' },
  { id: 'find', label: 'Fast Search', color: '#0ea5e9', category: 'plugins' },
  { id: 'dropstack', label: 'Drop Stack', color: '#8b5cf6', category: 'plugins' },
  { id: 'filters', label: 'Visual Filters', color: '#22d3ee', category: 'plugins' },
  { id: 'batch_rename', label: 'Batch Rename', color: '#fb923c', category: 'plugins' },
  { id: 'shell_menus', label: 'Shell Menus', color: '#60a5fa', category: 'plugins' },
  { id: 'metadata', label: 'Metadata', color: '#2dd4bf', category: 'plugins' },
  { id: 'storage_cleanup', label: 'Storage Cleanup', color: '#f87171', category: 'plugins' },
  { id: 'sys_properties', label: 'BNDZ Properties', color: '#c084fc', category: 'plugins' },
  { id: 'config', label: 'Configuration', color: '#888', category: 'plugins' },
  { id: 'extension_hub', label: 'Extension Hub', color: '#0078d4', category: 'plugins' },
  { id: 'wrench', label: 'Customize Toolbar', color: '#3b82f6', category: 'plugins' },
  { id: 'cmd', label: 'Command Prompt', color: '#eee', category: 'windows' },
  { id: 'ps', label: 'PowerShell', color: '#3b82f6', category: 'windows' },
  { id: 'terminal_here', label: 'Terminal Here', color: '#4ade80', category: 'windows' },
  { id: 'taskmgr', label: 'Task Manager', color: '#10b981', category: 'windows' },
  { id: 'regedit', label: 'Registry Editor', color: '#eab308', category: 'windows' },
  { id: 'control_panel', label: 'Control Panel', color: '#0078d4', category: 'windows' },
  { id: 'settings_app', label: 'Windows Settings', color: '#60a5fa', category: 'windows' },
  { id: 'device_manager', label: 'Device Manager', color: '#34d399', category: 'windows' },
  { id: 'services', label: 'Services', color: '#94a3b8', category: 'windows' },
  { id: 'event_viewer', label: 'Event Viewer', color: '#f59e0b', category: 'windows' },
  { id: 'disk_mgmt', label: 'Disk Management', color: '#f87171', category: 'windows' },
  { id: 'computer_mgmt', label: 'Computer Management', color: '#6db4e6', category: 'windows' },
  { id: 'sysdm_cpl', label: 'System Properties', color: '#c084fc', category: 'windows' },
  { id: 'network_connections', label: 'Network Connections', color: '#0078d4', category: 'windows' },
  { id: 'printers', label: 'Printers', color: '#a78bfa', category: 'windows' },
  { id: 'programs_features', label: 'Programs & Features', color: '#fb923c', category: 'windows' },
  { id: 'firewall', label: 'Windows Firewall', color: '#ef4444', category: 'windows' },
  { id: 'power_options', label: 'Power Options', color: '#fbbf24', category: 'windows' },
  { id: 'user_accounts', label: 'User Accounts', color: '#60a5fa', category: 'windows' },
  { id: 'msinfo', label: 'System Information', color: '#94a3b8', category: 'windows' },
  { id: 'dxdiag', label: 'DirectX Diagnostic', color: '#a855f7', category: 'windows' },
  { id: 'notepad', label: 'Notepad', color: '#e2e8f0', category: 'windows' },
  { id: 'calc', label: 'Calculator', color: '#0078d4', category: 'windows' },
  { id: 'paint', label: 'Paint', color: '#ec4899', category: 'windows' },
  { id: 'snipping_tool', label: 'Snipping Tool', color: '#34d399', category: 'windows' },
  { id: 'explorer', label: 'File Explorer', color: '#38bdf8', category: 'windows' },
  { id: 'magnifier', label: 'Magnifier', color: '#f472b6', category: 'windows' },
  { id: 'osk', label: 'On-Screen Keyboard', color: '#94a3b8', category: 'windows' },
  { id: 'separator', label: 'Separator (|)', isStructure: true, category: 'structure' },
  { id: 'spacer', label: 'Spacer', isStructure: true, category: 'structure' },
  { id: 'new_row', label: 'New Row', isStructure: true, category: 'structure' },
];

export function resolveToolbarItem(id: string, tags?: Array<{ id?: string; name?: string; label?: string; color?: string }>): ToolbarItemDef | undefined {
  if (id.startsWith('tag__')) {
    const tagId = id.slice(5);
    const tag = tags?.find(t => tagChipId(t) === tagId || (t.id || t.name) === tagId);
    if (tag) {
      return { id, label: `Tag: ${tag.label || tag.name}`, color: tag.color || '#fbbf24', category: 'tags' };
    }
  }
  return AVAILABLE_ITEMS.find(i => i.id === id);
}

export function buildTagToolbarItems(tags: Array<{ id?: string; name?: string; label?: string; color?: string }>): ToolbarItemDef[] {
  return (tags || []).map(t => ({
    id: `tag__${tagChipId(t)}`,
    label: `Apply ${t.label || t.name}`,
    color: t.color || '#fbbf24',
    category: 'tags',
  }));
}

const TOOLBAR_ZONE = 'toolbar-zone';
const TRASH_ZONE = 'trash-zone';

const ListItemIcon = ({ item }: { item: ToolbarItemDef }) => {
  if (item.isStructure) {
    return <div className="w-5 text-center text-[#888] font-mono font-bold text-xs">{(item.id === 'separator' ? '|' : item.id === 'spacer' ? '< >' : '---')}</div>;
  }
  if (item.id.startsWith('tag__') || item.category === 'tags') {
    return <TagGlyph color={item.color || '#FACC15'} size={16} />;
  }
  const png = launcherIconUrl(item.id);
  if (png) {
    return <img src={png} alt="" className="w-4 h-4 object-contain" draggable={false} />;
  }
  return <Icons8Icon id="puzzle_ui" size={16} />;
};

function PaletteDraggable({ item, onAdd }: { item: typeof AVAILABLE_ITEMS[0]; onAdd: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${item.id}`,
    data: { type: 'palette', itemId: item.id },
  });
  const cat = TOOLBAR_CATEGORIES.find(c => c.id === item.category);
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      className={`bndz-tb-palette-row group ${isDragging ? 'bndz-tb-palette-row--dragging' : ''}`}
      onClick={onAdd}
      title={`Add “${item.label}” to toolbar`}
    >
      <div className="bndz-tb-palette-icon" style={cat ? { borderColor: `${cat.color}44` } : undefined}>
        <ListItemIcon item={item} />
      </div>
      <div className="flex-1 min-w-0 text-left">
        <div className="text-[12.5px] font-semibold text-white/90 truncate leading-tight">{item.label}</div>
        {cat && (
          <div className="text-[10px] text-white/35 truncate mt-0.5">{cat.label}</div>
        )}
      </div>
      <span className="bndz-tb-palette-add opacity-0 group-hover:opacity-100 transition-opacity">
        <Icons8Icon id="plus_ui" size={12} />
      </span>
    </button>
  );
}

function ToolbarDropZone({ children, empty }: { children: React.ReactNode; empty?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: TOOLBAR_ZONE });
  return (
    <div
      ref={setNodeRef}
      className={`bndz-tb-preview-bar ${isOver ? 'bndz-tb-preview-bar--over' : ''} ${empty ? 'bndz-tb-preview-bar--empty' : ''}`}
    >
      {children}
      {empty && (
        <div className="bndz-tb-preview-empty pointer-events-none">
          Drag commands here, or click + in the library
        </div>
      )}
    </div>
  );
}

function TrashDropZone() {
  const { setNodeRef, isOver } = useDroppable({ id: TRASH_ZONE });
  return (
    <div
      ref={setNodeRef}
      className={`bndz-tb-trash ${isOver ? 'bndz-tb-trash--over' : ''}`}
    >
      <Icons8Icon id="delete" size={14} />
      <span>{isOver ? 'Release to remove' : 'Drag here to remove from toolbar'}</span>
    </div>
  );
}

function SortableItem(props: any) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.id,
    data: { type: 'toolbar', uid: props.id },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const itemDef = resolveToolbarItem(props.itemId, props.tags)
    || AVAILABLE_ITEMS.find(i => i.id === props.itemId)
    || { label: 'Unknown', isStructure: false, color: '#888', id: props.itemId } as any;

  if (itemDef.isStructure) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        className="bndz-tb-chip bndz-tb-chip--structure"
        title={itemDef.label}
      >
        {itemDef.id === 'separator' ? '|' : itemDef.id === 'spacer' ? '⟷' : '↵'}
      </div>
    );
  }

  const isTag = String(props.itemId || '').startsWith('tag__') || itemDef.category === 'tags';
  const png = isTag ? undefined : launcherIconUrl(itemDef.id);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="bndz-tb-chip"
      title={itemDef.label}
    >
      {isTag ? (
        <TagGlyph color={itemDef.color || '#FACC15'} size={18} />
      ) : png ? (
        <img src={png} alt="" className="w-[18px] h-[18px] object-contain" draggable={false} />
      ) : (
        <Icons8Icon id="tag_manager" size={18} color={itemDef.color || '#FACC15'} />
      )}
    </div>
  );
}

export default function ToolbarConfigurator({
  onClose,
  availableTags = [],
}: {
  onClose: () => void;
  availableTags?: Array<{ id?: string; name?: string; label?: string; color?: string }>;
}) {
  const { config, updateConfig } = useAppConfig();
  const profiles = config.toolbarProfiles && config.toolbarProfiles.length > 0 ? config.toolbarProfiles : [[{ id: 'nav_back' }]];
  const [activeIndex, setActiveIndex] = useState(config.activeToolbarProfileIndex || 0);
  const [currentLayout, setCurrentLayout] = useState<{ uid: string; id: string }[]>(
    (profiles[activeIndex] || []).map((i: any) => ({ uid: Math.random().toString(36).substring(7), id: i.id }))
  );
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const searchRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    const activeData = active.data.current;

    if (activeData?.type === 'palette') {
      if (over && (over.id === TOOLBAR_ZONE || currentLayout.some(i => i.uid === over.id))) {
        setCurrentLayout(prev => [...prev, { uid: Math.random().toString(36).substring(7), id: activeData.itemId }]);
      }
      return;
    }

    if (activeData?.type === 'toolbar') {
      if (!over || over.id === TRASH_ZONE) {
        setCurrentLayout(items => items.filter(item => item.uid !== active.id));
        return;
      }
      if (over.id === TOOLBAR_ZONE) return;

      const oldIndex = currentLayout.findIndex(i => i.uid === active.id);
      const newIndex = currentLayout.findIndex(i => i.uid === over.id);
      if (oldIndex !== -1 && newIndex !== -1 && active.id !== over.id) {
        setCurrentLayout(items => arrayMove(items, oldIndex, newIndex));
      }
    }
  };

  const handleAddItem = (itemId: string) => {
    setCurrentLayout(prev => [...prev, { uid: Math.random().toString(36).substring(7), id: itemId }]);
  };

  const handleSave = () => {
    const newProfiles = [...profiles];
    newProfiles[activeIndex] = currentLayout.map(i => ({ id: i.id }));
    updateConfig({ toolbarProfiles: newProfiles, activeToolbarProfileIndex: activeIndex });
    onClose();
  };

  const handleAddNewProfile = () => {
    const newProfiles = [...profiles, [{ id: 'nav_back' }]];
    updateConfig({ toolbarProfiles: newProfiles, activeToolbarProfileIndex: newProfiles.length - 1 });
    setActiveIndex(newProfiles.length - 1);
    setCurrentLayout([{ uid: Math.random().toString(36).substring(7), id: 'nav_back' }]);
  };

  const handleClearToolbar = () => {
    setCurrentLayout([]);
  };

  const tagItems = useMemo(() => buildTagToolbarItems(availableTags), [availableTags]);
  const allPaletteItems = useMemo(() => [...AVAILABLE_ITEMS, ...tagItems], [tagItems]);
  const filteredItems = useMemo(() => {
    const q = search.toLowerCase();
    return allPaletteItems.filter(i => {
      if (activeCategory !== 'all' && i.category !== activeCategory) return false;
      return i.label.toLowerCase().includes(q) || i.id.includes(q);
    });
  }, [allPaletteItems, search, activeCategory]);

  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = { all: allPaletteItems.length };
    for (const cat of TOOLBAR_CATEGORIES) {
      map[cat.id] = allPaletteItems.filter(i => i.category === cat.id).length;
    }
    return map;
  }, [allPaletteItems]);

  return (
    <BndzWindowFrame
      title="Toolbar Designer"
      subtitle="Compose your command bar — drag, order, save"
      iconId="wrench"
      onClose={onClose}
      zIndexClass="z-[200]"
      widthClass="w-[min(1180px,calc(100vw-2rem))]"
      heightClass="h-[min(90vh,calc(100vh-2rem))]"
    >
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="bndz-tb-root flex flex-1 flex-col min-h-0 overflow-hidden">
          {/* Workshop header strip */}
          <div className="bndz-tb-header shrink-0">
            <div className="relative flex-1 min-w-0 max-w-[380px]">
              <Icons8Icon id="search" size={13} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50 pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search commands…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bndz-native-input w-full !py-2 !pl-8 !pr-3 !text-[12px]"
              />
            </div>
            <div className="bndz-tb-stats">
              <span><strong>{allPaletteItems.length}</strong> commands</span>
              <span><strong>{currentLayout.length}</strong> on bar</span>
              <span><strong>{profiles.length}</strong> profile{profiles.length === 1 ? '' : 's'}</span>
            </div>
            <div className="ml-auto flex items-center gap-2 shrink-0">
              <button type="button" className="bndz-hub-btn-ghost text-[11px] font-semibold px-3 py-1.5" onClick={handleClearToolbar}>
                Clear bar
              </button>
              <button type="button" className="bndz-hub-btn-primary text-[12px] font-semibold px-4 py-1.5 flex items-center gap-1.5" onClick={handleSave}>
                <Icons8Icon id="check" size={13} />
                Save toolbar
              </button>
            </div>
          </div>

          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Command library */}
            <aside className="bndz-tb-library w-[42%] min-w-[300px] max-w-[440px] flex flex-col border-r border-white/[0.06] min-h-0">
              <div className="bndz-tb-cat-rail shrink-0 px-3 py-2.5 flex flex-wrap gap-1.5 border-b border-white/[0.05]">
                <button
                  type="button"
                  onClick={() => setActiveCategory('all')}
                  className={`bndz-tb-cat ${activeCategory === 'all' ? 'bndz-tb-cat--active' : ''}`}
                >
                  All
                  <span className="bndz-tb-cat-count">{categoryCounts.all}</span>
                </button>
                {TOOLBAR_CATEGORIES.map(cat => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setActiveCategory(cat.id)}
                    className={`bndz-tb-cat ${activeCategory === cat.id ? 'bndz-tb-cat--active' : ''}`}
                    style={activeCategory === cat.id ? {
                      backgroundColor: `${cat.color}1a`,
                      borderColor: `${cat.color}55`,
                      color: cat.color,
                    } : undefined}
                  >
                    {cat.label}
                    <span className="bndz-tb-cat-count">{categoryCounts[cat.id] || 0}</span>
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto styled-scrollbar p-2 min-h-0">
                {filteredItems.length === 0 ? (
                  <div className="px-4 py-14 text-center text-[12px] text-white/35">
                    {search.trim() ? 'No commands match your search.' : 'No commands in this category.'}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {filteredItems.map(item => (
                      <PaletteDraggable key={item.id} item={item} onAdd={() => handleAddItem(item.id)} />
                    ))}
                  </div>
                )}
              </div>
            </aside>

            {/* Canvas / preview */}
            <section className="flex-1 flex flex-col min-h-0 bg-black/15">
              <div className="bndz-tb-profile-bar shrink-0 px-4 py-3 flex items-center gap-3 border-b border-white/[0.06]">
                <span className="text-[10px] uppercase tracking-[0.14em] text-white/35 font-semibold">Profile</span>
                <select
                  value={activeIndex}
                  onChange={e => {
                    const idx = parseInt(e.target.value, 10);
                    setActiveIndex(idx);
                    setCurrentLayout((profiles[idx] || []).map((i: any) => ({
                      uid: Math.random().toString(36).substring(7),
                      id: i.id,
                    })));
                  }}
                  className="bndz-native-input !w-auto !py-1.5 !px-3 !text-[12px] min-w-[140px]"
                >
                  {profiles.map((_, i) => (
                    <option key={i} value={i}>Toolbar {i + 1}</option>
                  ))}
                </select>
                <button type="button" className="bndz-hub-btn-ghost text-[11px] font-semibold px-2.5 py-1.5" onClick={handleAddNewProfile}>
                  + New profile
                </button>
                <span className="ml-auto text-[11px] text-white/30 hidden sm:inline">
                  Reorder by dragging · drop on remove zone to delete
                </span>
              </div>

              <div className="flex-1 p-5 flex flex-col gap-4 min-h-0 overflow-y-auto styled-scrollbar">
                <div>
                  <div className="bndz-tb-section-label mb-2.5">Live preview</div>
                  <div className="bndz-tb-chrome">
                    <div className="bndz-tb-chrome-caption">
                      <span className="w-2 h-2 rounded-[3px] bg-[#e81123]/80" />
                      <span className="w-2 h-2 rounded-[3px] bg-[#f7c948]/80" />
                      <span className="w-2 h-2 rounded-[3px] bg-[#3cc66d]/80" />
                      <span className="ml-2 text-[10px] text-white/30 tracking-wide">BNDZ toolbar</span>
                    </div>
                    <ToolbarDropZone empty={currentLayout.length === 0}>
                      <SortableContext items={currentLayout.map(i => i.uid)} strategy={rectSortingStrategy}>
                        {currentLayout.map(item => {
                          if (item.id === 'new_row') {
                            return <div key={item.uid} className="w-full h-0 mb-2 basis-full" />;
                          }
                          return <SortableItem key={item.uid} id={item.uid} itemId={item.id} tags={availableTags} />;
                        })}
                      </SortableContext>
                    </ToolbarDropZone>
                  </div>
                </div>

                <TrashDropZone />

                <div className="bndz-tb-hint">
                  <Icons8Icon id="help_ui" size={13} className="opacity-50 shrink-0 mt-0.5" />
                  <p>
                    Click a library command to pin it instantly, or drag to place. Structure items
                    (separator, spacer, new row) shape the bar layout without adding actions.
                  </p>
                </div>
              </div>
            </section>
          </div>
        </div>
      </DndContext>
    </BndzWindowFrame>
  );
}
