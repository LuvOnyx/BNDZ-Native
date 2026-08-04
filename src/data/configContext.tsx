import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { formatLibrariesForConfig } from '../lib/iconLibraryUtils';
import { SETTINGS_DEFAULTS, SETTINGS_VALUE_PATCHES } from '../lib/settingsDefaults';
import { applySettingsRuntime } from '../lib/settingsRuntime';
import { DEFAULT_CUSTOM_COLUMNS, resolveCustomColumns, type CustomColumnDef } from '../lib/customColumns';
import { DEFAULT_STANDARD_FIELD_IDS, DEFAULT_EXTRA_FIELD_IDS } from '../lib/fileInfoTipFields';
import { DEFAULT_HOVER_BOX_CONTEXTS, DEFAULT_HOVER_BOX_ITEM_TYPES } from '../lib/hoverBoxConfig';
import { DEFAULT_TREE_LIST_VISIBLE_ITEM_TYPES, type TreeListItemType } from '../lib/treeListItemFilter';
import type { CustomEventAction } from '../lib/customEventActions';
import { DEFAULT_OUTER_LAYOUT, DEFAULT_INNER_LAYOUT, DEFAULT_DUAL_PANE_LAYOUT, DEFAULT_MAIN_ROW_LAYOUT, WORKSPACE_LAYOUT_VERSION } from '../lib/workspaceLayout';

export interface VisualFilter {
    id: string;
    isActive: boolean;
    name: string;
    matchType: 'extension' | 'regex' | 'age' | 'size' | 'event' | 'attribute';
    matchValue: string; // for event: 'modifiedToday', 'createdWithin24Hours', 'isReadOnly'
    hexColor?: string; // legacy support
    rowTint?: string; // Highly transparent background color (e.g. rgba(255,0,0,0.1))
    textColor?: string; // Foreground color of the file name
    badgeColor?: string; // Dot color
    targetScope?: string; // specific folder scope if any
}

export interface Tabset {
    id: string;
    name: string;
    panes: any[];
}

export interface IconLibrary {
    id: string;
    name: string;
    icons: string[];
}

export interface AppConfig {
    [key: string]: any;
    savedTabsets?: Tabset[];
    visualFilters?: VisualFilter[];
    iconLibraries?: IconLibrary[];
    iconLibrariesInitialized?: boolean;
    customContextMenuActions?: any[];
    globalContextMenuActions?: any[];
    /** Optional BNDZ stock context rows (Shell Menus). Empty = short core menu. */
    enabledStockContextMenuIds?: string[];
    shellMenuHiddenIds?: string[];
    shellMenuPinnedIds?: string[];
    confirmDeleteOperations?: boolean;
    allowGlobalIconOverwrite?: boolean;
    autoConvertIcons?: boolean;
    overrideWin11MoreOptions?: boolean;
    injectGlobalContextMenu?: boolean;
    enableIconContextSubmenu?: boolean;
    iconCacheBuster?: number;
    enableContextSubmenus: boolean;
    showTopMenubar: boolean;
    enableHistoryNavigation: boolean;
    sortFoldersFirst: boolean;
    showFileExtensions: boolean;
    isDefaultFileManager: boolean;
    inContextMenu: boolean;
    enableEverythingSearch: boolean;
    enableBndzIndexedSearch: boolean;
    enableNativeThumbnails: boolean;
    clearThumbnailCacheOnExit: boolean;
    bypassRecycleBin: boolean;
    alwaysRunElevated?: boolean;
    alwaysRunElevatedConfirmed?: boolean;
    enableGlobalSearchPrefix: boolean;
    globalSearchLimit: number;
    syncUseHashing?: boolean;
    syncDefaultDirection?: 'leftToRight' | 'rightToLeft' | 'bidirectional';
    pinnedFavorites?: Array<{ name: string, path: string, icon: string, label?: string }>;
    /** Default Rapid access paths the user chose to hide (Desktop, Documents, etc.) */
    hiddenRapidAccess?: string[];
    /** Persisted display order for Rapid Access rows (known-folder keys + custom paths). */
    rapidAccessOrder?: string[];
    sidebarOrder?: string[];
    navTreeOrder?: string[];
    installedPlugins?: string[];
    bottomPluginTabOrder?: string[];
    bottomPanelDefaultPlugin?: string;
    bottomPanelRememberTab?: boolean;
    bottomPanelLastTab?: string;
    bottomPanelShowTabIcons?: boolean;
    bottomPanelLazyUnmount?: boolean;
    customUserCommands?: Array<{ id: string; label: string; hint?: string; keywords?: string[]; action: string; shell?: 'powershell' | 'cmd' }>;
    customEventActions?: CustomEventAction[];
    toolbarProfiles?: any[][];
    activeToolbarProfileIndex?: number;
    showHiddenSystemFoldersInTree: boolean;
    useCustomContextMenu: boolean;
    previewCategories: Array<{n: string, d: string, c: boolean}>;
    previewFormats: Array<{i: string, n: string, c: boolean}>;
    colorFilters: Array<{i: number, c: boolean, t: string, style: string, folderIcon?: string}>;
    customColumns?: CustomColumnDef[];
    shellInfoTipStandardFields?: string[];
    shellInfoTipExtraFields?: string[];
    hoverBoxItemTypes?: string[];
    hoverBoxContexts?: string[];
    treeListVisibleItemTypes?: TreeListItemType[];
}

const defaultStructuredConfig: Partial<AppConfig> = {
    visualFilters: [],
    pinnedFavorites: [],
    hiddenRapidAccess: [],
    navigationHistory: [],
    showMiniTree: false,
    listIconSize: 16,
    gridIconSize: 48,
    detailsIconSize: 20,
    pinnedContextActions: [] as Array<{ id: string; label: string; verb?: string }>,
    customUserCommands: [] as Array<{ id: string; label: string; hint?: string; keywords?: string[]; action: string; shell?: 'powershell' | 'cmd' }>,
    customEventActions: [] as CustomEventAction[],
    mouseBindings: {} as Record<string, string>,
    sidebarOrder: ['storage', 'quick', 'cloud', 'tree'],
    folderSizeBarStyle: 'bar',
    appearanceNavTreeColors: 'subtle',
    installedPlugins: [
        'properties',
        'context-menu-manager',
        'batch-rename',
        'find',
        'dropstack',
        'filters',
        'metadata',
        'storage-cleanup',
        'folder-sync',
        'catalog',
        'action-log',
        'compare',
        'ghost-link',
        'ram-staging',
    ],
    customColumns: DEFAULT_CUSTOM_COLUMNS.map(c => ({ ...c })),
    shellInfoTipStandardFields: [...DEFAULT_STANDARD_FIELD_IDS],
    shellInfoTipExtraFields: [...DEFAULT_EXTRA_FIELD_IDS],
    hoverBoxItemTypes: [...DEFAULT_HOVER_BOX_ITEM_TYPES],
    hoverBoxContexts: [...DEFAULT_HOVER_BOX_CONTEXTS],
    treeListVisibleItemTypes: [...DEFAULT_TREE_LIST_VISIBLE_ITEM_TYPES],
    listHoverTooltipsEnabled: true,
    showMediaPreviewInTooltips: true,
    playAudioInHoverTooltips: false,
    tooltipBackgroundColor: '#1e1e24',
    tooltipTextColor: '#e8e8e8',
    tooltipMutedColor: '#9ca3af',
    tooltipCornerRadius: 16,
    whenHoveringOverTheFilename: false,
};

function applyConfigAliases(merged: AppConfig, raw: Partial<AppConfig>): AppConfig {
    if ('fileTagging' in raw) merged.fileTaggingFeature = !!raw.fileTagging;
    if ('dualPane' in raw) merged.dualPaneFeature = raw.dualPane !== false;
    if ('showTopMenuBar' in raw) merged.showTopMenubar = !!raw.showTopMenuBar;
    if ('enableSubmenus' in raw) merged.enableContextSubmenus = !!raw.enableSubmenus;
    // BNDZ custom menu is always primary. Legacy native flags only control shell-verb
    // merge into that menu — never switch to Explorer launch.
    merged.useCustomContextMenu = true;
    if ('useNativeOSContextMenu' in raw && !('useCustomContextMenu' in raw))
        merged.useCustomContextMenu = true;
    if ('nativeContextMenu' in raw && !('useNativeOSContextMenu' in raw)) {
        merged.useNativeOSContextMenu = !!raw.nativeContextMenu;
        merged.useCustomContextMenu = true;
    }
    // Bust stale empty SVG/HEIC thumbnail CAS after Svg.Skia + stream-fallback removal.
    if ((merged.iconCacheBuster ?? 0) < 20) merged.iconCacheBuster = 20;
    if (merged.showLensStage === undefined) merged.showLensStage = true;
    if (merged.lensCollapsedByDefault === undefined) merged.lensCollapsedByDefault = false;
    if (merged.permanentHomeTab === undefined) merged.permanentHomeTab = false;
    if ('keepFoldersOnTop' in raw || 'sortFoldersApart' in raw) {
        merged.sortFoldersFirst = !!(raw.keepFoldersOnTop ?? raw.sortFoldersApart ?? merged.sortFoldersFirst);
    }
    if ('bndzIsDefaultFileManager' in raw) merged.isDefaultFileManager = !!raw.bndzIsDefaultFileManager;
    if ('bndzInShellContextMenu' in raw) merged.inContextMenu = !!raw.bndzInShellContextMenu;
    if ('deleteToRecycleBin' in raw && !('bypassRecycleBin' in raw))
        merged.bypassRecycleBin = !raw.deleteToRecycleBin;
    if (merged.enableContextSubmenus === undefined) merged.enableContextSubmenus = true;
    if (merged.audioVideoPreview === false) merged.audioVideoPreview = 'Play once';
    if (merged.autoRefresh === undefined) merged.autoRefresh = true;
    if (merged.alwaysShowFolderSizes === undefined) merged.alwaysShowFolderSizes = true;
    if (merged.cacheFolderSizes === undefined) merged.cacheFolderSizes = true;
    if (merged.onlyWhileTheShiftKeyIsHeldDown === undefined) merged.onlyWhileTheShiftKeyIsHeldDown = true;
    if (merged.showFileInfoTips === undefined) merged.showFileInfoTips = true;
    if ((merged.tooltipBehaviorVersion ?? 0) < 1) {
        merged.onlyWhileTheShiftKeyIsHeldDown = true;
        merged.tooltipBehaviorVersion = 1;
    }
    if ((merged.tooltipBehaviorVersion ?? 0) < 2) {
        merged.listHoverTooltipsEnabled = merged.listHoverTooltipsEnabled !== false;
        merged.tooltipBehaviorVersion = 2;
    }
    if ((merged.tooltipBehaviorVersion ?? 0) < 3) {
        // v2 incorrectly forced filename-hover tooltips always on — restore shift-gated defaults.
        merged.whenHoveringOverTheFilename = false;
        merged.onlyWhileTheShiftKeyIsHeldDown = merged.onlyWhileTheShiftKeyIsHeldDown !== false;
        merged.tooltipBehaviorVersion = 3;
    }
    if (merged.showTreeGlider !== false) merged.showTreeGlider = false;
    if ((merged.customColumnsVersion ?? 0) < 1) {
        const cols = resolveCustomColumns(merged);
        merged.customColumns = cols.map(c => ({ ...c, enabled: false }));
        merged.customColumnsVersion = 1;
    }
    if ((merged.customColumnsVersion ?? 0) < 2) {
        // v2: metadata columns must stay in Choose Columns only — never on by default.
        const cols = resolveCustomColumns(merged);
        merged.customColumns = cols.map(c => ({ ...c, enabled: false }));
        merged.customColumnsVersion = 2;
    }
    if (merged.inTreeAsWell === undefined) merged.inTreeAsWell = true;
    if ((merged.folderSizeViewVersion ?? 0) < 1) {
        merged.folderSizeVisualization = 'list';
        merged.folderSizeViewVersion = 1;
    }
    if (merged.fileTaggingFeature === undefined) {
        merged.fileTaggingFeature = merged.fileTagging !== false;
    }
    if ((merged.xCloseActionVersion ?? 0) < 1) {
        // Reset silent tray-on-X so the close dialog asks again; choice is remembered after.
        merged.xCloseAction = 'ask';
        merged.minimizeToTrayOnXClose = false;
        merged.xCloseActionVersion = 1;
    } else if (merged.xCloseAction !== 'ask' && merged.xCloseAction !== 'tray' && merged.xCloseAction !== 'quit') {
        merged.xCloseAction = merged.minimizeToTrayOnXClose ? 'tray' : 'ask';
    }
    if (typeof merged.permanentStartupPath !== 'string') merged.permanentStartupPath = '';
    if (typeof merged.newTabPath !== 'string' || !String(merged.newTabPath).trim()) {
        merged.newTabPath = '/bndz/home';
    }
    if (typeof merged.startupWindowState !== 'string' || !merged.startupWindowState || merged.startupWindowState === 'false') {
        merged.startupWindowState = 'Normal';
    }
    if (typeof merged.startupPane !== 'string' || !merged.startupPane || merged.startupPane === 'false') {
        merged.startupPane = 'Last active panel';
    }
    if ((merged.folderColorFilterVersion ?? 0) < 2) {
        // v2: drop auto green folder icons on recent-change filters — keep row chrome only.
        const rows = Array.isArray(merged.colorFilters) ? merged.colorFilters : [];
        merged.colorFilters = rows.map((row: any) => {
            const t = String(row?.t || '').toLowerCase();
            if (!t.includes('agem:')) return row;
            if (!row?.folderIcon) return row;
            const { folderIcon: _removed, ...rest } = row;
            return rest;
        });
        merged.folderColorFilterVersion = 2;
    }
    return merged;
}

/** Map ConfigurationDialog alias keys to canonical runtime keys */
export function normalizeConfig(raw: Partial<AppConfig>): AppConfig {
    const merged: AppConfig = {
        ...SETTINGS_DEFAULTS,
        ...SETTINGS_VALUE_PATCHES,
        ...defaultStructuredConfig,
        ...raw,
    } as AppConfig;
    return applyConfigAliases(merged, raw);
}

export function mergeWithDefaults(saved?: Partial<AppConfig> | null): AppConfig {
    return normalizeConfig(saved || {});
}

export const defaultConfig: AppConfig = normalizeConfig({
    toolbarProfiles: [
        [
            { id: "nav_back" }, { id: "nav_forward" }, { id: "nav_up" },
            { id: "separator" },
            { id: "go_home" },
            { id: "spacer" },
            { id: "cut" }, { id: "copy" }, { id: "paste" }, { id: "delete" },
            { id: "separator" },
            { id: "undo" }, { id: "redo" },
            { id: "spacer" },
            { id: "view_details" },
            { id: "separator" },
            { id: "refresh" },
            { id: "spacer" },
            { id: "config" }, { id: "extension_hub" }, { id: "wrench" }
        ]
    ],
    activeToolbarProfileIndex: 0,
    workspaceLayoutOuter: { ...DEFAULT_OUTER_LAYOUT },
    workspaceLayoutInner: { ...DEFAULT_INNER_LAYOUT },
    workspaceLayoutMainRow: { ...DEFAULT_MAIN_ROW_LAYOUT },
    workspaceLayoutPanes: { ...DEFAULT_DUAL_PANE_LAYOUT },
    workspaceLayoutVersion: WORKSPACE_LAYOUT_VERSION,
    previewPanelOpen: true,
    /** When true, preview sits above the bottom plugin panel (inside workspace). Default false = classic full-height outer preview. */
    previewDockedInWorkspace: false,
    bottomPanelOpen: true,
    bottomPluginTabOrder: [],
    bottomPanelDefaultPlugin: 'properties',
    bottomPanelRememberTab: true,
    bottomPanelLastTab: 'properties',
    configurationRememberTab: true,
    configurationLastTab: 'Menus & Context',
    configurationScrollByTab: {},
    listSelectionChrome: 'fullRow',
    showQuickActionsBar: false,
    bottomPanelShowTabIcons: true,
    bottomPanelLazyUnmount: true,
    alwaysOnTop: false,
    showHiddenSystemFoldersInTree: false,
    useCustomContextMenu: true,
    enableIconContextSubmenu: true,
    enableContextSubmenus: true,
    enabledStockContextMenuIds: [],
    injectGlobalContextMenu: false,
    allowGlobalIconOverwrite: false,
    autoConvertIcons: true,
    highResNativeWindowsThumbnails: true,
    // Off by default — folder collage/shell thumbs on system roots (C:\Windows etc.) hang IPC.
    showFolderThumbnails: false,
    showCachedThumbnailsOnly: false,
    showThumbnailsForRawFiles: true,
    showThumbnailsForNonImages: true,
    showThumbnailsInTitlesViews: true,
    autoRotateThumbnails: true,
    showFileIconOnThumbnail: true,
    lockTreeState: false,
    previewCategories: [
        {n:"Text Files", d:"bat, inf, ini, txt ...", c:true},
        {n:"Document Files", d:"docx, odt, pdf, xlsx ...", c:true},
        {n:"Web Files", d:"htm, svg, url, xml, zip ...", c:true},
        {n:"Font Files", d:"fon, otf, pfm, ttf ...", c:true},
        {n:"Image Files", d:"gif, jpg, png, raw ...", c:true},
        {n:"Audio Files", d:"flac, mp3, ogg, wav ...", c:true},
        {n:"Video Files", d:"avi, mp4, mpg, wmv ...", c:true},
        {n:"Archive Files", d:"zip, rar, 7z, tar, gz, torrent ...", c:true},
        {n:"Preview as Thumbnail", d:"afphoto, slddrw, webp ...", c:true},
        {n:"User-Defined Preview Handlers", d:"", c:true}
    ],
    previewFormats: [
        {i:"txt", n:"*.accurip, ACCURIP File", c:true},
        {i:"txt", n:"*.adml, ADML File", c:true},
        {i:"txt", n:"*.admx, ADMX File", c:true},
        {i:"txt", n:"*.ahk, AHK File", c:true},
        {i:"txt", n:"*.asc, ASC File", c:true},
        {i:"txt", n:"*.asm, Assembler Source", c:true},
        {i:"txt", n:"*.asp, aspfile", c:true},
        {i:"txt", n:"*.aspx, ASPX File", c:true},
        {i:"txt", n:"*.au3, AU3 File", c:true},
        {i:"txt", n:"*.b64, B64 File", c:true},
        {i:"txt", n:"*.bas, BAS File", c:true},
        {i:"bat", n:"*.bat, Windows Batch File", c:true},
        {i:"txt", n:"*.c, C File", c:true},
        {i:"cer", n:"*.cer, Security Certificate", c:true},
        {i:"txt", n:"*.cfg, CFG File", c:true},
        {i:"txt", n:"*.cls, CLS File", c:true}
    ],
    colorFilters: [
        {i: 1, c: true, t: "len:>260 //overlong filenames", style: "bg-[#E05B5B] text-white px-1"},
        {i: 2, c: true, t: "attr:junction", style: "text-[#8F66D6] px-1"},
        {i: 3, c: true, t: "attr:system", style: "bg-[#F4D03F] text-black px-1"},
        {i: 4, c: true, t: "attr:encrypted", style: "text-[#2ECC71] px-1"},
        {i: 5, c: true, t: "attr:compressed", style: "text-[#3498DB] px-1"},
        {i: 6, c: true, t: "ageM: <= 30 n //modified in the last 30 mins", style: "bg-[#82E05B] text-black px-1"},
        {i: 7, c: true, t: "ageM: d //modified today", style: "bg-[#82E05B] text-white px-1"},
        {i: 8, c: true, t: "attr:d", style: "text-[#B6B6B6] px-1"},
        {i: 9, c: true, t: "size:0 //empty files", style: "bg-[#FDFDFD] text-[#3498DB] px-1"},
        {i: 10, c: true, t: "B:prop:#empty:2|f-s //empty folders", style: "bg-transparent text-white px-1 border border-white"},
        {i: 11, c: true, t: "L:prop:#nosubs:2 //folders without subs", style: "text-[#3498DB] px-1"},
        {i: 12, c: true, t: "*.exe;*.bat", style: "text-[#E74C3C] px-1"},
        {i: 13, c: true, t: "*.htm;*.html;*.php", style: "text-[#3498DB] px-1"},
        {i: 14, c: true, t: "*.txt;*.ini", style: "text-[#3498DB] px-1"},
        {i: 15, c: true, t: "*.png;*.jpg;*.gif;*.bmp", style: "text-[#9B59B6] px-1"},
        {i: 16, c: true, t: "*.zip;*.rar", style: "text-[#F39C12] px-1"},
        {i: 17, c: true, t: "*.dll;*.ocx", style: "text-[#E74C3C] px-1"},
        {i: 18, c: true, t: "*.mp3;*.wav", style: "text-[#3498DB] px-1"}
    ],
});

let settingsSaveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSettingsSave: AppConfig | null = null;
let settingsSaveChain: Promise<void> = Promise.resolve();

function scheduleSettingsSave(merged: AppConfig) {
    pendingSettingsSave = merged;
    // When "Save settings on exit" is off, keep the in-memory draft but skip disk writes
    // until Apply / persistConfigNow / exit-with-save.
    if (merged.saveSettingsOnExit === false) return;
    if (settingsSaveTimer) return;
    settingsSaveTimer = setTimeout(() => {
        settingsSaveTimer = null;
        void flushPendingSettingsSave();
    }, 250);
}

/** Drop any debounced settings write so Exit/Restart without Saving can skip persist. */
export function discardPendingSettingsSave() {
    if (settingsSaveTimer) {
        clearTimeout(settingsSaveTimer);
        settingsSaveTimer = null;
    }
    pendingSettingsSave = null;
}

/**
 * Flush any pending settings write and wait until it hits disk.
 * Critical before quit / tray — otherwise remember-decision races the process exit.
 */
export function flushPendingSettingsSave(): Promise<void> {
    if (settingsSaveTimer) {
        clearTimeout(settingsSaveTimer);
        settingsSaveTimer = null;
    }
    const payload = pendingSettingsSave;
    pendingSettingsSave = null;
    if (!payload) return settingsSaveChain;

    settingsSaveChain = settingsSaveChain
        .catch(() => {})
        .then(() =>
            import('../lib/ipcBridge').then(({ IPC }) => IPC.saveSettings(payload)).then(() => {})
        )
        .catch(() => {});
    return settingsSaveChain;
}

/** Merge + persist immediately (awaits disk). Use for close-remember and other must-survive writes. */
export async function persistConfigNow(
    current: AppConfig,
    patch: Partial<AppConfig>,
    setConfig: (cfg: AppConfig) => void,
): Promise<AppConfig> {
    const merged = normalizeConfig({ ...current, ...patch });
    setConfig(merged);
    applySettingsRuntime(merged);
    // Explicit persist paths may force shell sync (Settings toggles call IPC directly too).
    const { applyBackendSettings } = await import('../lib/settingsRuntime');
    applyBackendSettings(merged);
    if (settingsSaveTimer) {
        clearTimeout(settingsSaveTimer);
        settingsSaveTimer = null;
    }
    pendingSettingsSave = null;
    await import('../lib/ipcBridge').then(({ IPC }) => IPC.saveSettings(merged));
    return merged;
}

const ConfigContext = createContext<{ config: AppConfig; updateConfig: (v: Partial<AppConfig>) => void }>({
    config: defaultConfig,
    updateConfig: () => {}
});

export const ConfigProvider = ({ children }: { children: ReactNode }) => {
    const [config, setConfig] = useState<AppConfig>(defaultConfig);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        import('../lib/ipcBridge').then(({ IPC }) => {
            const init = async () => {
                try {
                    const saved = await IPC.loadSettings();
                    let cfg = saved ? mergeWithDefaults(saved) : defaultConfig;

                    // Apply settings immediately so the splash/gate is not blocked on icon libs.
                    setConfig(cfg);
                    applySettingsRuntime(cfg);
                    // Soft fingerprint-gated shell sync only — forced registry rewrites on boot
                    // previously stalled the host ("BNDZ is not responding").
                    setLoaded(true);

                    if (IPC.isNative) {
                        try {
                            const libs = await IPC.getIconLibraries();
                            if (Array.isArray(libs) && libs.length) {
                                const next = { ...cfg, iconLibraries: formatLibrariesForConfig(libs) };
                                setConfig(next);
                            }
                        } catch { /* keep saved iconLibraries */ }
                    }
                    return;
                } catch {
                    setConfig(defaultConfig);
                }
                setLoaded(true);
            };
            init();
        });
    }, []);

    const updateConfig = useCallback((newVals: Partial<AppConfig>) => {
        setConfig(prev => {
            const merged = normalizeConfig({ ...prev, ...newVals });
            scheduleSettingsSave(merged);
            // applySettingsRuntime already soft-schedules shell sync via fingerprint.
            // Never call applyBackendSettings(force) here — that rewrote HKCU shell verbs
            // on every column/intent/plugin tweak and hung the WPF host after first paint.
            applySettingsRuntime(merged);
            return merged;
        });
    }, []);

    if (!loaded) {
        return (
            <div className="w-screen h-screen flex flex-col items-center justify-center bg-[#111114] text-gray-400 gap-3 select-none">
                <div className="w-8 h-8 rounded-full border-2 border-[#0078d4]/30 border-t-[#0078d4] animate-spin" />
                <span className="text-[11px] tracking-wide text-gray-500">Loading BNDZ…</span>
            </div>
        );
    }

    return <ConfigContext.Provider value={{ config, updateConfig }}>{children}</ConfigContext.Provider>;
};

export const useAppConfig = () => useContext(ConfigContext);
