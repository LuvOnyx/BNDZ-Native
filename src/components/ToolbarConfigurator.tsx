import React, { useMemo, useState } from 'react';
import { useAppConfig } from '../data/configContext';
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
import { 
    ArrowLeft, ArrowRight, ArrowUp, Monitor, Scissors, Copy, Clipboard, 
    Trash2, Undo, Redo, RefreshCw, Settings, Wrench, Grid, Save, Plus, Terminal, Activity, Table, FolderPlus, List, Shield, Archive, SquareTerminal, Command, HardDrive,
    FilePlus, CheckSquare, Combine, Share2, Disc, Network, FileArchive, MousePointerClick, Info, Puzzle,
    Search, Tag, Wand2, Palette, Layers, Filter, LayoutGrid, FolderSearch,
    TextCursorInput, Menu, Database, ClipboardCopy, Columns, Eye, PanelBottom, Recycle, FolderInput,
    Sliders, Cpu, Printer, Flame, Battery, Users, Keyboard, StickyNote, Calculator, Paintbrush, Camera,
    Globe, Server, Zap, BookOpen, Home, FolderOpen
} from 'lucide-react';

export type ToolbarItemDef = {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string; fill?: string; className?: string }> | null;
  color?: string;
  isStructure?: boolean;
  category?: string;
  description?: string;
};

export const TOOLBAR_CATEGORIES = [
  { id: 'navigation', label: 'Navigation', color: '#3b82f6' },
  { id: 'clipboard', label: 'Clipboard & Selection', color: '#eab308' },
  { id: 'files', label: 'Files & Folders', color: '#dcb67a' },
  { id: 'views', label: 'Views & Panels', color: '#a855f7' },
  { id: 'plugins', label: 'Plugins & Tools', color: '#ec4899' },
  { id: 'windows', label: 'Windows OS', color: '#10b981' },
  { id: 'tags', label: 'Tags', color: '#fbbf24' },
  { id: 'layout', label: 'Layout', color: '#6db4e6' },
  { id: 'structure', label: 'Layout Structure', color: '#94a3b8' },
] as const;

export const AVAILABLE_ITEMS: ToolbarItemDef[] = [
  { id: 'nav_back', label: 'Back', icon: ArrowLeft, color: '#3b82f6', category: 'navigation' },
  { id: 'nav_forward', label: 'Forward', icon: ArrowRight, color: '#3b82f6', category: 'navigation' },
  { id: 'nav_up', label: 'Up One Level', icon: ArrowUp, color: '#10b981', category: 'navigation' },
  { id: 'go_home', label: 'Go Home', icon: Home, color: '#6db4e6', category: 'navigation' },
  { id: 'refresh', label: 'Refresh', icon: RefreshCw, color: '#10b981', category: 'navigation' },
  { id: 'folder_size_sync', label: 'Auto Sync Folder Sizes', icon: FolderSearch, color: '#34d399', category: 'navigation' },
  { id: 'go_recycle_bin', label: 'Open Recycle Bin', icon: Recycle, color: '#c084fc', category: 'navigation' },
  { id: 'go_network', label: 'Open Network', icon: Network, color: '#38bdf8', category: 'navigation' },
  { id: 'new_tab', label: 'New Tab', icon: FolderInput, color: '#fbbf24', category: 'navigation' },
  { id: 'cut', label: 'Cut', icon: Scissors, color: '#eab308', category: 'clipboard' },
  { id: 'copy', label: 'Copy', icon: Copy, color: '#3b82f6', category: 'clipboard' },
  { id: 'paste', label: 'Paste', icon: Clipboard, color: '#eab308', category: 'clipboard' },
  { id: 'delete', label: 'Delete', icon: Trash2, color: '#ef4444', category: 'clipboard' },
  { id: 'undo', label: 'Undo', icon: Undo, color: '#3b82f6', category: 'clipboard' },
  { id: 'redo', label: 'Redo', icon: Redo, color: '#3b82f6', category: 'clipboard' },
  { id: 'select_all', label: 'Select All', icon: CheckSquare, color: '#3b82f6', category: 'clipboard' },
  { id: 'invert_selection', label: 'Invert Selection', icon: Combine, color: '#a855f7', category: 'clipboard' },
  { id: 'copy_path', label: 'Copy Path', icon: ClipboardCopy, color: '#93c5fd', category: 'clipboard' },
  { id: 'new_folder', label: 'New Folder', icon: FolderPlus, color: '#dcb67a', category: 'files' },
  { id: 'new_file', label: 'New File', icon: FilePlus, color: '#cbd5e1', category: 'files' },
  { id: 'compress', label: 'Compress (Zip)', icon: FileArchive, color: '#eab308', category: 'files' },
  { id: 'extract', label: 'Extract Archive', icon: Archive, color: '#f59e0b', category: 'files' },
  { id: 'properties', label: 'Properties', icon: Info, color: '#888', category: 'files' },
  { id: 'sync_folders', label: 'Sync / Compare', icon: RefreshCw, color: '#9333ea', category: 'files' },
  { id: 'map_network_drive', label: 'Map Network Drive', icon: Network, color: '#10b981', category: 'files' },
  { id: 'share', label: 'Network Share', icon: Share2, color: '#3b82f6', category: 'files' },
  { id: 'burn_disc', label: 'Burn to Disc', icon: Disc, color: '#94a3b8', category: 'files' },
  { id: 'view_details', label: 'Details View', icon: List, color: '#dcb67a', category: 'views' },
  { id: 'view_grid', label: 'Grid View', icon: LayoutGrid, color: '#a855f7', category: 'views' },
  { id: 'view_list', label: 'List View', icon: List, color: '#94a3b8', category: 'views' },
  { id: 'search', label: 'Focus Search', icon: Search, color: '#38bdf8', category: 'views' },
  { id: 'toggle_dual_pane', label: 'Toggle Dual Pane', icon: Columns, color: '#6db4e6', category: 'views' },
  { id: 'toggle_preview', label: 'Toggle Preview', icon: Eye, color: '#6db4e6', category: 'views' },
  { id: 'toggle_bottom', label: 'Toggle Bottom Panel', icon: PanelBottom, color: '#6db4e6', category: 'views' },
  { id: 'smart_tools', label: 'Smart Tools', icon: Wand2, color: '#f472b6', category: 'plugins' },
  { id: 'tag_manager', label: 'Tag Manager', icon: Tag, color: '#fbbf24', category: 'plugins' },
  { id: 'icon_studio', label: 'Icon Studio', icon: Palette, color: '#ec4899', category: 'plugins' },
  { id: 'find', label: 'Fast Search', icon: Search, color: '#0ea5e9', category: 'plugins' },
  { id: 'dropstack', label: 'Drop Stack', icon: Layers, color: '#8b5cf6', category: 'plugins' },
  { id: 'filters', label: 'Visual Filters', icon: Filter, color: '#22d3ee', category: 'plugins' },
  { id: 'batch_rename', label: 'Batch Rename', icon: TextCursorInput, color: '#fb923c', category: 'plugins' },
  { id: 'shell_menus', label: 'Shell Menus', icon: Menu, color: '#60a5fa', category: 'plugins' },
  { id: 'metadata', label: 'Metadata', icon: Database, color: '#2dd4bf', category: 'plugins' },
  { id: 'storage_cleanup', label: 'Storage Cleanup', icon: HardDrive, color: '#f87171', category: 'plugins' },
  { id: 'sys_properties', label: 'BNDZ Properties', icon: Layers, color: '#c084fc', category: 'plugins' },
  { id: 'config', label: 'Configuration', icon: Settings, color: '#888', category: 'plugins' },
  { id: 'extension_hub', label: 'Extension Hub', icon: Puzzle, color: '#a475d4', category: 'plugins' },
  { id: 'wrench', label: 'Customize Toolbar', icon: Wrench, color: '#3b82f6', category: 'plugins' },
  { id: 'cmd', label: 'Command Prompt', icon: SquareTerminal, color: '#eee', category: 'windows' },
  { id: 'ps', label: 'PowerShell', icon: Terminal, color: '#3b82f6', category: 'windows' },
  { id: 'terminal_here', label: 'Terminal Here', icon: Command, color: '#4ade80', category: 'windows' },
  { id: 'taskmgr', label: 'Task Manager', icon: Activity, color: '#10b981', category: 'windows' },
  { id: 'regedit', label: 'Registry Editor', icon: Grid, color: '#eab308', category: 'windows' },
  { id: 'control_panel', label: 'Control Panel', icon: Sliders, color: '#38bdf8', category: 'windows' },
  { id: 'settings_app', label: 'Windows Settings', icon: Settings, color: '#60a5fa', category: 'windows' },
  { id: 'device_manager', label: 'Device Manager', icon: Cpu, color: '#34d399', category: 'windows' },
  { id: 'services', label: 'Services', icon: Server, color: '#94a3b8', category: 'windows' },
  { id: 'event_viewer', label: 'Event Viewer', icon: BookOpen, color: '#f59e0b', category: 'windows' },
  { id: 'disk_mgmt', label: 'Disk Management', icon: HardDrive, color: '#f87171', category: 'windows' },
  { id: 'computer_mgmt', label: 'Computer Management', icon: Monitor, color: '#6db4e6', category: 'windows' },
  { id: 'sysdm_cpl', label: 'System Properties', icon: Info, color: '#c084fc', category: 'windows' },
  { id: 'network_connections', label: 'Network Connections', icon: Globe, color: '#38bdf8', category: 'windows' },
  { id: 'printers', label: 'Printers', icon: Printer, color: '#a78bfa', category: 'windows' },
  { id: 'programs_features', label: 'Programs & Features', icon: Archive, color: '#fb923c', category: 'windows' },
  { id: 'firewall', label: 'Windows Firewall', icon: Flame, color: '#ef4444', category: 'windows' },
  { id: 'power_options', label: 'Power Options', icon: Battery, color: '#fbbf24', category: 'windows' },
  { id: 'user_accounts', label: 'User Accounts', icon: Users, color: '#60a5fa', category: 'windows' },
  { id: 'msinfo', label: 'System Information', icon: Info, color: '#94a3b8', category: 'windows' },
  { id: 'dxdiag', label: 'DirectX Diagnostic', icon: Zap, color: '#a855f7', category: 'windows' },
  { id: 'notepad', label: 'Notepad', icon: StickyNote, color: '#e2e8f0', category: 'windows' },
  { id: 'calc', label: 'Calculator', icon: Calculator, color: '#38bdf8', category: 'windows' },
  { id: 'paint', label: 'Paint', icon: Paintbrush, color: '#ec4899', category: 'windows' },
  { id: 'snipping_tool', label: 'Snipping Tool', icon: Camera, color: '#34d399', category: 'windows' },
  { id: 'explorer', label: 'File Explorer', icon: FolderOpen, color: '#dcb67a', category: 'windows' },
  { id: 'magnifier', label: 'Magnifier', icon: Search, color: '#f472b6', category: 'windows' },
  { id: 'osk', label: 'On-Screen Keyboard', icon: Keyboard, color: '#94a3b8', category: 'windows' },
  { id: 'separator', label: 'Separator (|)', icon: null, isStructure: true, category: 'structure' },
  { id: 'spacer', label: 'Spacer', icon: null, isStructure: true, category: 'structure' },
  { id: 'new_row', label: 'New Row', icon: null, isStructure: true, category: 'structure' },
];

export function resolveToolbarItem(id: string, tags?: Array<{ id?: string; name?: string; label?: string; color?: string }>): ToolbarItemDef | undefined {
  if (id.startsWith('tag__')) {
    const tagId = id.slice(5);
    const tag = tags?.find(t => (t.id || t.name) === tagId);
    if (tag) {
      return { id, label: `Tag: ${tag.label || tag.name}`, icon: Tag, color: tag.color || '#fbbf24', category: 'tags' };
    }
  }
  return AVAILABLE_ITEMS.find(i => i.id === id);
}

export function buildTagToolbarItems(tags: Array<{ id?: string; name?: string; label?: string; color?: string }>): ToolbarItemDef[] {
  return (tags || []).map(t => ({
    id: `tag__${t.id || t.name}`,
    label: `Apply ${t.label || t.name}`,
    icon: Tag,
    color: t.color || '#fbbf24',
    category: 'tags',
  }));
}

const TOOLBAR_ZONE = 'toolbar-zone';
const TRASH_ZONE = 'trash-zone';

const ListItemIcon = ({ item }: { item: any }) => {
  if (item.isStructure) {
    return <div className="w-5 text-center text-[#888] font-mono font-bold text-xs">{(item.id === 'separator' ? '|' : item.id === 'spacer' ? '< >' : '---')}</div>;
  }
  return item.icon ? <item.icon size={16} color={item.color || '#ccc'} fill={item.color || "none"} className="drop-shadow-md" /> : null;
};

function PaletteDraggable({ item, onAdd }: { item: typeof AVAILABLE_ITEMS[0]; onAdd: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${item.id}`,
    data: { type: 'palette', itemId: item.id },
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      className={`group w-full flex items-center justify-between p-2 hover:bg-white/[0.04] rounded-lg cursor-grab active:cursor-grabbing border border-transparent hover:border-white/10 transition-all text-left ${isDragging ? 'opacity-40' : ''}`}
      onClick={onAdd}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-md bg-[#111] border border-[#333] flex items-center justify-center shrink-0">
          <ListItemIcon item={item} />
        </div>
        <span className="text-sm truncate">{item.label}</span>
      </div>
      <Plus size={14} className="text-[#3b82f6] opacity-60 group-hover:opacity-100 shrink-0" />
    </button>
  );
}

function ToolbarDropZone({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: TOOLBAR_ZONE });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border min-h-[48px] flex px-3 py-2 items-center flex-wrap shadow-inner relative transition-all ${
        isOver ? 'border-sky-500/60 bg-sky-950/20 ring-1 ring-sky-500/30' : 'border-[#444] bg-gradient-to-b from-[#2a2a30] to-[#222228]'
      }`}
    >
      {children}
    </div>
  );
}

function TrashDropZone() {
  const { setNodeRef, isOver } = useDroppable({ id: TRASH_ZONE });
  return (
    <div
      ref={setNodeRef}
      className={`mt-3 py-3 px-4 rounded-lg border border-dashed text-center text-xs transition-colors ${
        isOver ? 'border-red-400 bg-red-950/30 text-red-300' : 'border-[#444] text-gray-500'
      }`}
    >
      Drag toolbar items here to remove
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

  const itemDef = AVAILABLE_ITEMS.find(i => i.id === props.itemId) || { label: 'Unknown', isStructure: false, color: '#888' } as any;

  if (itemDef.isStructure) {
      return (
          <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="px-2 py-1 bg-[#333] border border-[#555] rounded text-xs text-gray-300 mx-1 flex items-center justify-center cursor-move h-8 min-w-[32px]">
              {itemDef.id === 'separator' ? '|' : itemDef.id === 'spacer' ? '< >' : '---'}
          </div>
      );
  }

  const Icon = itemDef.icon || Plus;
  const [imgError, setImgError] = React.useState(false);

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="p-1.5 hover:bg-[#444] rounded cursor-move group relative flex items-center justify-center h-8 w-8 mx-0.5">
       <Icon size={18} color={itemDef.color || '#ccc'} fill={itemDef.color || "none"} className="drop-shadow-md" />
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
    const profiles = config.toolbarProfiles && config.toolbarProfiles.length > 0 ? config.toolbarProfiles : [[{ id: "nav_back" }]];
    const [activeIndex, setActiveIndex] = useState(config.activeToolbarProfileIndex || 0);
    const [currentLayout, setCurrentLayout] = useState<{ uid: string, id: string }[]>(
        (profiles[activeIndex] || []).map((i: any) => ({ uid: Math.random().toString(36).substring(7), id: i.id }))
    );
    const [search, setSearch] = useState('');

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
        const newProfiles = [...profiles, [{ id: "nav_back" }]];
        updateConfig({ toolbarProfiles: newProfiles, activeToolbarProfileIndex: newProfiles.length - 1 });
        setActiveIndex(newProfiles.length - 1);
        setCurrentLayout([{ uid: Math.random().toString(36).substring(7), id: "nav_back" }]);
    };

    const [activeCategory, setActiveCategory] = useState<string>('all');
    const tagItems = useMemo(() => buildTagToolbarItems(availableTags), [availableTags]);
    const allPaletteItems = useMemo(() => [...AVAILABLE_ITEMS, ...tagItems], [tagItems]);
    const filteredItems = useMemo(() => {
        const q = search.toLowerCase();
        return allPaletteItems.filter(i => {
            if (activeCategory !== 'all' && i.category !== activeCategory) return false;
            return i.label.toLowerCase().includes(q) || i.id.includes(q);
        });
    }, [allPaletteItems, search, activeCategory]);

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[200] p-4 text-gray-200">
            <div className="bg-gradient-to-br from-[#1c1c22] to-[#141418] border border-white/10 shadow-2xl rounded-2xl w-full max-w-6xl flex flex-col max-h-[88vh] overflow-hidden">
                <div className="px-5 py-4 border-b border-white/10 flex justify-between items-center bg-gradient-to-r from-[#252530]/90 to-[#1a1a22]/90 rounded-t-2xl">
                    <div>
                        <h2 className="text-lg font-bold flex items-center gap-2"><Wrench size={18} className="text-sky-400"/> Toolbar Designer</h2>
                        <p className="text-[11px] text-gray-500 mt-0.5">Drag commands onto the preview bar · {allPaletteItems.length} available</p>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors">✕</button>
                </div>
                
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <div className="flex flex-1 overflow-hidden min-h-0">
                    <div className="w-[38%] border-r border-white/10 flex flex-col bg-[#12121a]/80">
                        <div className="p-3 border-b border-white/5 space-y-2">
                           <input 
                              type="text" 
                              placeholder="Search commands…" 
                              value={search}
                              onChange={e => setSearch(e.target.value)}
                              className="w-full bg-[#0d0d12] border border-[#444] rounded-lg px-3 py-2 text-sm outline-none focus:border-sky-500/60 focus:ring-1 focus:ring-sky-500/20"
                           />
                           <div className="flex flex-wrap gap-1">
                             <button type="button" onClick={() => setActiveCategory('all')} className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${activeCategory === 'all' ? 'bg-sky-600/30 border-sky-500/50 text-sky-200' : 'border-[#444] text-gray-500 hover:text-gray-300'}`}>All</button>
                             {TOOLBAR_CATEGORIES.map(cat => (
                               <button key={cat.id} type="button" onClick={() => setActiveCategory(cat.id)} className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${activeCategory === cat.id ? 'border-white/20 text-white' : 'border-[#444] text-gray-500 hover:text-gray-300'}`} style={activeCategory === cat.id ? { backgroundColor: `${cat.color}22`, borderColor: `${cat.color}55`, color: cat.color } : undefined}>{cat.label}</button>
                             ))}
                           </div>
                        </div>
                        <div className="flex-1 overflow-y-auto bndz-scrollbar p-2 min-h-0">
                           <div className="grid grid-cols-1 gap-1">
                               {filteredItems.map(item => (
                                   <PaletteDraggable key={item.id} item={item} onAdd={() => handleAddItem(item.id)} />
                               ))}
                               {!filteredItems.length && (
                                 <div className="text-center text-gray-500 text-sm py-8 italic">No commands match your search.</div>
                               )}
                           </div>
                        </div>
                    </div>

                    <div className="w-[62%] flex flex-col bg-[#18181e] min-h-0">
                        <div className="px-4 py-3 border-b border-white/10 flex justify-between items-center bg-[#1f1f28]/80">
                            <div className="flex items-center gap-3">
                                <span className="text-sm font-medium text-gray-400">Profile</span>
                                <select 
                                   value={activeIndex} 
                                   onChange={e => {
                                      const idx = parseInt(e.target.value);
                                      setActiveIndex(idx);
                                      setCurrentLayout((profiles[idx] || []).map((i: any) => ({ uid: Math.random().toString(36).substring(7), id: i.id })));
                                   }}
                                   className="bg-[#0d0d12] border border-[#555] rounded-lg px-3 py-1.5 text-sm outline-none focus:border-sky-500/50"
                                >
                                    {profiles.map((_, i) => (
                                        <option key={i} value={i}>Toolbar {i + 1}</option>
                                    ))}
                                </select>
                                <button className="text-xs bg-[#2a2a32] hover:bg-[#35353f] border border-[#555] px-2.5 py-1.5 rounded-lg transition-colors" onClick={handleAddNewProfile}>+ New profile</button>
                            </div>
                            <button onClick={handleSave} className="flex items-center gap-2 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-lg shadow-sky-900/30 transition-all">
                                <Save size={14} /> Save toolbar
                            </button>
                        </div>
                        <div className="flex-1 p-5 relative flex flex-col min-h-0">
                            <div className="text-[10px] text-gray-500 mb-3 font-semibold uppercase tracking-widest">Live preview</div>
                              <ToolbarDropZone>
                                <SortableContext items={currentLayout.map(i => i.uid)} strategy={rectSortingStrategy}>
                                  {currentLayout.map(item => {
                                    if (item.id === 'new_row') {
                                      return <div key={item.uid} className="w-full h-0 mb-2 basis-full" />;
                                    }
                                    return <SortableItem key={item.uid} id={item.uid} itemId={item.id} />;
                                  })}
                                </SortableContext>
                                {currentLayout.length === 0 && (
                                  <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500 italic pointer-events-none">
                                    Drag commands here or click + on the left
                                  </div>
                                )}
                              </ToolbarDropZone>
                              <TrashDropZone />
                        </div>
                    </div>
                </div>
                </DndContext>
            </div>
        </div>
    );
}
