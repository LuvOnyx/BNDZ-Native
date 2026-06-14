import React, { createContext, useContext, useState, useEffect, ReactNode, useRef, useCallback } from 'react';
import { IPC } from '../../../lib/ipcBridge';
import { useAppConfig } from '../../../data/configContext';
import { formatLibrariesForConfig } from '../../../lib/iconLibraryUtils';
import { buildDefaultIconLibraries } from '../../../data/defaultIconLibraries';

export interface IconItem {
    id: string;
    name: string;
    hex?: string;
    icoStr: string;
}

export interface IconLibrary {
    id: string;
    name: string;
    icons: IconItem[];
    sourceFolder?: string;
}

const ICON_EXT = /\.(ico|png|jpg|jpeg|bmp|webp|gif)$/i;
const LOCAL_SAVE_MS = 800;
const NATIVE_SYNC_MS = 4000;

function normPath(p: string): string {
    return p.replace(/\\/g, '/');
}

function iconNameFromPath(p: string): string {
    return (p.split(/[/\\]/).pop() || 'Icon').replace(ICON_EXT, '');
}

interface IconStudioState {
    libraries: IconLibrary[];
    activeLibraryId: string;
    isApplying: boolean;
    isImporting: boolean;
    createLibrary: (name: string) => string;
    deleteLibrary: (id: string) => void;
    renameLibrary: (id: string, newName: string) => void;
    setActiveLibraryId: (id: string) => void;
    setIsApplying: (v: boolean) => void;
    importIcon: (libraryId: string, iconPath: string) => void;
    importIconsFromPaths: (libraryId: string | null, paths: string[]) => Promise<boolean>;
    importLibraryFromFolder: () => Promise<void>;
    removeIcon: (libraryId: string, iconId: string) => void;
}

const IconStudioContext = createContext<IconStudioState | undefined>(undefined);

export function IconStudioProvider({
    children,
    nativeSyncEnabled = true,
}: {
    children: ReactNode;
    nativeSyncEnabled?: boolean;
}) {
    const { config, updateConfig } = useAppConfig();

    const normalizeLibraries = useCallback((libs: any[]): IconLibrary[] => libs.map((l: any) => ({
        id: l.id || `lib_${l.name}`,
        name: l.name || 'Library',
        sourceFolder: l.sourceFolder,
        icons: (l.icons || []).map((ic: any, i: number) => {
            if (typeof ic === 'string') {
                const file = ic.split(/[/\\]/).pop() || ic;
                return {
                    id: `ico_${i}_${file.replace(/\W/g, '_')}`,
                    name: iconNameFromPath(ic),
                    icoStr: normPath(ic),
                };
            }
            return {
                id: ic.id || `ico_${i}`,
                name: ic.name || 'Icon',
                icoStr: normPath(ic.icoStr || ''),
            };
        }).filter((ic: IconItem) => !!ic.icoStr),
    })), []);

    const [libraries, setLibraries] = useState<IconLibrary[]>(() =>
        config.iconLibraries?.length ? normalizeLibraries(config.iconLibraries) : []
    );
    const [activeLibraryId, setActiveLibraryId] = useState<string>(() => libraries[0]?.id || '');
    const [isApplying, setIsApplying] = useState(false);
    const [isImporting, setIsImporting] = useState(false);

    const librariesRef = useRef(libraries);
    librariesRef.current = libraries;
    const hydratedRef = useRef(false);
    const dirtyRef = useRef(false);
    const nativeSyncInFlight = useRef(false);
    const localSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const nativeSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastSyncedJson = useRef('');

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const libs = await IPC.getIconLibraries();
                if (cancelled) return;
                if (libs?.length > 0) {
                    const formatted = normalizeLibraries(libs);
                    setLibraries(formatted);
                    setActiveLibraryId(prev => formatted.some(l => l.id === prev) ? prev : (formatted[0]?.id || ''));
                    lastSyncedJson.current = JSON.stringify(formatLibrariesForConfig(formatted));
                } else if (config.iconLibraries?.length) {
                    const formatted = normalizeLibraries(config.iconLibraries);
                    setLibraries(formatted);
                    setActiveLibraryId(prev => formatted.some(l => l.id === prev) ? prev : (formatted[0]?.id || ''));
                } else if (!config.iconLibrariesInitialized) {
                    // First run only: seed starter libraries. Never re-seed after the user
                    // has intentionally emptied their libraries.
                    const defaults = buildDefaultIconLibraries();
                    setLibraries(defaults);
                    setActiveLibraryId(defaults[0]?.id || '');
                    dirtyRef.current = true;
                    updateConfig({ iconLibrariesInitialized: true });
                }
            } catch {
                if (!cancelled && config.iconLibraries?.length) {
                    setLibraries(normalizeLibraries(config.iconLibraries));
                }
            }
            hydratedRef.current = true;
        })();
        return () => { cancelled = true; };
    }, []);

    const saveLocalConfig = useCallback((libs: IconLibrary[]) => {
        if (!hydratedRef.current) return;
        updateConfig({ iconLibraries: formatLibrariesForConfig(libs) });
    }, [updateConfig]);

    const flushNativeSync = useCallback(async (libs: IconLibrary[]) => {
        // Empty array is a valid payload — "delete all libraries" must persist too
        if (nativeSyncInFlight.current) return;
        const payload = formatLibrariesForConfig(libs);
        const json = JSON.stringify(payload);
        if (json === lastSyncedJson.current) {
            dirtyRef.current = false;
            return;
        }
        nativeSyncInFlight.current = true;
        try {
            const ok = await IPC.syncIconLibraries(libs);
            if (ok !== false) {
                lastSyncedJson.current = json;
                dirtyRef.current = false;
            }
        } catch {
            /* timeout — keep dirty, retry on next edit */
        } finally {
            nativeSyncInFlight.current = false;
        }
    }, []);

    const schedulePersist = useCallback((libs: IconLibrary[], markDirty = true) => {
        if (!hydratedRef.current) return;
        if (markDirty) dirtyRef.current = true;

        if (localSaveTimer.current) clearTimeout(localSaveTimer.current);
        localSaveTimer.current = setTimeout(() => saveLocalConfig(libs), LOCAL_SAVE_MS);

        if (!nativeSyncEnabled) return;
        if (nativeSyncTimer.current) clearTimeout(nativeSyncTimer.current);
        nativeSyncTimer.current = setTimeout(() => {
            if (dirtyRef.current) void flushNativeSync(libs);
        }, NATIVE_SYNC_MS);
    }, [saveLocalConfig, flushNativeSync, nativeSyncEnabled]);

    const commitLibraries = useCallback((
        updater: (prev: IconLibrary[]) => IconLibrary[],
        markDirty = true,
    ) => {
        setLibraries(prev => {
            const next = updater(prev);
            schedulePersist(next, markDirty);
            return next;
        });
    }, [schedulePersist]);

    useEffect(() => {
        if (!nativeSyncEnabled && dirtyRef.current) {
            void flushNativeSync(librariesRef.current);
        }
    }, [nativeSyncEnabled, flushNativeSync]);

    useEffect(() => () => {
        if (localSaveTimer.current) clearTimeout(localSaveTimer.current);
        if (nativeSyncTimer.current) clearTimeout(nativeSyncTimer.current);
        if (dirtyRef.current) {
            void flushNativeSync(librariesRef.current);
        }
    }, [flushNativeSync]);

    const createLibrary = (name: string): string => {
        const id = `lib-${Date.now()}`;
        commitLibraries(prev => [...prev, { id, name, icons: [] }]);
        setActiveLibraryId(id);
        return id;
    };

    const deleteLibrary = (id: string) => {
        const newLibs = librariesRef.current.filter(l => l.id !== id);
        commitLibraries(() => newLibs);
        if (activeLibraryId === id) {
            setActiveLibraryId(newLibs[0]?.id || '');
        }
    };

    const removeIcon = (libraryId: string, iconId: string) => {
        commitLibraries(prev => prev.map(l =>
            l.id === libraryId ? { ...l, icons: l.icons.filter(i => i.id !== iconId) } : l
        ));
    };

    const renameLibrary = (id: string, newName: string) => {
        commitLibraries(prev => prev.map(l => l.id === id ? { ...l, name: newName } : l));
    };

    const importIconsFromPaths = useCallback(async (libraryId: string | null, paths: string[]) => {
        const iconPaths = paths.filter(p => ICON_EXT.test(p));
        if (!iconPaths.length) return false;

        setIsImporting(true);
        try {
            let newActiveId = '';
            commitLibraries(prev => {
                let targetId = libraryId || activeLibraryId;
                let libs = prev;
                if (!targetId || !libs.some(l => l.id === targetId)) {
                    const baseName = iconNameFromPath(iconPaths[0]) || 'Dropped Icons';
                    targetId = `lib-${Date.now()}`;
                    libs = [...libs, { id: targetId, name: `${baseName} Library`, icons: [] }];
                }
                newActiveId = targetId;
                return libs.map(l => {
                    if (l.id !== targetId) return l;
                    const existing = new Set(l.icons.map(i => normPath(i.icoStr).toLowerCase()));
                    const added: IconItem[] = [];
                    for (const raw of iconPaths) {
                        const icoStr = normPath(raw);
                        if (existing.has(icoStr.toLowerCase())) continue;
                        existing.add(icoStr.toLowerCase());
                        added.push({
                            id: `ico_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                            name: iconNameFromPath(raw),
                            icoStr,
                        });
                    }
                    return added.length ? { ...l, icons: [...l.icons, ...added] } : l;
                });
            });
            if (newActiveId) setActiveLibraryId(newActiveId);
            return true;
        } finally {
            setIsImporting(false);
        }
    }, [activeLibraryId, commitLibraries]);

    const importIcon = (libraryId: string, iconPath: string) => {
        void importIconsFromPaths(libraryId, [iconPath]);
    };

    const importLibraryFromFolder = async () => {
        const folderPath = await IPC.openFolderDialog('Select a folder containing your icon collection');
        if (!folderPath) return;

        setIsImporting(true);
        try {
            const icons = await IPC.scanIconFolder(folderPath, config.autoConvertIcons ?? true);
            if (!icons.length) {
                alert('No supported icon files found (.ico, .png, .jpg, .bmp, .webp).');
                return;
            }
            const libName = folderPath.split('\\').pop() || folderPath.split('/').pop() || 'Imported Library';
            const id = `lib-${Date.now()}`;
            const newLib: IconLibrary = {
                id,
                name: libName,
                sourceFolder: folderPath,
                icons: icons.map((ic, i) => ({
                    id: `ico_${Date.now()}_${i}`,
                    name: ic.name,
                    icoStr: normPath(ic.icoStr),
                })),
            };
            commitLibraries(prev => [...prev, newLib]);
            setActiveLibraryId(id);
        } finally {
            setIsImporting(false);
        }
    };

    const importRef = useRef(importIconsFromPaths);
    importRef.current = importIconsFromPaths;

    useEffect(() => {
        const onExternalDrop = async (e: Event) => {
            if (!nativeSyncEnabled) return;
            const paths = (e as CustomEvent).detail?.paths as string[] | undefined;
            if (!paths?.length) return;
            const ok = await importRef.current(null, paths);
            if (!ok) {
                const hasIcons = paths.some(p => ICON_EXT.test(p));
                if (!hasIcons) return;
                const elevated = window.confirm(
                    'Could not import dropped icons. BNDZ may need administrator rights to read files from protected locations.\n\nRestart as administrator?'
                );
                if (elevated) {
                    try { await IPC.relaunchAsAdmin(); } catch { /* native only */ }
                }
            }
        };
        window.addEventListener('bndz-external-drop', onExternalDrop);
        return () => window.removeEventListener('bndz-external-drop', onExternalDrop);
    }, [nativeSyncEnabled]);

    return (
        <IconStudioContext.Provider value={{
            libraries, activeLibraryId, isApplying, isImporting,
            createLibrary, deleteLibrary, renameLibrary, setActiveLibraryId, setIsApplying,
            importIcon, importIconsFromPaths, importLibraryFromFolder, removeIcon,
        }}>
            {children}
        </IconStudioContext.Provider>
    );
}

export function useIconStudio() {
    const context = useContext(IconStudioContext);
    if (!context) throw new Error("useIconStudio must be used within IconStudioProvider");
    return context;
}
