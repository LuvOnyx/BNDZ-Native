import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { formatLibrariesForConfig } from '../lib/iconLibraryUtils';
import { SETTINGS_DEFAULTS, SETTINGS_VALUE_PATCHES } from '../lib/settingsDefaults';
import { applySettingsRuntime, applyBackendSettings } from '../lib/settingsRuntime';
import { DEFAULT_OUTER_LAYOUT, DEFAULT_INNER_LAYOUT, WORKSPACE_LAYOUT_VERSION } from '../lib/workspaceLayout';
import type { CustomEventAction } from '../lib/customEventActions';

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
    enableNativeThumbnails: boolean;
    clearThumbnailCacheOnExit: boolean;
    bypassRecycleBin: boolean;
    enableGlobalSearchPrefix: boolean;
    globalSearchLimit: number;
    syncUseHashing?: boolean;
    syncDefaultDirection?: 'leftToRight' | 'rightToLeft' | 'bidirectional';
    pinnedFavorites?: Array<{ name: string, path: string, icon: string }>;
    sidebarOrder?: string[];
    navTreeOrder?: string[];
    installedPlugins?: string[];
    bottomPluginTabOrder?: string[];
    bottomPanelDefaultPlugin?: string;
    bottomPanelRememberTab?: boolean;
    bottomPanelLastTab?: string;
    bottomPanelShowTabIcons?: boolean;
    customUserCommands?: Array<{ id: string; label: string; hint?: string; keywords?: string[]; action: string; shell?: 'powershell' | 'cmd' }>;
    customEventActions?: CustomEventAction[];
    toolbarProfiles?: any[][];
    activeToolbarProfileIndex?: number;
    showHiddenSystemFoldersInTree: boolean;
    useCustomContextMenu: boolean;
    previewCategories: Array<{n: string, d: string, c: boolean}>;
    previewFormats: Array<{i: string, n: string, c: boolean}>;
    colorFilters: Array<{i: number, c: boolean, t: string, style: string}>;
}

const defaultStructuredConfig: Partial<AppConfig> = {
    visualFilters: [],
    pinnedFavorites: [],
    navigationHistory: [],
    showMiniTree: false,
    listIconSize: 16,
    gridIconSize: 48,
    pinnedContextActions: [] as Array<{ id: string; label: string; verb?: string }>,
    customUserCommands: [] as Array<{ id: string; label: string; hint?: string; keywords?: string[]; action: string; shell?: 'powershell' | 'cmd' }>,
    customEventActions: [] as CustomEventAction[],
    mouseBindings: {} as Record<string, string>,
    sidebarOrder: ['storage', 'quick', 'cloud', 'tree'],
    installedPlugins: ['properties', 'context-menu-manager', 'icon-studio', 'batch-rename', 'find', 'dropstack', 'filters', 'metadata', 'storage-cleanup', 'folder-sync', 'catalog'],
};

function applyConfigAliases(merged: AppConfig, raw: Partial<AppConfig>): AppConfig {
    if ('fileTagging' in raw) merged.fileTaggingFeature = !!raw.fileTagging;
    if ('dualPane' in raw) merged.dualPaneFeature = raw.dualPane !== false;
    if ('showTopMenuBar' in raw) merged.showTopMenubar = !!raw.showTopMenuBar;
    if ('enableSubmenus' in raw) merged.enableContextSubmenus = !!raw.enableSubmenus;
    if ('useNativeOSContextMenu' in raw && !('useCustomContextMenu' in raw))
        merged.useCustomContextMenu = !raw.useNativeOSContextMenu;
    if ('nativeContextMenu' in raw && !('useCustomContextMenu' in raw))
        merged.useCustomContextMenu = !raw.nativeContextMenu;
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
    if (merged.inTreeAsWell === undefined) merged.inTreeAsWell = true;
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
    workspaceLayoutVersion: WORKSPACE_LAYOUT_VERSION,
    previewPanelOpen: true,
    bottomPanelOpen: true,
    bottomPluginTabOrder: [],
    bottomPanelDefaultPlugin: 'properties',
    bottomPanelRememberTab: true,
    bottomPanelLastTab: 'properties',
    bottomPanelShowTabIcons: true,
    alwaysOnTop: false,
    showHiddenSystemFoldersInTree: false,
    useCustomContextMenu: true,
    enableIconContextSubmenu: true,
    enableContextSubmenus: true,
    injectGlobalContextMenu: false,
    allowGlobalIconOverwrite: false,
    autoConvertIcons: true,
    highResNativeWindowsThumbnails: true,
    showFolderThumbnails: true,
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

                    if (IPC.isNative) {
                        try {
                            const libs = await IPC.getIconLibraries();
                            if (libs?.length) {
                                cfg = { ...cfg, iconLibraries: formatLibrariesForConfig(libs) };
                            }
                        } catch { /* keep saved iconLibraries */ }
                    }

                    setConfig(cfg);
                    applySettingsRuntime(cfg);
                    applyBackendSettings(cfg);
                } catch {
                    setConfig(defaultConfig);
                }
                setLoaded(true);
            };
            init();
        });
    }, []);

    const updateConfig = (newVals: Partial<AppConfig>) => {
        setConfig(prev => {
            const merged = normalizeConfig({ ...prev, ...newVals });
            try {
                import('../lib/ipcBridge').then(({ IPC }) => {
                    IPC.saveSettings(merged);
                });
            } catch {
                alert('Fatal IPC Communication Error: Unable to synchronize settings to backend.');
            }
            applySettingsRuntime(merged);
            applyBackendSettings(merged);
            return merged;
        });
    };

    if (!loaded) {
        return (
            <div className="w-screen h-screen flex flex-col items-center justify-center bg-[#111114] text-gray-400 gap-3 select-none">
                <div className="w-8 h-8 rounded-full border-2 border-sky-500/30 border-t-sky-400 animate-spin" />
                <span className="text-[11px] tracking-wide text-gray-500">Loading BNDZ…</span>
            </div>
        );
    }

    return <ConfigContext.Provider value={{ config, updateConfig }}>{children}</ConfigContext.Provider>;
};

export const useAppConfig = () => useContext(ConfigContext);
