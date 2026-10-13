import React, { createContext, useContext, useState, useEffect, ReactNode, useRef, useCallback } from 'react';
import { IPC } from '../../../lib/ipcBridge';
import { useAppConfig } from '../../../data/configContext';
import { formatLibrariesForConfig } from '../../../lib/iconLibraryUtils';
import { buildDefaultIconLibraries } from '../../../data/defaultIconLibraries';
import { pushToast } from '../../ToastHost';

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
    selectedIcon: IconItem | null;
    createLibrary: (name: string) => string;
    deleteLibrary: (id: string) => void;
    renameLibrary: (id: string, newName: string) => void;
    setActiveLibraryId: (id: string) => void;
    setIsApplying: (v: boolean) => void;
    setSelectedIcon: (icon: IconItem | null) => void;
    importIcon: (libraryId: string, iconPath: string) => void;
    importIconsFromPaths: (libraryId: string | null, paths: string[]) => Promise<boolean>;
    importLibraryFromFolder: () => Promise<void>;
    importIconsViaPicker: () => Promise<void>;
    removeIcon: (libraryId: string, iconId: string) => void;
    resyncLibrary: (libraryId: string) => Promise<void>;
    exportLibrary: (libraryId: string) => void;
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
    const [selectedIcon, setSelectedIcon] = useState<IconItem | null>(null);

    const librariesRef = useRef(libraries);
    librariesRef.current = libraries;
    const hydratedRef = useRef(false);
    const dirtyRef = useRef(false);
    const nativeSyncInFlight = useRef(false);
    const localSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const nativeSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastSyncedJson = useRef('');
    const pendingPersistRef = useRef<IconLibrary[] | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const libs = await IPC.getIconLibraries();
                if (cancelled) return;

                const userCleared =
                    !!config.iconLibrariesInitialized
                    && Array.isArray(config.iconLibraries)
                    && config.iconLibraries.length === 0;

                if (userCleared) {
                    // Settings say the user emptied libraries -- never resurrect stale native JSON.
                    setLibraries([]);
                    setActiveLibraryId('');
                    lastSyncedJson.current = '[]';
                    dirtyRef.current = true;
                    try { await IPC.syncIconLibraries([]); } catch { /* heal on next edit */ }
                    lastSyncedJson.current = JSON.stringify([]);
                    dirtyRef.current = false;
                } else if (libs?.length > 0) {
                    const formatted = normalizeLibraries(libs);
                    setLibraries(formatted);
                    setActiveLibraryId(prev => formatted.some(l => l.id === prev) ? prev : (formatted[0]?.id || ''));
                    lastSyncedJson.current = JSON.stringify(formatLibrariesForConfig(formatted));
                    if (!config.iconLibrariesInitialized) {
                        updateConfig({
                            iconLibrariesInitialized: true,
                            iconLibraries: formatLibrariesForConfig(formatted),
                        });
                    }
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
                    updateConfig({
                        iconLibrariesInitialized: true,
                        iconLibraries: formatLibrariesForConfig(defaults),
                    });
                    lastSyncedJson.current = '';
                    try {
                        await IPC.syncIconLibraries(defaults);
                        lastSyncedJson.current = JSON.stringify(formatLibrariesForConfig(defaults));
                        dirtyRef.current = false;
                    } catch { /* keep dirty for later flush */ }
                } else {
                    setLibraries([]);
                    setActiveLibraryId('');
                    lastSyncedJson.current = '[]';
                }
            } catch {
                if (!cancelled && config.iconLibraries?.length) {
                    setLibraries(normalizeLibraries(config.iconLibraries));
                }
            }
            if (cancelled) return;
            hydratedRef.current = true;
            // Apply any edits that raced hydration (import/delete before native reply).
            if (pendingPersistRef.current) {
                const pending = pendingPersistRef.current;
                pendingPersistRef.current = null;
                setLibraries(pending);
                setActiveLibraryId(prev => pending.some(l => l.id === prev) ? prev : (pending[0]?.id || ''));
                dirtyRef.current = true;
                updateConfig({
                    iconLibrariesInitialized: true,
                    iconLibraries: formatLibrariesForConfig(pending),
                });
                try {
                    await IPC.syncIconLibraries(pending);
                    lastSyncedJson.current = JSON.stringify(formatLibrariesForConfig(pending));
                    dirtyRef.current = false;
                } catch { /* retry via schedulePersist */ }
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const saveLocalConfig = useCallback((libs: IconLibrary[]) => {
        if (!hydratedRef.current) return;
        updateConfig({ iconLibraries: formatLibrariesForConfig(libs) });
    }, [updateConfig]);

    const flushNativeSync = useCallback(async (libs: IconLibrary[]) => {
        // Empty array is a valid payload -- "delete all libraries" must persist too
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
            /* timeout -- keep dirty, retry on next edit */
        } finally {
            nativeSyncInFlight.current = false;
        }
    }, []);

    const schedulePersist = useCallback((libs: IconLibrary[], markDirty = true, opts?: { immediate?: boolean }) => {
        if (!hydratedRef.current) {
            pendingPersistRef.current = libs;
            if (markDirty) dirtyRef.current = true;
            return;
        }
        if (markDirty) dirtyRef.current = true;

        // Always mark initialized so an emptied library list never re-seeds starters.
        updateConfig({
            iconLibrariesInitialized: true,
            iconLibraries: formatLibrariesForConfig(libs),
        });

        if (localSaveTimer.current) clearTimeout(localSaveTimer.current);
        if (opts?.immediate) {
            saveLocalConfig(libs);
        } else {
            localSaveTimer.current = setTimeout(() => saveLocalConfig(libs), LOCAL_SAVE_MS);
        }

        if (!nativeSyncEnabled && !opts?.immediate) return;
        if (nativeSyncTimer.current) clearTimeout(nativeSyncTimer.current);
        if (opts?.immediate) {
            void flushNativeSync(libs);
        } else {
            nativeSyncTimer.current = setTimeout(() => {
                if (dirtyRef.current) void flushNativeSync(libs);
            }, NATIVE_SYNC_MS);
        }
    }, [saveLocalConfig, flushNativeSync, nativeSyncEnabled, updateConfig]);

    const commitLibraries = useCallback((
        updater: (prev: IconLibrary[]) => IconLibrary[],
        markDirty = true,
        opts?: { immediate?: boolean },
    ) => {
        setLibraries(prev => {
            const next = updater(prev);
            schedulePersist(next, markDirty, opts);
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
        commitLibraries(() => newLibs, true, { immediate: true });
        if (activeLibraryId === id) {
            setActiveLibraryId(newLibs[0]?.id || '');
        }
    };

    const removeIcon = (libraryId: string, iconId: string) => {
        commitLibraries(prev => prev.map(l =>
            l.id === libraryId ? { ...l, icons: l.icons.filter(i => i.id !== iconId) } : l
        ), true, { immediate: true });
        setSelectedIcon(prev => (prev?.id === iconId ? null : prev));
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
            let addedCount = 0;
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
                    addedCount = added.length;
                    return added.length ? { ...l, icons: [...l.icons, ...added] } : l;
                });
            }, true, { immediate: true });
            if (newActiveId) setActiveLibraryId(newActiveId);
            if (addedCount > 0) {
                pushToast({ kind: 'success', title: 'Icons imported', message: `Added ${addedCount} icon${addedCount === 1 ? '' : 's'} to the library.` });
            }
            return addedCount > 0 || iconPaths.length > 0;
        } finally {
            setIsImporting(false);
        }
    }, [activeLibraryId, commitLibraries]);

    const importIcon = (libraryId: string, iconPath: string) => {
        void importIconsFromPaths(libraryId, [iconPath]);
    };

    const resyncLibrary = async (libraryId: string) => {
        const lib = librariesRef.current.find(l => l.id === libraryId);
        if (!lib?.sourceFolder) {
            pushToast({ kind: 'warning', title: 'No source folder', message: 'Import this library from a folder first to enable resync.' });
            return;
        }
        setIsImporting(true);
        try {
            const icons = await IPC.scanIconFolder(lib.sourceFolder, config.autoConvertIcons ?? true);
            if (!icons.length) {
                pushToast({ kind: 'warning', title: 'Resync empty', message: 'No icons found in the source folder.' });
                return;
            }
            commitLibraries(prev => prev.map(l => {
                if (l.id !== libraryId) return l;
                return {
                    ...l,
                    icons: icons.map((ic, i) => ({
                        id: `ico_${Date.now()}_${i}`,
                        name: ic.name,
                        icoStr: normPath(ic.icoStr),
                    })),
                };
            }), true, { immediate: true });
            pushToast({ kind: 'success', title: 'Library resynced', message: `${icons.length} icons loaded from source folder.` });
        } finally {
            setIsImporting(false);
        }
    };

    const exportLibrary = (libraryId: string) => {
        const lib = librariesRef.current.find(l => l.id === libraryId);
        if (!lib) return;
        const blob = new Blob([JSON.stringify(lib, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${lib.name.replace(/[^\w.-]+/g, '_')}-library.json`;
        a.click();
        URL.revokeObjectURL(url);
        pushToast({ kind: 'success', title: 'Exported', message: `Saved ${lib.name} library definition.` });
    };

    const importLibraryFromFolder = async () => {
        const folderPath = await IPC.openFolderDialog('Select a folder containing your icon collection');
        if (!folderPath) return;

        setIsImporting(true);
        try {
            const icons = await IPC.scanIconFolder(folderPath, config.autoConvertIcons ?? true);
            if (!icons.length) {
                pushToast({ kind: 'warning', title: 'No icons found', message: 'No supported files (.ico, .png, .jpg, .bmp, .webp, .gif) in that folder (including subfolders).' });
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
            commitLibraries(prev => [...prev, newLib], true, { immediate: true });
            setActiveLibraryId(id);
            pushToast({ kind: 'success', title: 'Library imported', message: `${icons.length} icons loaded into "${libName}".` });
        } finally {
            setIsImporting(false);
        }
    };

    const importIconsViaPicker = async () => {
        const files = await IPC.openFileDialog(
            'Icons (*.ico;*.png;*.jpg;*.jpeg;*.bmp;*.webp;*.gif)|*.ico;*.png;*.jpg;*.jpeg;*.bmp;*.webp;*.gif|All files (*.*)|*.*'
        );
        if (!files?.length) return;
        const ok = await importIconsFromPaths(activeLibraryId || null, files);
        if (!ok) {
            pushToast({ kind: 'warning', title: 'Import skipped', message: 'No supported icon files were selected.' });
        }
    };

    const importRef = useRef(importIconsFromPaths);
    importRef.current = importIconsFromPaths;

    useEffect(() => {
        const onExternalDrop = async (e: Event) => {
            if (!nativeSyncEnabled) return;
            const detail = (e as CustomEvent).detail || {};
            const paths = detail.paths as string[] | undefined;
            if (!paths?.length) return;
            const clientX = typeof detail.webViewX === 'number' ? detail.webViewX : null;
            const clientY = typeof detail.webViewY === 'number' ? detail.webViewY : null;
            if (clientX != null && clientY != null) {
                const hit = document.elementFromPoint(clientX, clientY);
                if (!hit?.closest('[data-icon-studio]') && !hit?.closest('.icon-studio')) return;
            }
            const ok = await importRef.current(null, paths);
            if (!ok) {
                const hasIcons = paths.some(p => ICON_EXT.test(p));
                if (!hasIcons) return;
                const elevated = await (async () => {
                    const { requestNativeConfirm } = await import('../../../lib/nativeDialog');
                    return requestNativeConfirm({
                        title: 'Administrator approval required',
                        message: 'Could not import dropped icons. BNDZ may need administrator rights to read files from protected locations.\n\nRestart as administrator?',
                        type: 'warning',
                        confirmLabel: 'Restart as administrator',
                    });
                })();
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
            libraries, activeLibraryId, isApplying, isImporting, selectedIcon,
            createLibrary, deleteLibrary, renameLibrary, setActiveLibraryId, setIsApplying, setSelectedIcon,
            importIcon, importIconsFromPaths, importLibraryFromFolder, importIconsViaPicker, removeIcon, resyncLibrary, exportLibrary,
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
