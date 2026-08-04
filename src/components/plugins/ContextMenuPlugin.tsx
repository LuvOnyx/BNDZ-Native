import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAppConfig } from '../../data/configContext';
import { Icons8Icon } from '../Icons8Icon';
import { ContextMenuIcon } from '../ContextMenuIcon';
import { menuItemClass } from '../ContextSubmenu';
import { pushToast } from '../ToastHost';
import { IPC } from '../../lib/ipcBridge';
import { toWindowsPath } from '../../lib/pathUtils';
import { buildShellExecuteOptions } from '../../lib/shellExecuteRuntime';
import PluginPanelShell from './PluginPanelShell';
import {
  PRESET_CATEGORIES,
  STOCK_BNDZ_MENU,
  DEFAULT_STOCK_GLOBAL_ACTIONS,
  presetsForSurface,
  iconVerbForAction,
  type MenuActionSeed,
  type TargetMode,
} from '../../lib/shellMenuPresets';
import { ShellVerbForgePanel } from './ShellVerbForgePlugin';

export const ContextMenuPluginDef = {
  id: 'context-menu-manager',
  name: 'Shell Menus',
  icon: 'shell_menus',
};

type ShellTab = 'app' | 'global' | 'verbs';
type PreviewSurface = 'file' | 'folder' | 'background';

interface MenuAction {
  id: string;
  name: string;
  command: string;
  icon?: string;
  targetMode?: TargetMode;
  hasSubmenu?: boolean;
  iconVerb?: string;
}

interface ShellExtItem {
  id: string;
  label: string;
  verb?: string;
  commandId?: number;
  kind?: string;
  separator?: boolean;
}

const VARIABLE_HELP = [
  { token: '%1', desc: 'Full path of the right-clicked file or folder' },
  { token: '%V', desc: 'Multiple selected items (space-separated)' },
  { token: '%L', desc: 'Parent folder path' },
  { token: '%W', desc: 'Working directory (folder background)' },
];

const MENU_ZONE = 'menu-zone';
const TRASH_ZONE = 'trash-zone';
const KNOWN_APP_VERBS = new Set(['copyPath', 'openTerminal', 'openExplorer', 'refresh']);

function targetLabel(mode: TargetMode = 'all'): string {
  if (mode === 'directory') return 'Folders only';
  if (mode === 'background') return 'Folder background';
  return 'Files & folders';
}

function parentDir(winPath: string): string {
  if (!winPath) return '';
  const trimmed = winPath.replace(/\\+$/, '');
  const idx = trimmed.lastIndexOf('\\');
  if (idx <= 0) return trimmed;
  return trimmed.slice(0, idx);
}

function expandShellTokens(cmd: string, paths: string[]): string {
  const first = paths[0] || '';
  const parent = parentDir(first);
  const multi = paths.map(p => (/\s/.test(p) ? `"${p}"` : p)).join(' ');
  return cmd
    .replace(/%1/g, first)
    .replace(/%V/g, multi)
    .replace(/%L/g, parent)
    .replace(/%W/g, parent);
}

function uid(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function isSeparatorAction(ac: MenuAction): boolean {
  return ac.id === 'separator' || ac.command === 'separator' || ac.name === 'separator' || ac.name === '—';
}

/* ── Palette row ─────────────────────────────────────────────────────────── */

function PaletteDraggable({
  presetId,
  label,
  desc,
  categoryColor,
  onAdd,
}: {
  presetId: string;
  label: string;
  desc: string;
  categoryColor?: string;
  onAdd: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${presetId}`,
    data: { type: 'palette', presetId },
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      className={`bndz-cm-palette-row group ${isDragging ? 'bndz-cm-palette-row--dragging' : ''}`}
      onClick={onAdd}
      title={`Add “${label}” to your menu`}
    >
      <div className="bndz-cm-palette-icon" style={categoryColor ? { borderColor: `${categoryColor}55` } : undefined}>
        <Icons8Icon id="shell_menus" size={14} />
      </div>
      <div className="flex-1 min-w-0 text-left">
        <div className="text-[12px] font-semibold text-white/90 truncate leading-tight">{label}</div>
        <div className="text-[10px] text-white/35 truncate mt-0.5 leading-snug">{desc}</div>
      </div>
      <span className="bndz-cm-palette-add opacity-0 group-hover:opacity-100 transition-opacity">
        <Icons8Icon id="plus_ui" size={11} />
      </span>
    </button>
  );
}

function MenuDropZone({ children, empty }: { children: React.ReactNode; empty?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: MENU_ZONE });
  return (
    <div
      ref={setNodeRef}
      className={`bndz-cm-custom-zone ${isOver ? 'bndz-cm-custom-zone--over' : ''} ${empty ? 'bndz-cm-custom-zone--empty' : ''}`}
    >
      {children}
      {empty && (
        <div className="bndz-cm-custom-empty pointer-events-none">
          Drop presets here — they land in the live menu
        </div>
      )}
    </div>
  );
}

function TrashDropZone() {
  const { setNodeRef, isOver } = useDroppable({ id: TRASH_ZONE });
  return (
    <div ref={setNodeRef} className={`bndz-cm-trash ${isOver ? 'bndz-cm-trash--over' : ''}`}>
      <Icons8Icon id="delete" size={13} />
      <span>{isOver ? 'Release to remove' : 'Drag a custom item here to remove'}</span>
    </div>
  );
}

function PreviewStockRow({ label, iconVerb, submenu }: { label: string; iconVerb?: string; submenu?: boolean }) {
  return (
    <div className={`${menuItemClass} bndz-cm-stock-row`} aria-hidden>
      <span className="bndz-context-menu-icon w-[14px] flex justify-center">
        <ContextMenuIcon verb={iconVerb || 'filetext'} size={14} />
      </span>
      <span className="flex-1 truncate">{label}</span>
      {submenu && <Icons8Icon id="chevron_right" size={10} className="opacity-40" />}
    </div>
  );
}

function SortableCustomRow({
  action,
  selected,
  onSelect,
}: {
  action: MenuAction;
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: action.id,
    data: { type: 'menu', uid: action.id },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };
  if (isSeparatorAction(action)) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        className={`bndz-cm-sep-handle ${selected ? 'bndz-cm-custom-row--selected' : ''}`}
        onClick={onSelect}
        title="Separator — drag to reorder"
      >
        <div className="bndz-context-menu-sep !mx-2 flex-1" />
      </div>
    );
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`${menuItemClass} bndz-cm-custom-row ${selected ? 'bndz-cm-custom-row--selected' : ''}`}
      onClick={onSelect}
      title="Drag to reorder · click to edit"
    >
      <span className="bndz-context-menu-icon w-[14px] flex justify-center">
        <ContextMenuIcon verb={iconVerbForAction(action)} size={14} />
      </span>
      <span className="flex-1 truncate font-medium">{action.name || 'Untitled'}</span>
      <span className="bndz-cm-custom-badge">yours</span>
    </div>
  );
}

export default function ContextMenuPlugin({
  selectedItems,
  focusedPath,
}: {
  selectedItems?: string[];
  focusedPath?: string;
}) {
  const { config, updateConfig } = useAppConfig();
  const [tab, setTab] = useState<ShellTab>('app');
  const [appActions, setAppActions] = useState<MenuAction[]>(() =>
    ((config.customContextMenuActions as MenuAction[]) || []).map(a => ({ ...a, id: a.id || uid() })),
  );
  const [globalActions, setGlobalActions] = useState<MenuAction[]>([]);
  const [previewSurface, setPreviewSurface] = useState<PreviewSurface>('file');
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [shellItems, setShellItems] = useState<ShellExtItem[]>([]);
  const [shellLoading, setShellLoading] = useState(false);
  const [shellError, setShellError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const hiddenShellIds: string[] = Array.isArray(config.shellMenuHiddenIds) ? config.shellMenuHiddenIds : [];
  const pinnedShellIds: string[] = Array.isArray(config.shellMenuPinnedIds) ? config.shellMenuPinnedIds : [];

  useEffect(() => {
    setGlobalActions(((config.globalContextMenuActions as MenuAction[]) || []).map(a => ({ ...a, id: a.id || uid() })));
  }, [config.globalContextMenuActions]);

  useEffect(() => {
    setAppActions(((config.customContextMenuActions as MenuAction[]) || []).map(a => ({ ...a, id: a.id || uid() })));
  }, [config.customContextMenuActions]);

  const actions = tab === 'global' ? globalActions : appActions;
  const setActions = tab === 'global' ? setGlobalActions : setAppActions;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const presets = useMemo(() => {
    const surface = tab === 'global' ? 'global' : 'app';
    return presetsForSurface(surface);
  }, [tab]);

  const filteredPresets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return presets.filter(p => {
      if (activeCategory !== 'all' && p.category !== activeCategory) return false;
      if (!q) return true;
      return (
        p.label.toLowerCase().includes(q)
        || p.desc.toLowerCase().includes(q)
        || p.action.command.toLowerCase().includes(q)
        || p.category.toLowerCase().includes(q)
      );
    });
  }, [presets, search, activeCategory]);

  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = { all: presets.length };
    for (const cat of PRESET_CATEGORIES) {
      if (cat.id === 'all') continue;
      map[cat.id] = presets.filter(p => p.category === cat.id).length;
    }
    return map;
  }, [presets]);

  const stockRows = useMemo(
    () => STOCK_BNDZ_MENU.filter(r => r.surfaces.includes(previewSurface)),
    [previewSurface],
  );

  const selectedAction = actions.find(a => a.id === selectedId) || null;

  const resolveTestPaths = (): string[] => {
    if (selectedItems?.length) return selectedItems.map(p => toWindowsPath(p)).filter(Boolean);
    if (focusedPath) {
      const p = toWindowsPath(focusedPath);
      return p ? [p] : [];
    }
    return [];
  };

  const persistActions = (mode: ShellTab, next: MenuAction[]) => {
    if (mode === 'global') {
      setGlobalActions(next);
      updateConfig({ globalContextMenuActions: next, injectGlobalContextMenu: true } as Partial<typeof config>);
    } else {
      setAppActions(next);
      updateConfig({ customContextMenuActions: next });
    }
  };

  const addFromSeed = (seed: MenuActionSeed | Partial<MenuAction>) => {
    if (seed.command === 'separator' || seed.name === 'separator' || seed.name === '—') {
      const sep: MenuAction = { id: 'separator', name: 'separator', command: 'separator' };
      // unique id for sortable
      const row: MenuAction = { ...sep, id: `separator_${uid()}` };
      setActions(prev => {
        const next = [...prev, row];
        persistActions(tab === 'global' ? 'global' : 'app', next);
        return next;
      });
      setSelectedId(row.id);
      return;
    }
    const row: MenuAction = {
      id: uid(),
      name: seed.name || 'Custom command',
      command: seed.command || '',
      icon: seed.icon,
      targetMode: seed.targetMode || 'all',
      iconVerb: seed.iconVerb,
    };
    setActions(prev => {
      const next = [...prev, row];
      persistActions(tab === 'global' ? 'global' : 'app', next);
      return next;
    });
    setSelectedId(row.id);
  };

  const addPresetById = (presetId: string) => {
    const p = presets.find(x => x.id === presetId);
    if (p) addFromSeed(p.action);
  };

  const updateSelected = (patch: Partial<MenuAction>) => {
    if (!selectedId) return;
    setActions(prev => {
      const next = prev.map(a => (a.id === selectedId ? { ...a, ...patch } : a));
      persistActions(tab === 'global' ? 'global' : 'app', next);
      return next;
    });
  };

  const removeSelected = () => {
    if (!selectedId) return;
    setActions(prev => {
      const next = prev.filter(a => a.id !== selectedId);
      persistActions(tab === 'global' ? 'global' : 'app', next);
      return next;
    });
    setSelectedId(null);
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    const activeData = active.data.current;
    const mode = tab === 'global' ? 'global' : 'app';

    if (activeData?.type === 'palette') {
      if (over && (over.id === MENU_ZONE || actions.some(a => a.id === over.id))) {
        addPresetById(activeData.presetId);
      }
      return;
    }

    if (activeData?.type === 'menu') {
      if (!over || over.id === TRASH_ZONE) {
        setActions(prev => {
          const next = prev.filter(a => a.id !== active.id);
          persistActions(mode, next);
          return next;
        });
        if (selectedId === active.id) setSelectedId(null);
        return;
      }
      if (over.id === MENU_ZONE) return;
      const oldIndex = actions.findIndex(a => a.id === active.id);
      const newIndex = actions.findIndex(a => a.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1 && active.id !== over.id) {
        setActions(prev => {
          const next = arrayMove(prev, oldIndex, newIndex);
          persistActions(mode, next);
          return next;
        });
      }
    }
  };

  const refreshShellItems = async () => {
    const paths = resolveTestPaths();
    if (!paths.length) {
      setShellError('Select a file or folder in the list, then scan.');
      setShellItems([]);
      return;
    }
    setShellLoading(true);
    setShellError(null);
    try {
      const items = await IPC.fetchNativeContextMenuItems(paths[0]);
      setShellItems((items || []).filter((i: ShellExtItem) => !i.separator && i.kind !== 'builtin'));
    } catch (err: any) {
      setShellError(String(err?.message || err || 'Scan failed'));
      setShellItems([]);
    } finally {
      setShellLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'global') void refreshShellItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const toggleShellHidden = (id: string) => {
    const next = hiddenShellIds.includes(id)
      ? hiddenShellIds.filter(x => x !== id)
      : [...hiddenShellIds, id];
    updateConfig({ shellMenuHiddenIds: next });
  };

  const toggleShellPinned = (id: string) => {
    const next = pinnedShellIds.includes(id)
      ? pinnedShellIds.filter(x => x !== id)
      : [...pinnedShellIds, id];
    updateConfig({ shellMenuPinnedIds: next });
  };

  const previewToast = (command: string, paths: string[]) => {
    pushToast({
      kind: 'info',
      title: 'Would run (preview)',
      message: `${command}\n\nPaths:\n${paths.length ? paths.join('\n') : '(no paths)'}`,
    });
  };

  const testOnSelection = (ac: MenuAction) => {
    const cmd = (ac.command || '').trim();
    const paths = resolveTestPaths();
    if (!cmd || cmd === 'separator') {
      pushToast({ kind: 'warning', title: 'No command', message: 'Enter a command before testing.' });
      return;
    }
    if (!paths.length) {
      pushToast({ kind: 'warning', title: 'Nothing selected', message: 'Select files or folders in the list, then try again.' });
      return;
    }
    if (cmd === 'refresh' || cmd === 'bndz-open-path') {
      previewToast(cmd, paths);
      return;
    }
    const shellOpts = buildShellExecuteOptions(config);
    const workingDir = parentDir(paths[0]) || undefined;
    if (tab === 'app' && KNOWN_APP_VERBS.has(cmd)) {
      if (!IPC.isNative && cmd !== 'copyPath') {
        previewToast(cmd, paths);
        return;
      }
      IPC.shellExecute(cmd, paths, undefined, shellOpts);
      pushToast({ kind: 'success', title: 'Ran on selection', message: `${ac.name || cmd} → ${paths.length} path(s)` });
      return;
    }
    const expanded = expandShellTokens(cmd, paths);
    if (!IPC.isNative) {
      previewToast(expanded, paths);
      return;
    }
    IPC.shellExecute('runCommand', expanded, workingDir, shellOpts);
    pushToast({ kind: 'success', title: 'Ran on selection', message: `${ac.name || 'Command'} → ${paths.length} path(s)` });
  };

  const saveAppActions = () => {
    updateConfig({ customContextMenuActions: appActions });
    pushToast({ kind: 'success', title: 'Saved', message: 'Inside-BNDZ menu updated.' });
  };

  const saveGlobalActions = async () => {
    try {
      let toDeploy = globalActions;
      if (!toDeploy.filter(a => !isSeparatorAction(a)).length) {
        toDeploy = DEFAULT_STOCK_GLOBAL_ACTIONS.map(a => ({
          id: a.id,
          name: a.name,
          command: a.command,
          iconVerb: a.iconVerb,
          targetMode: a.targetMode || 'all',
        }));
        setGlobalActions(toDeploy);
        pushToast({ kind: 'info', title: 'Seeded stock verbs', message: 'Empty list — added Open in BNDZ, Problems, Inbound, and RAM Staging.' });
      }
      updateConfig({ globalContextMenuActions: toDeploy, injectGlobalContextMenu: true } as Partial<typeof config>);
      if (!IPC.updateGlobalContextMenu) {
        pushToast({ kind: 'warning', title: 'Native host required', message: 'Shell menu deployment is only available in the BNDZ native app.' });
        return;
      }
      const payload = toDeploy.filter(a => !isSeparatorAction(a)).map(a => ({
        id: a.id,
        label: a.name,
        name: a.name,
        command: a.command,
        icon: a.icon,
        targetMode: a.targetMode,
      }));
      const ok = await IPC.updateGlobalContextMenu(payload);
      pushToast(ok
        ? { kind: 'success', title: 'Deployed', message: 'Explorer menus updated (HKCU). New items appear after Explorer refreshes — no admin required.' }
        : { kind: 'error', title: 'Deploy failed', message: 'Could not write per-user shell keys. Check antivirus / Controlled Folder Access, then retry.' });
    } catch (err: any) {
      pushToast({ kind: 'error', title: 'Deploy error', message: String(err?.message || err) });
    }
  };

  const selectIcon = async () => {
    if (!selectedId) return;
    const files = await IPC.openFileDialog('Icons (*.ico;*.png)|*.ico;*.png');
    if (!files?.length) return;
    let path = files[0];
    if (path.endsWith('.png') && (IPC as { convertToIco?: (p: string) => Promise<string> }).convertToIco) {
      path = await (IPC as { convertToIco: (p: string) => Promise<string> }).convertToIco(path) || path;
    }
    updateSelected({ icon: path });
  };

  const selectionHint = selectedItems?.length
    ? `${selectedItems.length} selected — used when testing`
    : focusedPath
      ? 'Focused path ready for test'
      : 'Select items in the list to test commands';

  const renderDesigner = () => (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="bndz-cm-root flex flex-col min-h-[min(520px,70vh)]">
        <div className="bndz-cm-header shrink-0">
          <div className="relative flex-1 min-w-0 max-w-[320px]">
            <Icons8Icon id="search" size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-45 pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search presets…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bndz-native-input w-full !py-1.5 !pl-8 !pr-3 !text-[11.5px]"
            />
          </div>
          <div className="bndz-cm-stats">
            <span><strong>{presets.length}</strong> presets</span>
            <span><strong>{actions.length}</strong> custom</span>
            <span className="hidden sm:inline opacity-70">{selectionHint}</span>
          </div>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <button
              type="button"
              className="bndz-hub-btn-ghost text-[11px] font-semibold px-2.5 py-1.5"
              onClick={() => addFromSeed({ name: 'Custom command', command: tab === 'global' ? 'C:\\Apps\\Tool.exe "%1"' : '', targetMode: 'all' })}
            >
              Custom…
            </button>
            {tab === 'global' ? (
              <>
                <button
                  type="button"
                  className="bndz-hub-btn-ghost text-[11px] font-semibold px-2.5 py-1.5"
                  onClick={() => {
                    const seeded = DEFAULT_STOCK_GLOBAL_ACTIONS.map(a => ({
                      id: a.id,
                      name: a.name,
                      command: a.command,
                      iconVerb: a.iconVerb,
                      targetMode: a.targetMode || 'all' as TargetMode,
                    }));
                    setGlobalActions(prev => {
                      const ids = new Set(prev.map(p => p.id));
                      const merged = [...prev];
                      for (const s of seeded) {
                        if (!ids.has(s.id)) merged.push(s);
                      }
                      return merged;
                    });
                    pushToast({ kind: 'success', title: 'Stock BNDZ verbs', message: 'Added Open in BNDZ, Problems, Inbound, RAM Staging. Click Deploy.' });
                  }}
                >
                  Stock BNDZ…
                </button>
                <button type="button" className="bndz-hub-btn-primary text-[11px] font-semibold px-3 py-1.5 flex items-center gap-1.5" onClick={() => void saveGlobalActions()}>
                  <Icons8Icon id="check" size={12} />
                  Deploy
                </button>
              </>
            ) : (
              <button type="button" className="bndz-hub-btn-primary text-[11px] font-semibold px-3 py-1.5 flex items-center gap-1.5" onClick={saveAppActions}>
                <Icons8Icon id="check" size={12} />
                Save menu
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Preset library */}
          <aside className="bndz-cm-library w-[44%] min-w-[240px] max-w-[420px] flex flex-col border-r border-white/[0.06] min-h-0">
            <div className="bndz-cm-cat-rail shrink-0 px-2.5 py-2 flex flex-wrap gap-1 border-b border-white/[0.05]">
              {PRESET_CATEGORIES.map(cat => {
                const count = categoryCounts[cat.id] ?? 0;
                if (cat.id !== 'all' && count === 0) return null;
                const active = activeCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setActiveCategory(cat.id)}
                    className={`bndz-cm-cat ${active ? 'bndz-cm-cat--active' : ''}`}
                    style={active ? {
                      backgroundColor: `${cat.color}1a`,
                      borderColor: `${cat.color}55`,
                      color: cat.color,
                    } : undefined}
                  >
                    {cat.label}
                    <span className="bndz-cm-cat-count">{count}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex-1 overflow-y-auto bndz-scrollbar p-2 min-h-0">
              {filteredPresets.length === 0 ? (
                <div className="px-3 py-10 text-center text-[11px] text-white/35">
                  No presets match.
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {filteredPresets.map(p => {
                    const cat = PRESET_CATEGORIES.find(c => c.id === p.category);
                    return (
                      <PaletteDraggable
                        key={p.id}
                        presetId={p.id}
                        label={p.label}
                        desc={p.desc}
                        categoryColor={cat?.color}
                        onAdd={() => addFromSeed(p.action)}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </aside>

          {/* Live preview canvas */}
          <section className="flex-1 flex flex-col min-h-0 bg-black/20">
            <div className="bndz-cm-surface-bar shrink-0 px-3 py-2 flex items-center gap-2 border-b border-white/[0.06]">
              <span className="text-[9px] uppercase tracking-[0.14em] text-white/35 font-semibold">Preview as</span>
              {([
                { id: 'file' as const, label: 'File' },
                { id: 'folder' as const, label: 'Folder' },
                { id: 'background' as const, label: 'Empty space' },
              ]).map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setPreviewSurface(s.id)}
                  className={`bndz-cm-surface-chip ${previewSurface === s.id ? 'bndz-cm-surface-chip--active' : ''}`}
                >
                  {s.label}
                </button>
              ))}
              <span className="ml-auto text-[10px] text-white/28 hidden lg:inline">
                Stock BNDZ items · your customs in the glow zone
              </span>
            </div>

            <div className="flex-1 p-4 flex flex-col gap-3 min-h-0 overflow-y-auto bndz-scrollbar">
              <div>
                <div className="bndz-cm-section-label mb-2">Live context menu</div>
                <div className="bndz-cm-chrome">
                  <div className="bndz-cm-chrome-caption">
                    <span className="bndz-cm-live-dot" aria-hidden />
                    <span className="text-[10px] text-white/45 tracking-[0.12em] font-semibold uppercase">
                      {tab === 'global' ? 'Windows Explorer menu' : 'BNDZ right-click'}
                    </span>
                    <span className="text-[10px] text-white/25">
                      {previewSurface === 'background' ? 'empty space' : previewSurface}
                    </span>
                  </div>

                  <div className="bndz-context-menu bndz-cm-menu-preview min-w-[240px] max-w-[320px] mx-auto my-3">
                    {tab === 'app' && stockRows.map(row => {
                      if (row.kind === 'sep') {
                        return <div key={row.id} className="bndz-context-menu-sep" />;
                      }
                      if (row.kind === 'zone') {
                        return (
                          <MenuDropZone key={row.id} empty={actions.length === 0}>
                            <SortableContext items={actions.map(a => a.id)} strategy={verticalListSortingStrategy}>
                              {actions.map(ac => (
                                <SortableCustomRow
                                  key={ac.id}
                                  action={ac}
                                  selected={selectedId === ac.id}
                                  onSelect={() => setSelectedId(ac.id)}
                                />
                              ))}
                            </SortableContext>
                          </MenuDropZone>
                        );
                      }
                      return (
                        <PreviewStockRow
                          key={row.id}
                          label={row.label}
                          iconVerb={row.iconVerb}
                          submenu={row.kind === 'submenu'}
                        />
                      );
                    })}

                    {tab === 'global' && (
                      <MenuDropZone empty={actions.length === 0}>
                        <div className="px-2.5 py-1 text-[9px] uppercase tracking-wider text-white/30">
                          Windows Explorer entries
                        </div>
                        <SortableContext items={actions.map(a => a.id)} strategy={verticalListSortingStrategy}>
                          {actions.map(ac => (
                            <SortableCustomRow
                              key={ac.id}
                              action={ac}
                              selected={selectedId === ac.id}
                              onSelect={() => setSelectedId(ac.id)}
                            />
                          ))}
                        </SortableContext>
                      </MenuDropZone>
                    )}
                  </div>
                </div>
              </div>

              <TrashDropZone />

              {selectedAction && !isSeparatorAction(selectedAction) && (
                <div className="bndz-cm-inspector">
                  <div className="bndz-cm-section-label mb-2">Edit selected</div>
                  <div className="grid sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="text-[10px] text-white/40 block mb-1">Menu label</label>
                      <input
                        className="bndz-native-input w-full !py-1.5 !text-[12px]"
                        value={selectedAction.name}
                        onChange={e => updateSelected({ name: e.target.value })}
                      />
                    </div>
                    {tab === 'global' && (
                      <div>
                        <label className="text-[10px] text-white/40 block mb-1">Show on</label>
                        <select
                          className="bndz-native-input w-full !py-1.5 !text-[12px]"
                          value={selectedAction.targetMode || 'all'}
                          onChange={e => updateSelected({ targetMode: e.target.value as TargetMode })}
                        >
                          <option value="all">Files & folders</option>
                          <option value="directory">Folders only</option>
                          <option value="background">Empty folder background</option>
                        </select>
                      </div>
                    )}
                  </div>
                  <div className="mt-2.5">
                    <label className="text-[10px] text-white/40 block mb-1">
                      {tab === 'global' ? 'Program to run' : 'Command / verb'}
                    </label>
                    <input
                      className="bndz-native-input w-full !py-1.5 !text-[12px] bndz-mono text-emerald-300/90"
                      value={selectedAction.command}
                      onChange={e => updateSelected({ command: e.target.value })}
                      placeholder={tab === 'global' ? 'C:\\Apps\\Tool.exe "%1"' : 'copyPath, openTerminal, notepad.exe "%1"…'}
                    />
                    {tab === 'global' && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {VARIABLE_HELP.map(v => (
                          <button
                            key={v.token}
                            type="button"
                            title={v.desc}
                            className="text-[10px] bndz-mono px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-cyan-300/90 hover:border-cyan-500/40"
                            onClick={() => updateSelected({ command: `${selectedAction.command || ''}${v.token}` })}
                          >
                            {v.token}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {tab === 'global' && (
                    <div className="mt-2.5">
                      <label className="text-[10px] text-white/40 block mb-1">Icon (optional)</label>
                      <div className="flex gap-2">
                        <input
                          className="bndz-native-input flex-1 !py-1.5 !text-[11px]"
                          value={selectedAction.icon || ''}
                          onChange={e => updateSelected({ icon: e.target.value })}
                          placeholder="C:\\App\\icon.ico"
                        />
                        <button type="button" className="bndz-hub-btn-ghost text-[11px] px-2.5" onClick={() => void selectIcon()}>
                          Browse
                        </button>
                      </div>
                      <div className="text-[10px] text-white/30 mt-1">{targetLabel(selectedAction.targetMode)}</div>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button type="button" className="bndz-hub-btn-ghost text-[11px] px-2.5 py-1.5 flex items-center gap-1.5" onClick={() => testOnSelection(selectedAction)}>
                      <Icons8Icon id="play_ui" size={12} />
                      Test on selection
                    </button>
                    <button type="button" className="bndz-hub-btn-ghost text-[11px] px-2.5 py-1.5 text-rose-300/90" onClick={removeSelected}>
                      Remove
                    </button>
                  </div>
                </div>
              )}

              {tab === 'global' && (
                <div className="bndz-cm-hint">
                  <Icons8Icon id="key_ui" size={12} className="opacity-50 shrink-0 mt-0.5" />
                  <p>
                    Compose items that appear in File Explorer and other Windows apps, then Deploy.
                    Below: live shell extensions for the current selection — pin to the top or hide from BNDZ menus.
                  </p>
                </div>
              )}
              {tab === 'app' && (
                <div className="bndz-cm-hint">
                  <Icons8Icon id="help_ui" size={12} className="opacity-50 shrink-0 mt-0.5" />
                  <p>
                    Dim rows are built-in BNDZ commands (always present). Highlighted rows are yours — drag presets from the library, reorder, or drop on remove. Switch File / Folder / Empty space to see how the stock menu changes.
                  </p>
                </div>
              )}

              {tab === 'global' && (
                <div className="bndz-cm-shell-panel">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="bndz-cm-section-label !mb-0">Shell extensions</div>
                    <button type="button" className="bndz-hub-btn-ghost text-[10px] px-2 py-1 ml-auto" onClick={() => void refreshShellItems()}>
                      Scan selection
                    </button>
                  </div>
                  <p className="text-[10px] text-white/35 mb-2 leading-snug">
                    Native handlers registered with Windows (7-Zip, Git, antivirus…). Same shell menu Explorer uses.
                  </p>
                  {shellLoading && <div className="text-[11px] text-white/40">Scanning…</div>}
                  {shellError && <div className="text-[11px] text-rose-300">{shellError}</div>}
                  {!shellLoading && !shellError && shellItems.length === 0 && (
                    <div className="text-[11px] text-white/35 py-3">Select a file or folder in the list, then Scan.</div>
                  )}
                  <div className="space-y-1 max-h-[180px] overflow-y-auto bndz-scrollbar">
                    {shellItems.map(item => {
                      const id = item.id || item.verb || item.label;
                      const hidden = hiddenShellIds.includes(id);
                      const pinned = pinnedShellIds.includes(id);
                      return (
                        <div key={id} className={`bndz-cm-shell-row ${hidden ? 'opacity-45' : ''}`}>
                          <div className="flex-1 min-w-0">
                            <div className="text-[12px] text-white truncate">{item.label}</div>
                            <div className="text-[10px] text-white/35 truncate">{item.verb || id}</div>
                          </div>
                          <button type="button" className="bndz-hub-btn-ghost !p-1.5" title={pinned ? 'Unpin' : 'Pin'} onClick={() => toggleShellPinned(id)}>
                            <Icons8Icon id="star_ui" size={13} className={pinned ? 'opacity-100' : 'opacity-40'} />
                          </button>
                          <button type="button" className="bndz-hub-btn-ghost !p-1.5" title={hidden ? 'Show' : 'Hide'} onClick={() => toggleShellHidden(id)}>
                            <Icons8Icon id={hidden ? 'eye_ui' : 'eye_off_ui'} size={13} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </DndContext>
  );

  return (
    <PluginPanelShell
      title="Shell Menus"
      icon="shell_menus"
      iconColor="#67e8f9"
      variant="embedded"
    >
      <div className="flex flex-col min-h-0 h-full">
        <div className="bndz-cm-tabs shrink-0 flex items-center gap-1 px-3 py-2 border-b border-white/[0.06]">
          {([
            { id: 'app' as const, label: 'Inside BNDZ', icon: 'shell_menus' },
            { id: 'global' as const, label: 'Windows Explorer', icon: 'windows_ui' },
            { id: 'verbs' as const, label: 'Explorer verbs', icon: 'zap_ui' },
          ]).map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`bndz-cm-tab ${tab === t.id ? 'bndz-cm-tab--active' : ''}`}
            >
              <Icons8Icon id={t.icon} size={13} />
              {t.label}
            </button>
          ))}
          <button
            type="button"
            className="ml-auto text-[10px] text-white/35 hover:text-white/70 flex items-center gap-1 px-2"
            onClick={() => setShowHelp(v => !v)}
          >
            <Icons8Icon id="help_ui" size={11} />
            How it works
          </button>
        </div>

        {showHelp && (
          <div className="px-4 py-2.5 text-[11px] text-white/45 leading-relaxed border-b border-white/[0.05] bg-black/25">
            <strong className="text-cyan-300/90">Inside BNDZ</strong> — compose the in-app right-click menu with a live preview of stock + custom items.
            {' '}
            <strong className="text-cyan-300/90">Windows Explorer</strong> — OS-wide context menus: inject BNDZ commands into Explorer (Deploy), and pin/hide live shell extensions that Windows already registers.
            {' '}
            <strong className="text-cyan-300/90">Explorer verbs</strong> — forge HKCU shell verbs that launch BNDZ with path args (formerly a fake sibling plugin).
          </div>
        )}

        {tab === 'verbs' ? <ShellVerbForgePanel /> : renderDesigner()}
      </div>
    </PluginPanelShell>
  );
}
