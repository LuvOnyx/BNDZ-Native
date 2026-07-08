import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Icons8Icon } from '../../Icons8Icon';
import { CloseGlyph } from '../../ChromeGlyphs';
import { useIconStudio, type IconItem } from './IconStudioContext';
import { useAppConfig } from '../../../data/configContext';
import IconPreviewImage from './IconPreviewImage';
import styles from './IconStudio.module.css';
import { resolveIconFilePath } from '../../../lib/iconPathUtils';
import { applyIconToTargets } from './iconApply';
import { IPC } from '../../../lib/ipcBridge';
import { pushToast } from '../../ToastHost';
import { PluginToolbarButton, PluginEmptyState, PLUGIN_INPUT_CLASS } from '../PluginPanelPrimitives';

const ICON_EXTENSIONS = ['.ico', '.png', '.jpg', '.jpeg', '.bmp', '.webp', '.gif'];
const COL_MIN = 108;
const GAP = 10;
const ROW_HEIGHT = 118;

type CtxMenu = { x: number; y: number; icon: IconItem };

export default function IconGrid({
    selectedItems,
    targetTypes,
    focusedPath,
}: {
    selectedItems: string[];
    targetTypes?: string[];
    focusedPath: string;
}) {
    const {
        libraries, activeLibraryId, isApplying, isImporting, setIsApplying,
        selectedIcon, setSelectedIcon,
        importIconsFromPaths, importLibraryFromFolder, createLibrary, removeIcon,
    } = useIconStudio();
    const { config } = useAppConfig();
    const activeLibrary = libraries.find(l => l.id === activeLibraryId);

    const [isDragOver, setIsDragOver] = useState(false);
    const [search, setSearch] = useState('');
    const [focusIndex, setFocusIndex] = useState(0);
    const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
    const [cols, setCols] = useState(4);

    const scrollRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    const filteredIcons = useMemo(() => {
        const icons = activeLibrary?.icons || [];
        const q = search.trim().toLowerCase();
        if (!q) return icons;
        return icons.filter(ic => ic.name.toLowerCase().includes(q) || ic.icoStr.toLowerCase().includes(q));
    }, [activeLibrary?.icons, search]);

    const rows = useMemo(() => {
        const r: IconItem[][] = [];
        for (let i = 0; i < filteredIcons.length; i += cols) {
            r.push(filteredIcons.slice(i, i + cols));
        }
        return r;
    }, [filteredIcons, cols]);

    useEffect(() => {
        setSearch('');
        setFocusIndex(0);
    }, [activeLibraryId]);

    useEffect(() => {
        const el = gridRef.current;
        if (!el) return;
        const ro = new ResizeObserver(([entry]) => {
            const w = entry.contentRect.width - 28;
            setCols(Math.max(2, Math.floor((w + GAP) / (COL_MIN + GAP))));
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, [activeLibrary?.id]);

    useEffect(() => {
        setFocusIndex(i => Math.min(i, Math.max(0, filteredIcons.length - 1)));
    }, [filteredIcons.length, search]);

    useEffect(() => {
        if (focusIndex >= 0 && focusIndex < filteredIcons.length) {
            setSelectedIcon(filteredIcons[focusIndex]);
        }
    }, [focusIndex, filteredIcons, setSelectedIcon]);

    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 4,
    });

    const runApply = useCallback(async (icon: IconItem) => {
        setIsApplying(true);
        try {
            await applyIconToTargets({
                icon,
                activeLibrary,
                selectedItems,
                targetTypes,
                focusedPath,
                allowGlobalOverwrite: !!config.allowGlobalIconOverwrite,
            });
        } finally {
            setIsApplying(false);
        }
    }, [activeLibrary, selectedItems, targetTypes, focusedPath, config.allowGlobalIconOverwrite, setIsApplying]);

    const extractPathsFromDrop = (e: React.DragEvent): string[] => {
        const paths: string[] = [];
        const files = Array.from(e.dataTransfer.files) as Array<File & { path?: string }>;
        for (const file of files) {
            if (file.path) paths.push(file.path);
        }
        const uriList = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
        if (uriList) {
            uriList.split(/\r?\n/).forEach(line => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) return;
                const decoded = decodeURIComponent(trimmed.replace(/^file:\/\/\//i, '').replace(/\//g, '\\'));
                if (ICON_EXTENSIONS.some(ext => decoded.toLowerCase().endsWith(ext))) paths.push(decoded);
            });
        }
        return [...new Set(paths)];
    };

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        const paths = extractPathsFromDrop(e);
        if (paths.length > 0) {
            const ok = await importIconsFromPaths(activeLibraryId || null, paths);
            if (!ok) pushToast({ kind: 'warning', title: 'Drop ignored', message: 'Use .ico, .png, .jpg, .bmp, or .webp files.' });
        }
    }, [activeLibraryId, importIconsFromPaths]);

    const handleGridKeyDown = (e: React.KeyboardEvent) => {
        if (!filteredIcons.length) return;
        if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            searchRef.current?.focus();
            return;
        }
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            setFocusIndex(i => Math.min(i + 1, filteredIcons.length - 1));
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            setFocusIndex(i => Math.max(i - 1, 0));
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setFocusIndex(i => Math.min(i + cols, filteredIcons.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setFocusIndex(i => Math.max(i - cols, 0));
        } else if (e.key === 'Enter' && selectedIcon && selectedItems.length > 0) {
            e.preventDefault();
            void runApply(selectedIcon);
        }
    };

    useEffect(() => {
        const closeCtx = () => setCtxMenu(null);
        window.addEventListener('click', closeCtx);
        return () => window.removeEventListener('click', closeCtx);
    }, []);

    const renderTile = (icon: IconItem, index: number) => {
        const isFocused = focusIndex === index;
        const isSelected = selectedIcon?.id === icon.id;
        const canApply = selectedItems.length > 0 && !isApplying;
        const previewPath = resolveIconFilePath(icon.icoStr, activeLibrary?.sourceFolder);

        return (
            <div key={icon.id} className="relative group/tile">
                <button
                    type="button"
                    onClick={() => { setFocusIndex(index); setSelectedIcon(icon); }}
                    onDoubleClick={() => { if (canApply) void runApply(icon); }}
                    onContextMenu={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        setCtxMenu({ x: e.clientX, y: e.clientY, icon });
                        setFocusIndex(index);
                        setSelectedIcon(icon);
                    }}
                    title={canApply ? `Apply to ${selectedItems.length} item(s) · Enter` : 'Select targets in file list'}
                    disabled={isApplying}
                    className={`${styles.iconTile} w-full flex flex-col items-center gap-2 p-2.5 transition-colors ${
                        isFocused || isSelected ? styles.iconTileSelected : ''
                    }`}
                >
                    <div className="w-12 h-12 rounded-lg bg-black/25 flex items-center justify-center border border-white/[0.06]">
                        <IconPreviewImage path={previewPath} size={40} />
                    </div>
                    <span className="text-xs font-medium text-gray-400 truncate w-full text-center">{icon.name}</span>
                </button>
                {isFocused && !isApplying && (
                    <button
                        type="button"
                        title="Remove from library"
                        onClick={(e) => { e.stopPropagation(); removeIcon(activeLibrary!.id, icon.id); }}
                        className="absolute -top-1.5 -right-1.5 z-10 w-5 h-5 rounded-full bg-[#1a1a22] border border-white/10 text-gray-400 hover:text-white hover:bg-rose-600/90 flex items-center justify-center opacity-0 group-hover/tile:opacity-100 transition-all"
                    >
                        <CloseGlyph size={11} />
                    </button>
                )}
            </div>
        );
    };

    const overlayBusy = isApplying || isImporting;

    return (
        <div className={styles.mainPanel} ref={gridRef}>
            {activeLibrary ? (
                <>
                    <div className={styles.header}>
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                            <Icons8Icon id="palette_ui" size={14} className="text-gray-400 shrink-0" />
                            <div className="min-w-0 flex-1">
                                <div className="text-xs font-semibold text-white truncate">{activeLibrary.name}</div>
                                <div className="text-xs bndz-panel-muted">
                                    {filteredIcons.length}{search.trim() ? ` of ${activeLibrary.icons.length}` : ''} icons
                                </div>
                            </div>
                        </div>
                        <div className="relative shrink-0 w-[148px] mr-2 hidden sm:block">
                            <Icons8Icon id="search" size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
                            <input
                                ref={searchRef}
                                type="text"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Filter icons…"
                                className={`${PLUGIN_INPUT_CLASS} !pl-7 !py-1`}
                            />
                        </div>
                        <PluginToolbarButton icon="folder_open_ui" onClick={importLibraryFromFolder} disabled={overlayBusy}>
                            Import
                        </PluginToolbarButton>
                    </div>

                    <div className="px-3 pb-2 sm:hidden">
                        <div className="relative">
                            <Icons8Icon id="search" size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
                            <input
                                type="text"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Filter icons…"
                                className={`${PLUGIN_INPUT_CLASS} !pl-7 !py-1`}
                            />
                        </div>
                    </div>

                    <div
                        ref={scrollRef}
                        className={`${styles.content} bndz-scrollbar relative outline-none`}
                        tabIndex={0}
                        onKeyDown={handleGridKeyDown}
                        onDrop={handleDrop}
                        onDragOver={e => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setIsDragOver(true); }}
                        onDragLeave={() => setIsDragOver(false)}
                    >
                        {overlayBusy && (
                            <div className={styles.applyOverlay}>
                                <div className="flex flex-col items-center gap-4">
                                    <div className={styles.spinnerRing} />
                                    <span className="text-xs bndz-panel-muted">
                                        {isImporting ? 'Importing icons…' : 'Applying icon…'}
                                    </span>
                                </div>
                            </div>
                        )}

                        {isDragOver && !overlayBusy && (
                            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/40 pointer-events-none rounded-md m-2 border border-dashed border-white/15">
                                <Icons8Icon id="upload" size={28} className="text-gray-400 mb-2" />
                                <p className="text-xs text-gray-300">Drop icons here</p>
                            </div>
                        )}

                        {filteredIcons.length > 0 ? (
                            <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
                                {virtualizer.getVirtualItems().map(vi => {
                                    const row = rows[vi.index];
                                    const baseIndex = vi.index * cols;
                                    return (
                                        <div
                                            key={vi.index}
                                            style={{
                                                position: 'absolute',
                                                top: 0,
                                                left: 0,
                                                width: '100%',
                                                transform: `translateY(${vi.start}px)`,
                                            }}
                                        >
                                            <div
                                                className="grid gap-2.5"
                                                style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                                            >
                                                {row.map((icon, ci) => renderTile(icon, baseIndex + ci))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : activeLibrary.icons.length > 0 ? (
                            <PluginEmptyState icon="search" description={`No icons match "${search.trim()}"`} />
                        ) : (
                            <div className="h-full min-h-[200px] flex flex-col items-center justify-center gap-3">
                                <PluginEmptyState icon="wand_ui" title="Library is empty" description="Drop .ico / .png files here or import a folder." />
                                <PluginToolbarButton icon="folder_open_ui" onClick={importLibraryFromFolder}>Import icons</PluginToolbarButton>
                            </div>
                        )}
                    </div>
                </>
            ) : (
                <div
                    className="h-full flex flex-col items-center justify-center gap-3 p-6"
                    onDrop={handleDrop}
                    onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                    onDragLeave={() => setIsDragOver(false)}
                >
                    <PluginEmptyState icon="palette_ui" title="No library selected" description="Create or import a library to get started." />
                    <div className="flex gap-2">
                        <PluginToolbarButton icon="folder_plus_ui" onClick={() => createLibrary('My Icons')}>New library</PluginToolbarButton>
                        <PluginToolbarButton icon="folder_open_ui" onClick={importLibraryFromFolder}>Import folder</PluginToolbarButton>
                    </div>
                </div>
            )}

            {ctxMenu && (
                <div
                    className="fixed z-[10000] min-w-[160px] py-1 rounded-md border border-white/10 bg-[#1a1a1f] shadow-xl text-xs"
                    style={{ left: ctxMenu.x, top: ctxMenu.y }}
                    onClick={e => e.stopPropagation()}
                >
                    <button
                        type="button"
                        className="w-full px-3 py-1.5 text-left hover:bg-white/[0.05] text-gray-200 flex items-center gap-2 disabled:opacity-40"
                        disabled={!selectedItems.length}
                        onClick={() => { void runApply(ctxMenu.icon); setCtxMenu(null); }}
                    >
                        <Icons8Icon id="check" size={12} /> Apply to selection
                    </button>
                    <button
                        type="button"
                        className="w-full px-3 py-1.5 text-left hover:bg-white/5 text-gray-300 flex items-center gap-2"
                        onClick={() => {
                            const p = resolveIconFilePath(ctxMenu.icon.icoStr, activeLibrary?.sourceFolder);
                            if (p) void IPC.shellExecute('copyPath', p);
                            setCtxMenu(null);
                        }}
                    >
                        <Icons8Icon id="copy" size={12} /> Copy icon path
                    </button>
                    <button
                        type="button"
                        className="w-full px-3 py-1.5 text-left hover:bg-rose-500/15 text-rose-300 flex items-center gap-2"
                        onClick={() => {
                            if (activeLibrary) removeIcon(activeLibrary.id, ctxMenu.icon.id);
                            setCtxMenu(null);
                        }}
                    >
                        <Icons8Icon id="trash_ui" size={12} /> Remove from library
                    </button>
                </div>
            )}
        </div>
    );
}
