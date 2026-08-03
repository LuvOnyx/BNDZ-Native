import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  type Modifier,
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
import type { ContextToolId } from '../workstation/command-deck/contextToolRegistry';

/** Keep tab reorder drags horizontal — no vertical pull on the tab strip. */
const restrictTabDragToHorizontalAxis: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
});

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
      className={`bndz-bottom-tab relative flex items-center gap-1.5 shrink-0 max-w-[160px] ${
        isActive ? 'bndz-bottom-tab-active' : ''
      }`}
      title={plugin.name}
    >
      {isActive && (
        <motion.span
          layoutId="bndz-bottom-tab-glow"
          className="absolute inset-x-2 bottom-0 h-[2px] rounded-sm bg-[#99c9f0]/85"
          transition={{ type: 'spring', stiffness: 520, damping: 36 }}
        />
      )}
      <span {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-400 p-0.5 -ml-1" onClick={e => e.stopPropagation()}>
        <DragHandleGlyph size={10} />
      </span>
      {showIcons !== false && <Icons8Icon id={plugin.icon || 'dropstack'} size={14} className="shrink-0" />}
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
  immersive?: boolean;
  onExitImmersive?: () => void;
  onEnterImmersive?: () => void;
  onCommandDeckTool?: (id: ContextToolId) => void;
}) {
  const {
    onOpenPluginStore,
    requestedTab,
    onRequestedTabConsumed,
    launchContext,
    onLaunchContextConsumed,
    onActiveTabChange,
    immersive = false,
    onExitImmersive,
    onEnterImmersive,
    onCommandDeckTool,
    ...pluginProps
  } = props;
  const { pluginRegistry } = usePluginRegistry();
  const { config, updateConfig } = useAppConfig();
  const panelRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [immersiveHost, setImmersiveHost] = useState<HTMLElement | null>(null);
  const lazyUnmount = config.bottomPanelLazyUnmount !== false;

  useEffect(() => {
    setImmersiveHost(document.getElementById('bndz-bottom-immersive-host'));
  }, [immersive]);

  const orderedPlugins = useMemo(() => {
    const installed = pluginRegistry.filter((p: any) => p.isInstalled === true);
    const order: string[] = (config.bottomPluginTabOrder || []).filter(
      (id: string) => installed.some((p: any) => p.id === id),
    );
    if (!order.length) return installed;
    const ordered = order.map(id => installed.find((p: any) => p.id === id)).filter(Boolean) as any[];
    const rest = installed.filter((p: any) => !order.includes(p.id));
    return [...ordered, ...rest];
  }, [pluginRegistry, config.bottomPluginTabOrder]);

  // Persist scrub: drop uninstalled IDs from saved tab order so they cannot resurrect.
  useEffect(() => {
    const order = config.bottomPluginTabOrder || [];
    if (!order.length) return;
    const installedIds = new Set(
      pluginRegistry.filter((p: any) => p.isInstalled === true).map((p: any) => p.id),
    );
    const cleaned = order.filter((id: string) => installedIds.has(id));
    if (cleaned.length !== order.length) {
      updateConfig({ bottomPluginTabOrder: cleaned });
    }
  }, [pluginRegistry, config.bottomPluginTabOrder, updateConfig]);

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
    setActiveTab(next.id);
    if (config.bottomPanelRememberTab !== false) {
      updateConfig({ bottomPanelLastTab: next.id });
    }
  }, [activeTab, orderedPlugins, config.bottomPanelRememberTab, updateConfig]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key !== 'PageDown' && e.key !== 'PageUp') return;
      const panel = panelRef.current;
      if (!panel) return;
      const root = panel.closest('.bndz-chrome-bottom, .bndz-bottom-immersive-shell');
      if (!root || !document.contains(root)) return;
      e.preventDefault();
      cycleTab(e.key === 'PageDown' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cycleTab]);

  const handleTabClick = (id: string) => {
    // Impossible to activate a tab for an uninstalled plugin.
    if (!orderedPlugins.some((p: any) => p.id === id)) return;
    setActiveTab(id);
    setOverflowOpen(false);
    if (config.bottomPanelRememberTab !== false) {
      updateConfig({ bottomPanelLastTab: id });
    }
  };

  const handleDeckTool = useCallback((id: ContextToolId) => {
    if (onCommandDeckTool) {
      onCommandDeckTool(id);
      return;
    }
    if (id === 'mesh-drop') {
      window.dispatchEvent(new CustomEvent('bndz-mesh-drop-send', { detail: { paths: [] } }));
      return;
    }
    const tabMap: Partial<Record<ContextToolId, string>> = {
      properties: 'properties',
      'batch-rename': 'batch-rename',
      compare: 'compare',
      'storage-cleanup': 'storage-cleanup',
      'index-folder': 'find',
      waveform: 'metadata',
      'analyze-audio': 'metadata',
      'media-tab': 'metadata',
      'ghost-link': 'ghost-link',
      'ram-staging': 'ram-staging',
      'flush-ram-zone': 'ram-staging',
      dropstack: 'dropstack',
      catalog: 'catalog',
      'folder-sync': 'folder-sync',
      'project-sandbox': 'project-sandbox',
      'library-health': 'library-health',
      'capacity-solver': 'capacity-solver',
      'inbound-volume': 'inbound-volume',
      'branching-time': 'branching-time',
      'transcode-rack': 'transcode-rack',
      'semantic-desk': 'semantic-desk',
      'shell-verb-forge': 'shell-verb-forge',
    };
    const tab = tabMap[id];
    // Hard invariant: never switch to a tab for an uninstalled plugin.
    if (tab && orderedPlugins.some((p: any) => p.id === tab)) handleTabClick(tab);
  }, [onCommandDeckTool, config.bottomPanelRememberTab, updateConfig, orderedPlugins]);

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

  const visibleTabCount = 16;
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
            <button type="button" onClick={onOpenPluginStore} className="bndz-hub-btn-primary flex items-center gap-2 px-4 py-2 text-sm font-semibold">
              <Icons8Icon id="extension_hub" size={12} /> Open Extension Hub
            </button>
          )}
        </div>
      </div>
    );
  }

  const panelBody = (
    <div
      ref={panelRef}
      className={`bndz-bottom-panel flex flex-col h-full min-h-0 ${immersive ? 'bndz-bottom-panel--immersive' : ''}`}
      tabIndex={-1}
    >
      {immersive && (
        <div className="bndz-bottom-immersive-bar shrink-0 flex items-center gap-3 px-3 py-2">
          <button
            type="button"
            className="bndz-bottom-immersive-exit"
            onClick={() => onExitImmersive?.()}
            title="Restore docked panel (Esc)"
          >
            <Icons8Icon id="chevron_down" size={12} />
            Restore
          </button>
          <span className="text-[11px] text-[#99c9f0]/90 font-semibold tracking-wide">
            Immersive · {activePlugin?.name || 'Plugin'}
          </span>
          <span className="text-[10px] text-gray-500 ml-auto">
            Covers the file list · Esc to restore
          </span>
        </div>
      )}
      <div className="bndz-bottom-tabstrip-host relative shrink-0 min-w-0">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        modifiers={[restrictTabDragToHorizontalAxis]}
      >
        <SortableContext items={orderedPlugins.map(p => p.id)} strategy={horizontalListSortingStrategy}>
          <div className="bndz-bottom-tabstrip flex min-w-0 border-b border-white/[0.06] shrink-0 items-stretch" title="Ctrl+PageDown / Ctrl+PageUp — switch plugin tabs">
            <div className="bndz-bottom-tabstrip-scroll flex flex-1 min-w-0 overflow-x-auto scrollbar-hidden items-stretch touch-pan-x">
            {primaryTabs.map((plugin: any) => (
              <SortableTab
                key={plugin.id}
                plugin={plugin}
                isActive={activeTab === plugin.id}
                showIcons={config.bottomPanelShowTabIcons}
                onClick={() => handleTabClick(plugin.id)}
              />
            ))}
            </div>
            {overflowTabs.length > 0 && (
              <div ref={overflowRef} className="relative shrink-0 border-l border-white/[0.04]">
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
                  <div className="absolute right-0 top-full z-50 min-w-[200px] py-1 bg-[#16161c] border border-white/[0.08] shadow-xl max-h-[240px] overflow-y-auto bndz-scrollbar rounded-b-md">
                    {overflowTabs.map((plugin: any) => (
                      <button
                        key={plugin.id}
                        type="button"
                        onClick={() => handleTabClick(plugin.id)}
                        className={`w-full text-left px-3 py-2 text-[12px] flex items-center gap-2 hover:bg-white/[0.05] ${
                          activeTab === plugin.id ? 'text-[#99c9f0] font-medium bg-[#094771]/25' : 'text-gray-300'
                        }`}
                      >
                        <Icons8Icon id={plugin.icon || 'dropstack'} size={12} /> {plugin.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center gap-1 px-2 shrink-0 border-l border-white/[0.04]">
              {activeTab && (
                <button
                  type="button"
                  className="bndz-bottom-popout-btn"
                  title="Pop out plugin into a separate window"
                  onClick={() => {
                    const name = activePlugin?.name;
                    void import('../lib/ipcBridge').then(({ IPC }) =>
                      IPC.openPluginWindow(activeTab, { title: name }),
                    );
                  }}
                >
                  <Icons8Icon id="external_link" size={12} />
                </button>
              )}
              {!immersive && onEnterImmersive && (
                <button
                  type="button"
                  className="bndz-bottom-immersive-enter"
                  title="Expand plugin over the file list"
                  onClick={() => onEnterImmersive()}
                >
                  <Icons8Icon id="maximize_ui" size={12} />
                </button>
              )}
              {onOpenPluginStore && (
                <button
                  type="button"
                  className="bndz-bottom-hub-btn"
                  title="Extension Hub"
                  onClick={onOpenPluginStore}
                >
                  <Icons8Icon id="extension_hub" size={12} />
                </button>
              )}
            </div>
          </div>
        </SortableContext>
      </DndContext>
      </div>

      <div className="bndz-bottom-content flex-1 min-h-0 overflow-hidden relative flex flex-col">
        <AnimatePresence mode="wait">
          {activePlugin?.component && activeTab && (() => {
            const ActiveComponent = activePlugin.component;
            return (
            <motion.div
              key={activeTab}
              className="bndz-bottom-plugin-surface flex-1 min-h-0 h-full w-full flex flex-col overflow-hidden"
              initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -8, filter: 'blur(3px)' }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <ActiveComponent {...mergedPluginProps} isPluginTabActive immersive={immersive} />
            </motion.div>
            );
          })()}
        </AnimatePresence>
        {!lazyUnmount && orderedPlugins.map((plugin: any) => {
          if (plugin.id === activeTab) return null;
          const Component = plugin.component;
          if (!Component) return null;
          return (
            <div key={plugin.id} className="bndz-bottom-plugin-surface absolute inset-0 z-0 pointer-events-none invisible flex flex-col min-h-0 overflow-hidden" aria-hidden>
              <Component {...mergedPluginProps} isPluginTabActive={false} immersive={immersive} />
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

  if (immersive && immersiveHost) {
    return (
      <>
        <div className="bndz-bottom-immersive-placeholder h-full flex items-center justify-center gap-2 px-3 text-[11px] text-gray-500">
          <Icons8Icon id="extension_hub" size={12} className="opacity-60" />
          Plugin immersive — list covered
          <button type="button" className="text-[#7eb8e8] hover:text-[#99c9f0] font-medium" onClick={() => onExitImmersive?.()}>
            Exit immersive
          </button>
        </div>
        {createPortal(
          <div className="bndz-bottom-immersive-shell h-full w-full flex flex-col min-h-0">
            {panelBody}
          </div>,
          immersiveHost,
        )}
      </>
    );
  }

  return panelBody;
}
