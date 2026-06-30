import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { usePluginRegistry } from '../data/PluginRegistryContext';
import { useAppConfig } from '../data/configContext';
import { Layers, Puzzle, Store, GripVertical } from 'lucide-react';

function SortableTab({ plugin, isActive, onClick, showIcons }: { plugin: any; isActive: boolean; onClick: () => void; showIcons?: boolean }) {
  const Icon = plugin.icon || Layers;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: plugin.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <button
      ref={setNodeRef}
      style={style}
      type="button"
      onClick={onClick}
      className={`px-3 py-2 border-r border-white/[0.04] flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider transition-all duration-150 shrink-0 ${
        isActive
          ? 'bndz-bottom-tab-active text-sky-300'
          : 'bg-transparent text-gray-500 hover:text-gray-300 hover:bg-white/[0.03]'
      }`}
    >
      <span {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-400 p-0.5 -ml-1" onClick={e => e.stopPropagation()}>
        <GripVertical size={10} />
      </span>
      {showIcons !== false && <Icon size={12} className={isActive ? 'text-sky-500' : 'text-gray-600'} />}
      {plugin.name}
    </button>
  );
}

export default function BottomPluginPanel(props: any & {
  onOpenPluginStore?: () => void;
  requestedTab?: string | null;
  onRequestedTabConsumed?: () => void;
}) {
  const { onOpenPluginStore, requestedTab, onRequestedTabConsumed, ...pluginProps } = props;
  const { pluginRegistry, ensurePluginInstalled } = usePluginRegistry();
  const { config, updateConfig } = useAppConfig();
  const panelRef = useRef<HTMLDivElement>(null);
  const [mountedTabIds, setMountedTabIds] = useState<Set<string>>(new Set());

  const orderedPlugins = useMemo(() => {
    const installed = pluginRegistry.filter((p: any) => p.isInstalled);
    const order: string[] = config.bottomPluginTabOrder || [];
    if (!order.length) return installed;
    const ordered = order.map(id => installed.find((p: any) => p.id === id)).filter(Boolean) as any[];
    const rest = installed.filter((p: any) => !order.includes(p.id));
    return [...ordered, ...rest];
  }, [pluginRegistry, config.bottomPluginTabOrder]);

  const [activeTab, setActiveTab] = useState<string | null>(
    orderedPlugins.length > 0 ? orderedPlugins[0].id : null
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    if (!requestedTab || !orderedPlugins.some((p: any) => p.id === requestedTab)) return;
    setActiveTab(requestedTab);
    onRequestedTabConsumed?.();
  }, [requestedTab, orderedPlugins, onRequestedTabConsumed]);

  useEffect(() => {
    if (orderedPlugins.length === 0) {
      setActiveTab(null);
      return;
    }
    if (activeTab && orderedPlugins.some((p: any) => p.id === activeTab)) return;

    if (config.bottomPanelRememberTab && config.bottomPanelLastTab && orderedPlugins.some((p: any) => p.id === config.bottomPanelLastTab)) {
      setActiveTab(config.bottomPanelLastTab);
      return;
    }
    const def = config.bottomPanelDefaultPlugin || orderedPlugins[0].id;
    setActiveTab(orderedPlugins.some((p: any) => p.id === def) ? def : orderedPlugins[0].id);
  }, [orderedPlugins, activeTab, config.bottomPanelRememberTab, config.bottomPanelLastTab, config.bottomPanelDefaultPlugin]);

  useEffect(() => {
    if (activeTab) {
      setMountedTabIds(prev => {
        if (prev.has(activeTab)) return prev;
        const next = new Set(prev);
        next.add(activeTab);
        return next;
      });
    }
  }, [activeTab]);

  const cycleTab = useCallback((direction: 1 | -1) => {
    if (!activeTab || orderedPlugins.length < 2) return;
    const idx = orderedPlugins.findIndex((p: { id: string }) => p.id === activeTab);
    if (idx < 0) return;
    const next = orderedPlugins[(idx + direction + orderedPlugins.length) % orderedPlugins.length];
    ensurePluginInstalled?.(next.id);
    setActiveTab(next.id);
    if (config.bottomPanelRememberTab !== false) {
      updateConfig({ bottomPanelLastTab: next.id });
    }
  }, [activeTab, orderedPlugins, ensurePluginInstalled, config.bottomPanelRememberTab, updateConfig]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key !== 'PageDown' && e.key !== 'PageUp') return;
      const panel = panelRef.current;
      if (!panel) return;
      const root = panel.closest('.bndz-chrome-bottom');
      if (!root || !document.contains(root)) return;
      e.preventDefault();
      cycleTab(e.key === 'PageDown' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cycleTab]);

  const handleTabClick = (id: string) => {
    ensurePluginInstalled?.(id);
    setActiveTab(id);
    if (config.bottomPanelRememberTab !== false) {
      updateConfig({ bottomPanelLastTab: id });
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedPlugins.findIndex(p => p.id === active.id);
    const newIndex = orderedPlugins.findIndex(p => p.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const ids = orderedPlugins.map((p: { id: string }) => p.id);
    const next = arrayMove(ids, oldIndex, newIndex) as string[];
    updateConfig({ bottomPluginTabOrder: next });
  };

  if (orderedPlugins.length === 0) {
    return (
      <div className="bndz-bottom-panel flex flex-col h-full min-h-0 border-t border-white/[0.06]">
        <div className="bndz-bottom-tabstrip flex items-center gap-2 px-4 py-2 border-b border-white/[0.05] text-[11px] font-bold uppercase tracking-wider text-gray-500 shrink-0">
          <Puzzle size={12} />
          Plugin Panel
        </div>
        <div className="bndz-bottom-content flex-1 flex flex-col items-center justify-center text-gray-600 text-xs gap-3">
          <span>No plugins installed.</span>
          {onOpenPluginStore && (
            <button onClick={onOpenPluginStore} className="flex items-center gap-2 px-4 py-2 bg-[#a475d4] hover:bg-[#8b5fbf] text-white rounded text-xs font-semibold transition-colors">
              <Store size={12} /> Open Extension Hub
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={panelRef} className="bndz-bottom-panel flex flex-col h-full min-h-0" tabIndex={-1}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={orderedPlugins.map(p => p.id)} strategy={horizontalListSortingStrategy}>
          <div className="bndz-bottom-tabstrip flex border-b border-white/[0.05] shrink-0 overflow-x-auto scrollbar-hidden backdrop-blur-sm" title="Ctrl+PageDown / Ctrl+PageUp — switch plugin tabs">
            {orderedPlugins.map((plugin: any) => (
              <SortableTab
                key={plugin.id}
                plugin={plugin}
                isActive={activeTab === plugin.id}
                showIcons={config.bottomPanelShowTabIcons}
                onClick={() => handleTabClick(plugin.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="bndz-bottom-content flex-1 overflow-hidden relative min-h-0 bndz-scrollbar">
        {orderedPlugins.map((plugin: any) => {
          if (!mountedTabIds.has(plugin.id)) return null;
          const Component = plugin.component;
          if (!Component) return null;
          const isActive = plugin.id === activeTab;
          return (
            <div
              key={plugin.id}
              className={`absolute inset-0 ${isActive ? 'z-10' : 'z-0 pointer-events-none invisible'}`}
              aria-hidden={!isActive}
            >
              <Component {...pluginProps} isPluginTabActive={isActive} />
            </div>
          );
        })}
        {!activeTab && (
          <div className="flex items-center justify-center h-full text-gray-600 text-xs">
            Select a plugin capability above.
          </div>
        )}
      </div>
    </div>
  );
}
