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
import RamStagingPlugin, { RamStagingPluginDef } from '../components/plugins/RamStagingPlugin';
import ProjectSandboxPlugin, { ProjectSandboxPluginDef } from '../components/plugins/ProjectSandboxPlugin';
import LibraryHealthPlugin, { LibraryHealthPluginDef } from '../components/plugins/LibraryHealthPlugin';
import CapacitySolverPlugin, { CapacitySolverPluginDef } from '../components/plugins/CapacitySolverPlugin';
import InboundVolumePlugin, { InboundVolumePluginDef } from '../components/plugins/InboundVolumePlugin';
import BranchingTimePlugin, { BranchingTimePluginDef } from '../components/plugins/BranchingTimePlugin';
import PolicyPackPlugin, { PolicyPackPluginDef } from '../components/plugins/PolicyPackPlugin';
import ZkVaultPlugin, { ZkVaultPluginDef } from '../components/plugins/ZkVaultPlugin';
import DropMagnetPlugin, { DropMagnetPluginDef } from '../components/plugins/DropMagnetPlugin';
import CaptureInboxPlugin, { CaptureInboxPluginDef } from '../components/plugins/CaptureInboxPlugin';
import RealityCheckPlugin, { RealityCheckPluginDef } from '../components/plugins/RealityCheckPlugin';
import TranscodeRackPlugin, { TranscodeRackPluginDef } from '../components/plugins/TranscodeRackPlugin';
import SemanticDeskPlugin, { SemanticDeskPluginDef } from '../components/plugins/SemanticDeskPlugin';
import DesignBoardPlugin, { DesignBoardPluginDef } from '../components/plugins/DesignBoardPlugin';
import { useAppConfig } from './configContext';

/** Stale Part B sibling IDs remapped into real FM homes. */
const RETIRED_PLUGIN_REMAP: Record<string, string> = {
    'shell-verb-forge': 'context-menu-manager',
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

/** Core plugins on first launch — System Properties, Fast Search, Visual Filters only. */
export const DEFAULT_INSTALLED_PLUGINS: string[] = [
    'properties',
    'find',
    'filters',
];

/**
 * Selling-pillar plugins that may soft-install when opened from FM homes.
 * Part B wraps (Drop Magnet, Capture, Reality Check, Verb Forge, Transcode,
 * Semantic Desk, Policy Packs) stay marketplace-optional — not first-use chrome.
 */
export const FIRST_USE_PLUGINS: string[] = [
    'project-sandbox',
    'library-health',
    'capacity-solver',
    'inbound-volume',
    'branching-time',
];

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
        description: 'Inside-BNDZ menus, Windows Explorer inject (Deploy), live shell-extension pin/hide, and Explorer verb forge.',
        isInstalled: false,
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
        isInstalled: false,
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
        description: 'Smart folder organization, large-file discovery, and storage cleanup workflows.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: StorageCleanupPlugin,
    },
    {
        ...FolderSyncPluginDef,
        description: 'Automatic folder sync with live watching — keeps backup folders up to date using robocopy.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: FolderSyncPlugin,
    },
    {
        ...CatalogPluginDef,
        description: 'Virtual collections of paths — browse as /vf folders, add selections from any pane.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: CatalogPlugin,
    },
    {
        ...ActionLogPluginDef,
        description: 'Reversible operation history with undo/redo — XYplorer-style action log.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: ActionLogPlugin,
    },
    {
        ...ComparePluginDef,
        description: 'Binary file compare and recursive folder diff — XYplorer branch compare parity.',
        isInstalled: false,
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
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: GhostLinkPlugin,
    },
    {
        ...RamStagingPluginDef,
        description: 'RAM-disk staging zones — stage projects at memory speed, flush on eject. Browse at /bndz/ram.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: RamStagingPlugin,
    },
    {
        ...ProjectSandboxPluginDef,
        description: 'Isolated sandbox sessions — experiment freely, checkpoint, commit or discard changes.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: ProjectSandboxPlugin,
    },
    {
        ...LibraryHealthPluginDef,
        description: 'Scan libraries for broken links, naming conflicts, permission issues, and orphans.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: LibraryHealthPlugin,
    },
    {
        ...CapacitySolverPluginDef,
        description: 'Analyze storage and build cleanup plans to free space on any volume.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: CapacitySolverPlugin,
    },
    {
        ...InboundVolumePluginDef,
        description: 'Clipboard catcher and inbound file watcher — capture, review, and copy into your library.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: InboundVolumePlugin,
    },
    {
        ...BranchingTimePluginDef,
        description: 'Content-addressed folder branches — snapshot, scrub, restore. Git for folders without git.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: BranchingTimePlugin,
    },
    {
        ...DropMagnetPluginDef,
        description: 'Named landing pads — drop files to rename, tag, and route in one release.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: DropMagnetPlugin,
    },
    {
        ...CaptureInboxPluginDef,
        description: 'Screenshot and clipboard images saved as named PNG files via Windows OCR.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: CaptureInboxPlugin,
    },
    {
        ...RealityCheckPluginDef,
        description: 'Compare on-disk assets against project and DAW session references — missing files glow in the list.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: RealityCheckPlugin,
    },
    {
        ...TranscodeRackPluginDef,
        description: 'Batch image transcode rack — JPEG, PNG, WebP encode queue with live progress.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: TranscodeRackPlugin,
    },
    {
        ...SemanticDeskPluginDef,
        description: 'Semantic desk overlay — cluster folder items into 3–8 piles with list group headers.',
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: SemanticDeskPlugin,
    },
    {
        ...PolicyPackPluginDef,
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: PolicyPackPlugin,
    },
    {
        ...ZkVaultPluginDef,
        isInstalled: false,
        isNative: true,
        targetPanel: 'bottom',
        component: ZkVaultPlugin,
    },
    {
        ...DesignBoardPluginDef,
        isInstalled: false,
        isNative: true,
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

        // FilesMerge: undo wipe-to-empty; seed core plugins + System Properties; Command Deck off.
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
