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
import { Icons8Icon, DragHandleGlyph } from './Icons8Icon';

function SortableTab({ plugin, isActive, onClick, showIcons }: { plugin: any; isActive: boolean; onClick: () => void; showIcons?: boolean }) {
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
      className={`bndz-bottom-tab flex items-center gap-1.5 shrink-0 max-w-[160px] ${
        isActive ? 'bndz-bottom-tab-active' : ''
      }`}
      title={plugin.name}
    >
      <span {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-400 p-0.5 -ml-1" onClick={e => e.stopPropagation()}>
        <DragHandleGlyph size={10} />
      </span>
      {showIcons !== false && <Icons8Icon id={plugin.icon || 'dropstack'} size={12} className="shrink-0" />}
      <span className="truncate">{plugin.name}</span>
    </button>
  );
}

export type BottomPluginLaunchContext = {
  paths?: string[];
  currentPath?: string;
  wizardMode?: string;
  findQuery?: string;
};

export default function BottomPluginPanel(props: any & {
  onOpenPluginStore?: () => void;
  requestedTab?: string | null;
  onRequestedTabConsumed?: () => void;
  launchContext?: BottomPluginLaunchContext | null;
  onLaunchContextConsumed?: () => void;
  onActiveTabChange?: (pluginId: string | null, pluginName?: string) => void;
}) {
  const {
    onOpenPluginStore,
    requestedTab,
    onRequestedTabConsumed,
    launchContext,
    onLaunchContextConsumed,
    onActiveTabChange,
    ...pluginProps
  } = props;
  const { pluginRegistry, ensurePluginInstalled } = usePluginRegistry();
  const { config, updateConfig } = useAppConfig();
  const panelRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const lazyUnmount = config.bottomPanelLazyUnmount !== false;

  const orderedPlugins = useMemo(() => {
    const installed = pluginRegistry.filter((p: any) => p.isInstalled);
    const order: string[] = config.bottomPluginTabOrder || [];
    if (!order.length) return installed;
    const ordered = order.map(id => installed.find((p: any) => p.id === id)).filter(Boolean) as any[];
    const rest = installed.filter((p: any) => !order.includes(p.id));
    return [...ordered, ...rest];
  }, [pluginRegistry, config.bottomPluginTabOrder]);

  const [activeTab, setActiveTab] = useState<string | null>(
    orderedPlugins.length > 0 ? orderedPlugins[0].id : null,
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const activePlugin = orderedPlugins.find((p: { id: string }) => p.id === activeTab);

  useEffect(() => {
    onActiveTabChange?.(activeTab, activePlugin?.name);
  }, [activeTab, activePlugin?.name, onActiveTabChange]);

  useEffect(() => {
    if (!overflowOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) setOverflowOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [overflowOpen]);

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
    setOverflowOpen(false);
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

  const mergedPluginProps = useMemo(() => {
    if (!launchContext) return pluginProps;
    const paths = launchContext.paths?.length ? launchContext.paths : pluginProps.selectedItems;
    return {
      ...pluginProps,
      selectedItems: paths,
      selectedPaths: paths,
      currentPath: launchContext.currentPath || pluginProps.currentPath,
      pluginLaunch: launchContext,
    };
  }, [launchContext, pluginProps]);

  useEffect(() => {
    if (launchContext && activeTab) onLaunchContextConsumed?.();
  }, [activeTab, launchContext, onLaunchContextConsumed]);

  const visibleTabCount = 7;
  const primaryTabs = orderedPlugins.slice(0, visibleTabCount);
  const overflowTabs = orderedPlugins.slice(visibleTabCount);

  if (orderedPlugins.length === 0) {
    return (
      <div className="bndz-bottom-panel flex flex-col h-full min-h-0 border-t border-white/[0.06]">
        <div className="bndz-bottom-tabstrip flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.05] bndz-panel-muted shrink-0">
          <Icons8Icon id="extension_hub" size={14} />
          <span className="font-semibold">Plugin Panel</span>
        </div>
        <div className="bndz-bottom-content flex-1 flex flex-col items-center justify-center text-gray-500 gap-3">
          <span>No plugins installed.</span>
          {onOpenPluginStore && (
            <button onClick={onOpenPluginStore} className="flex items-center gap-2 px-4 py-2 bg-[#0067c0] hover:bg-[#0078d4] text-white text-sm font-semibold transition-colors">
              <Icons8Icon id="extension_hub" size={12} /> Open Extension Hub
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
          <div className="bndz-bottom-tabstrip flex border-b border-[#333] shrink-0 overflow-x-auto scrollbar-hidden items-stretch" title="Ctrl+PageDown / Ctrl+PageUp — switch plugin tabs">
            {primaryTabs.map((plugin: any) => (
              <SortableTab
                key={plugin.id}
                plugin={plugin}
                isActive={activeTab === plugin.id}
                showIcons={config.bottomPanelShowTabIcons}
                onClick={() => handleTabClick(plugin.id)}
              />
            ))}
            {overflowTabs.length > 0 && (
              <div ref={overflowRef} className="relative shrink-0 border-r border-white/[0.04]">
                <button
                  type="button"
                  onClick={() => setOverflowOpen(v => !v)}
                  className={`bndz-bottom-tab h-full px-3 flex items-center gap-1.5 ${
                    overflowTabs.some((p: any) => p.id === activeTab) ? 'bndz-bottom-tab-active' : ''
                  }`}
                >
                  More <Icons8Icon id="chevron_down" size={12} className={overflowOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
                </button>
                {overflowOpen && (
                  <div className="absolute right-0 top-full z-50 min-w-[200px] py-1 bg-[#1a1a1f] border border-[#333] shadow-xl max-h-[240px] overflow-y-auto bndz-scrollbar rounded-b-md">
                    {overflowTabs.map((plugin: any) => (
                      <button
                        key={plugin.id}
                        type="button"
                        onClick={() => handleTabClick(plugin.id)}
                        className={`w-full text-left px-3 py-2 text-[12px] flex items-center gap-2 hover:bg-[#094771]/40 ${
                          activeTab === plugin.id ? 'text-[#99c9f0] font-medium' : 'text-gray-300'
                        }`}
                      >
                        <Icons8Icon id={plugin.icon || 'dropstack'} size={12} /> {plugin.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </SortableContext>
      </DndContext>

      <div className="bndz-bottom-content flex-1 overflow-hidden relative min-h-0 bndz-scrollbar">
        {orderedPlugins.map((plugin: any) => {
          const shouldMount = lazyUnmount ? plugin.id === activeTab : true;
          if (!shouldMount) return null;
          const Component = plugin.component;
          if (!Component) return null;
          const isActive = plugin.id === activeTab;
          return (
            <div
              key={plugin.id}
              className={`absolute inset-0 ${isActive ? 'z-10' : 'z-0 pointer-events-none invisible'}`}
              aria-hidden={!isActive}
            >
              <Component {...mergedPluginProps} isPluginTabActive={isActive} />
            </div>
          );
        })}
        {!activeTab && (
          <div className="flex items-center justify-center h-full bndz-panel-muted">
            Select a plugin capability above.
          </div>
        )}
      </div>
    </div>
  );
}
