import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import ContextMenuPlugin, { ContextMenuPluginDef } from '../components/plugins/ContextMenuPlugin';
import PropertiesPlugin from '../components/plugins/PropertiesPlugin';
import IconStudioPlugin, { IconStudioPluginDef } from '../components/plugins/IconStudio';
import BatchRenamePlugin, { BatchRenamePluginDef } from '../components/plugins/BatchRenamePlugin';
import FindPlugin, { FindPluginDef } from '../components/plugins/FindPlugin';
import DropStackPlugin, { DropStackPluginDef } from '../components/plugins/DropStackPlugin';
import FiltersPlugin, { FiltersPluginDef } from '../components/plugins/FiltersPlugin';
import MetadataPlugin, { MetadataPluginDef } from '../components/plugins/MetadataPlugin';
import StorageCleanupPlugin, { StorageCleanupPluginDef } from '../components/plugins/StorageCleanupPlugin';
import FolderSyncPlugin, { FolderSyncPluginDef } from '../components/plugins/FolderSyncPlugin';
import CatalogPlugin, { CatalogPluginDef } from '../components/plugins/CatalogPlugin';
import ActionLogPlugin, { ActionLogPluginDef } from '../components/plugins/ActionLogPlugin';
import MeshPlugin, { MeshPluginDef } from '../components/plugins/MeshPlugin';
import RamStagingPlugin, { RamStagingPluginDef } from '../components/plugins/RamStagingPlugin';
import ProjectSandboxPlugin, { ProjectSandboxPluginDef } from '../components/plugins/ProjectSandboxPlugin';
import BranchingTimePlugin, { BranchingTimePluginDef } from '../components/plugins/BranchingTimePlugin';
import DesignBoardPlugin, { DesignBoardPluginDef } from '../components/plugins/DesignBoardPlugin';
import { useAppConfig } from './configContext';

/** Stale / absorbed plugin IDs remapped into real FM homes. */
const RETIRED_PLUGIN_REMAP: Record<string, string> = {
    'shell-verb-forge': 'context-menu-manager',
    'capacity-solver': 'storage-cleanup',
    'drop-magnet': 'batch-rename',
    compare: 'folder-sync',
    'transcode-rack': 'metadata',
    'semantic-desk': 'filters',
    'policy-packs': 'dropstack',
    'inbound-volume': 'dropstack',
    'capture-inbox': 'dropstack',
    'zk-vault': 'project-sandbox',
    'ghost-link': 'ram-staging',
    'library-health': 'storage-cleanup',
    'reality-check': 'storage-cleanup',
};

export type PluginManifest = {
    id: string;
    name: string;
    description: string;
    /** Icons8 asset id from toolbarLauncherIcons.ts. */
    icon: string;
    isInstalled?: boolean;
    isNative?: boolean;
    targetPanel?: 'bottom' | 'sidebar';
    component?: React.ComponentType<any>;
    installOnFirstUse?: boolean;
};

/** Core plugins on first launch — Properties, Search, Filters only. */
export const DEFAULT_INSTALLED_PLUGINS: string[] = [
    'properties',
    'find',
    'filters',
];

/**
 * Selling-pillar plugin ids previously soft-installed on first open.
 * Auto-install is intentionally disabled — keep this list empty so marketplace
 * installs stay explicit. Prefer installing from the plugin store.
 */
export const FIRST_USE_PLUGINS: string[] = [];

const ALL_PLUGINS: PluginManifest[] = [
    {
        id: 'properties',
        name: 'Properties',
        description: 'Windows properties, hashes, permissions, and attributes.',
        icon: 'sys_properties',
        isInstalled: true,
        isNative: true,
        targetPanel: 'bottom',
        component: PropertiesPlugin,
    },
    {
        ...ContextMenuPluginDef,
        name: 'Context Menus',
        description: 'Customize BNDZ and Explorer context menus, including shell extensions.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: ContextMenuPlugin,
    },
    {
        ...IconStudioPluginDef,
        description: 'Icon libraries for folders and files.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: IconStudioPlugin,
    },
    {
        ...BatchRenamePluginDef,
        description: 'Rename many files at once, with optional drop rules.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: BatchRenamePlugin,
    },
    {
        ...FindPluginDef,
        description: 'Search files across local drives and cloud folders.',
        isInstalled: true,
        isNative: true,
        targetPanel: 'bottom',
        component: FindPlugin,
    },
    {
        ...DropStackPluginDef,
        description: 'Collect files from different folders, then copy or move them together.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: DropStackPlugin,
    },
    {
        ...FiltersPluginDef,
        isInstalled: true,
        component: FiltersPlugin,
    },
    {
        ...MetadataPluginDef,
        isInstalled: false,
        component: MetadataPlugin,
    },
    {
        ...StorageCleanupPluginDef,
        description: 'Find wasted space, plan capacity, and fix missing library links.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: StorageCleanupPlugin,
    },
    {
        ...FolderSyncPluginDef,
        description: 'Sync folders and compare files or directory trees.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: FolderSyncPlugin,
    },
    {
        ...CatalogPluginDef,
        description: 'Saved path collections you can browse like folders.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: CatalogPlugin,
    },
    {
        ...ActionLogPluginDef,
        description: 'Undo and redo copy, move, and rename operations.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: ActionLogPlugin,
    },

    {
        ...MeshPluginDef,
        description: 'Browse remote SSH/SFTP hosts and open an integrated terminal.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: MeshPlugin,
    },

    {
        ...RamStagingPluginDef,
        description: 'Stage files in RAM and offload cold data while keeping links.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: RamStagingPlugin,
    },
    {
        ...ProjectSandboxPluginDef,
        description: 'Isolated workspaces with checkpoints and encrypted vaults.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: ProjectSandboxPlugin,
    },


    {
        ...BranchingTimePluginDef,
        description: 'Snapshot folders, compare versions, and restore earlier states.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: BranchingTimePlugin,
    },

    {
        ...DesignBoardPluginDef,
        isInstalled: false,
        // Hosted Fabric/OpenPencil iframe shell — not a native C# filesystem plugin.
        isNative: false,
        targetPanel: 'bottom',
        component: DesignBoardPlugin,
    },
];

const PluginRegistryContext = createContext<any>(null);

export const PluginRegistryProvider = ({ children }: { children: ReactNode }) => {
    const { config, updateConfig } = useAppConfig();
    // Start from DEFAULT install set — never flash ALL_PLUGINS hardcoded isInstalled:true into the deck.
    const [plugins, setPlugins] = useState<PluginManifest[]>(() =>
        ALL_PLUGINS.map(p => ({
            ...p,
            isInstalled: DEFAULT_INSTALLED_PLUGINS.includes(p.id),
        })),
    );

    // Re-sync whenever persisted install list changes. Drop catalog-unknown IDs (stale),
    // but preserve legitimate store installs that exist in ALL_PLUGINS.
    // Also scrubs stale tab-config keys that point at uninstalled plugins — belt-and-suspenders
    // guard for configs saved before the uninstall scrub path was added.
    useEffect(() => {
        const catalogIds = new Set(ALL_PLUGINS.map(p => p.id));
        const shell = typeof document !== 'undefined' ? document.documentElement?.dataset?.bndzShell : undefined;
        const isFilesMergeShell = shell === 'files-pane' || shell === 'files-host';

        // FilesMerge: undo wipe-to-empty; seed core plugins + Properties; Command Deck off.
        const filesMergeFlags = config as {
            filesMergePluginsClearedV1?: boolean;
            filesMergePluginsReseededV2?: boolean;
            filesMergePluginsReseededV3?: boolean;
            defaultPluginsV3Applied?: boolean;
        };
        const LEGACY_DEFAULT_PLUGINS = [
            'properties', 'context-menu-manager', 'batch-rename', 'find', 'dropstack', 'filters',
            'metadata', 'storage-cleanup', 'folder-sync', 'catalog', 'action-log', 'compare',
            'ghost-link', 'ram-staging',
        ];
        const savedRawEarly = config.installedPlugins as string[] | undefined;
        const hasLegacyDefaultInstall = Array.isArray(savedRawEarly)
            && savedRawEarly.length === LEGACY_DEFAULT_PLUGINS.length
            && LEGACY_DEFAULT_PLUGINS.every(id => savedRawEarly.includes(id));
        if (!filesMergeFlags.defaultPluginsV3Applied && hasLegacyDefaultInstall) {
            updateConfig({
                installedPlugins: [...DEFAULT_INSTALLED_PLUGINS],
                bottomPluginTabOrder: [...DEFAULT_INSTALLED_PLUGINS],
                bottomPanelLastTab: 'properties',
                bottomPanelDefaultPlugin: 'properties',
                defaultPluginsV3Applied: true,
            } as any);
            setPlugins(ALL_PLUGINS.map(p => ({
                ...p,
                isInstalled: DEFAULT_INSTALLED_PLUGINS.includes(p.id),
            })));
            return;
        }
        const savedEmpty =
            !Array.isArray(config.installedPlugins) || config.installedPlugins.length === 0;
        if (
            isFilesMergeShell
            && !filesMergeFlags.filesMergePluginsReseededV3
            && (filesMergeFlags.filesMergePluginsClearedV1 || savedEmpty || filesMergeFlags.filesMergePluginsReseededV2)
        ) {
            updateConfig({
                installedPlugins: [...DEFAULT_INSTALLED_PLUGINS],
                bottomPluginTabOrder: [...DEFAULT_INSTALLED_PLUGINS],
                bottomPanelLastTab: 'properties',
                bottomPanelDefaultPlugin: 'properties',
                bottomPanelOpen: true,
                commandDeck: false,
                filesMergePluginsClearedV1: true,
                filesMergePluginsReseededV2: true,
                filesMergePluginsReseededV3: true,
            } as any);
            setPlugins(ALL_PLUGINS.map(p => ({
                ...p,
                isInstalled: DEFAULT_INSTALLED_PLUGINS.includes(p.id),
            })));
            return;
        }

        const savedRaw = config.installedPlugins as string[] | undefined;
        const remapped = Array.isArray(savedRaw)
            ? savedRaw.map(id => RETIRED_PLUGIN_REMAP[id] ?? id)
            : undefined;
        const saved = Array.isArray(remapped)
            ? [...new Set(remapped.filter(id => catalogIds.has(id)))]
            : undefined;

        const installedSet = new Set(
            Array.isArray(saved) ? saved : DEFAULT_INSTALLED_PLUGINS,
        );

        // One-time scrub of stale / remapped IDs from persisted config.
        const configPatch: Record<string, unknown> = {};
        if (
            Array.isArray(savedRaw)
            && saved
            && (saved.length !== savedRaw.length || saved.some((id, i) => id !== savedRaw[i]))
        ) {
            configPatch.installedPlugins = saved;
        }
        // Remap last-tab / default / order when they pointed at retired siblings,
        // then scrub anything still unknown / uninstalled.
        const remapTab = (id: string) => RETIRED_PLUGIN_REMAP[id] ?? id;
        const lastTabRaw = config.bottomPanelLastTab as string | undefined;
        const lastTab = lastTabRaw ? remapTab(lastTabRaw) : undefined;
        if (lastTabRaw && lastTab !== lastTabRaw) {
            configPatch.bottomPanelLastTab = installedSet.has(lastTab!) ? lastTab : '';
        } else if (lastTab && !installedSet.has(lastTab)) {
            configPatch.bottomPanelLastTab = '';
        }
        const defaultRaw = config.bottomPanelDefaultPlugin as string | undefined;
        const defaultPlugin = defaultRaw ? remapTab(defaultRaw) : undefined;
        if (defaultRaw && defaultPlugin !== defaultRaw) {
            configPatch.bottomPanelDefaultPlugin = installedSet.has(defaultPlugin!) ? defaultPlugin : '';
        } else if (defaultPlugin && !installedSet.has(defaultPlugin)) {
            configPatch.bottomPanelDefaultPlugin = '';
        }
        const tabOrder = config.bottomPluginTabOrder as string[] | undefined;
        if (Array.isArray(tabOrder)) {
            const nextOrder = [...new Set(tabOrder.map(remapTab).filter(id => installedSet.has(id)))];
            if (nextOrder.length !== tabOrder.length || nextOrder.some((id, i) => id !== tabOrder[i])) {
                configPatch.bottomPluginTabOrder = nextOrder;
            }
        }
        if (Object.keys(configPatch).length > 0) {
            updateConfig(configPatch as any);
        }

        const next = ALL_PLUGINS.map(p => ({
            ...p,
            isInstalled: Array.isArray(saved)
                ? saved.includes(p.id)
                : DEFAULT_INSTALLED_PLUGINS.includes(p.id),
        }));
        setPlugins(prev => {
            if (
                prev.length === next.length
                && prev.every((p, i) => p.id === next[i].id && p.isInstalled === next[i].isInstalled)
            ) {
                return prev;
            }
            return next;
        });
    }, [config.installedPlugins, config.bottomPanelLastTab, config.bottomPanelDefaultPlugin, config.bottomPluginTabOrder, updateConfig]);

    const ensurePluginInstalled = useCallback((id: string) => {
        setPlugins(prev => {
            const plugin = prev.find(p => p.id === id);
            if (!plugin || plugin.isInstalled) return prev;
            const next = prev.map(p => p.id === id ? { ...p, isInstalled: true } : p);
            const installedIds = next.filter(p => p.isInstalled).map(p => p.id);
            updateConfig({ installedPlugins: installedIds });
            return next;
        });
    }, [updateConfig]);

    const togglePluginInstall = useCallback((id: string) => {
        setPlugins(prev => {
            const wasInstalled = prev.find(p => p.id === id)?.isInstalled;
            const next = prev.map(p => p.id === id ? { ...p, isInstalled: !p.isInstalled } : p);
            const installedIds = next.filter(p => p.isInstalled).map(p => p.id);
            const patch: Record<string, unknown> = { installedPlugins: installedIds };
            // On uninstall: scrub tab order + default tab so dead buttons cannot resurrect.
            if (wasInstalled) {
                const order = (config.bottomPluginTabOrder || []) as string[];
                if (order.includes(id)) {
                    patch.bottomPluginTabOrder = order.filter(t => t !== id);
                }
                if (config.bottomPanelDefaultPlugin === id) patch.bottomPanelDefaultPlugin = '';
                if (config.bottomPanelLastTab === id) patch.bottomPanelLastTab = '';
            }
            updateConfig(patch as any);
            return next;
        });
    }, [updateConfig, config.bottomPluginTabOrder, config.bottomPanelDefaultPlugin, config.bottomPanelLastTab]);

    const addPluginToRegistry = useCallback((manifest: PluginManifest) => {
        setPlugins(prev => {
            const exists = prev.some(p => p.id === manifest.id);
            const next = exists
                ? prev.map(p => p.id === manifest.id ? { ...p, ...manifest, isInstalled: true } : p)
                : [...prev, { ...manifest, isInstalled: true }];
            const installedIds = next.filter(p => p.isInstalled).map(p => p.id);
            updateConfig({ installedPlugins: installedIds });
            return next;
        });
    }, [updateConfig]);

    return (
        <PluginRegistryContext.Provider value={{
            plugins,
            pluginRegistry: plugins,
            togglePluginInstall,
            addPluginToRegistry,
            // ensurePluginInstalled intentionally NOT exposed — callers must use togglePluginInstall
            // via the Plugin Store; auto-installing on navigate/open is forbidden.
        }}>
            {children}
        </PluginRegistryContext.Provider>
    );
};

export const usePluginRegistry = () => {
    const ctx = useContext(PluginRegistryContext);
    if (!ctx) throw new Error('usePluginRegistry must be used within PluginRegistryProvider');
    return ctx;
};
