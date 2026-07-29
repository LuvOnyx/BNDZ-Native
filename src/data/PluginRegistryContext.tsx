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
import ComparePlugin, { ComparePluginDef } from '../components/plugins/ComparePlugin';
import MeshPlugin, { MeshPluginDef } from '../components/plugins/MeshPlugin';
import GhostLinkPlugin, { GhostLinkPluginDef } from '../components/plugins/GhostLinkPlugin';
import { useAppConfig } from './configContext';

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

/** Core plugins shipped and enabled by default */
export const DEFAULT_INSTALLED_PLUGINS = [
    'properties',
    'context-menu-manager',
    'batch-rename',
    'find',
    'dropstack',
    'filters',
    'storage-cleanup',
    'folder-sync',
    'catalog',
    'action-log',
    'compare',
    'ghost-link',
];

/** Advanced plugins installed on first use */
export const FIRST_USE_PLUGINS: string[] = [];

const ALL_PLUGINS: PluginManifest[] = [
    {
        id: 'properties',
        name: 'System Properties',
        description: 'Native Windows property inspector with hash analysis, ACL viewer, and attribute editor.',
        icon: 'sys_properties',
        isInstalled: true,
        isNative: true,
        targetPanel: 'bottom',
        component: PropertiesPlugin,
    },
    {
        ...ContextMenuPluginDef,
        name: 'Shell Menus',
        description: 'Unified internal BNDZ and Windows shell context menu designer and registry deployer.',
        isInstalled: true,
        isNative: true,
        targetPanel: 'bottom',
        component: ContextMenuPlugin,
    },
    {
        ...IconStudioPluginDef,
        description: 'FolderIco-style icon libraries — import folders of icons, drag-drop PNGs, apply to folders and files.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: IconStudioPlugin,
    },
    {
        ...BatchRenamePluginDef,
        description: 'Batch rename files with pattern matching, numbering, and AI-assisted suggestions.',
        isInstalled: true,
        isNative: true,
        targetPanel: 'bottom',
        component: BatchRenamePlugin,
    },
    {
        ...FindPluginDef,
        description: 'Instant file search across drives and cloud folders.',
        isInstalled: true,
        isNative: true,
        targetPanel: 'bottom',
        component: FindPlugin,
    },
    {
        ...DropStackPluginDef,
        description: 'Stage files from multiple directories, then batch copy or move to the active pane.',
        isInstalled: true,
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
        description: 'Smart folder organization, large-file discovery, and storage cleanup workflows.',
        isInstalled: true,
        isNative: true,
        targetPanel: 'bottom',
        component: StorageCleanupPlugin,
    },
    {
        ...FolderSyncPluginDef,
        description: 'Automatic folder sync with live watching — keeps backup folders up to date using robocopy.',
        isInstalled: true,
        isNative: true,
        targetPanel: 'bottom',
        component: FolderSyncPlugin,
    },
    {
        ...CatalogPluginDef,
        description: 'Virtual collections of paths — browse as /vf folders, add selections from any pane.',
        isInstalled: true,
        isNative: true,
        targetPanel: 'bottom',
        component: CatalogPlugin,
    },
    {
        ...ActionLogPluginDef,
        description: 'Reversible operation history with undo/redo — XYplorer-style action log.',
        isInstalled: true,
        isNative: true,
        targetPanel: 'bottom',
        component: ActionLogPlugin,
    },
    {
        ...ComparePluginDef,
        description: 'Binary file compare and recursive folder diff — XYplorer branch compare parity.',
        isInstalled: true,
        isNative: true,
        targetPanel: 'bottom',
        component: ComparePlugin,
    },
    {
        ...MeshPluginDef,
        description: 'Zero-config SSH/SFTP mesh — remote browsing, live deploy mirrors, and integrated terminal. Power-user optional plugin.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: MeshPlugin,
    },
    {
        ...GhostLinkPluginDef,
        description: 'Offload inactive files to cold storage while preserving paths via symlinks.',
        isInstalled: true,
        isNative: true,
        targetPanel: 'bottom',
        component: GhostLinkPlugin,
    },
];

const PluginRegistryContext = createContext<any>(null);

export const PluginRegistryProvider = ({ children }: { children: ReactNode }) => {
    const { config, updateConfig } = useAppConfig();
    const [plugins, setPlugins] = useState<PluginManifest[]>(ALL_PLUGINS);
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        if (hydrated) return;
        const saved = config.installedPlugins as string[] | undefined;
        const merged = ALL_PLUGINS.map(p => ({
            ...p,
            isInstalled: saved
                ? saved.includes(p.id)
                : DEFAULT_INSTALLED_PLUGINS.includes(p.id),
        }));
        setPlugins(merged);
        setHydrated(true);
    }, [config.installedPlugins, hydrated]);

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
            const next = prev.map(p => p.id === id ? { ...p, isInstalled: !p.isInstalled } : p);
            const installedIds = next.filter(p => p.isInstalled).map(p => p.id);
            updateConfig({ installedPlugins: installedIds });
            return next;
        });
    }, [updateConfig]);

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
            ensurePluginInstalled,
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
