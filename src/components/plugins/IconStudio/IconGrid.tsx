import React, { useState, useCallback } from 'react';
import { Paintbrush, FolderOpen, Upload, Palette, FolderPlus, X } from 'lucide-react';
import { useIconStudio } from './IconStudioContext';
import { useAppConfig } from '../../../data/configContext';
import IconPreviewImage from './IconPreviewImage';
import styles from './IconStudio.module.css';
import { IPC } from '../../../lib/ipcBridge';
import { toWindowsPath } from '../../../lib/pathUtils';
import { prepareIconForApply, resolveIconFilePath } from '../../../lib/iconPathUtils';
import { pushToast } from '../../ToastHost';

const ICON_EXTENSIONS = ['.ico', '.png', '.jpg', '.jpeg', '.bmp', '.webp', '.gif'];

export default function IconGrid({
    selectedItems,
    targetTypes,
    focusedPath,
}: {
    selectedItems: string[];
    targetTypes?: string[];
    focusedPath: string;
}) {
    const { libraries, activeLibraryId, isApplying, setIsApplying, importIconsFromPaths, importLibraryFromFolder, createLibrary, removeIcon } = useIconStudio();
    const { config } = useAppConfig();
    const activeLibrary = libraries.find(l => l.id === activeLibraryId);
    const [isDragOver, setIsDragOver] = useState(false);
    const [hoveredId, setHoveredId] = useState<string | null>(null);

    const resolveTargetType = (fullPath: string, hinted?: string): string => {
        if (hinted === 'folder' || hinted === 'file' || hinted === 'shortcut') return hinted;
        const normalized = toWindowsPath(fullPath);
        if (/\.lnk$/i.test(normalized)) return 'shortcut';
        const base = normalized.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
        const dot = base.lastIndexOf('.');
        if (dot > 0 && dot < base.length - 1) {
            const ext = base.slice(dot + 1);
            if (/^[A-Za-z0-9]{1,10}$/.test(ext)) return 'file';
        }
        return 'folder';
    };

    const normalizeTarget = (raw: string): string => {
        if (raw.includes(':') || raw.startsWith('/') || raw.startsWith('\\')) {
            return toWindowsPath(raw);
        }
        const base = focusedPath.replace(/\/$/, '');
        return toWindowsPath(`${base}/${raw}`);
    };

    const handleApplyIcon = async (iconInfo: { id: string; icoStr: string; name: string }) => {
        if (selectedItems.length === 0) {
            pushToast({ kind: 'warning', title: 'No targets', message: 'Select folders or files in the file list first.' });
            return;
        }

        const iconPath = resolveIconFilePath(iconInfo.icoStr, activeLibrary?.sourceFolder);
        if (!iconPath || iconPath.startsWith('data:')) {
            pushToast({ kind: 'error', title: 'Invalid icon', message: 'Could not resolve icon path.' });
            return;
        }

        setIsApplying(true);
        try {
            const icoPath = await prepareIconForApply(iconPath);
            if (!icoPath) {
                pushToast({ kind: 'error', title: 'Icon prepare failed', message: `Could not prepare "${iconInfo.name}" for apply.` });
                return;
            }

            let applied = 0;
            let failed = 0;
            let lastError = '';

            for (let i = 0; i < selectedItems.length; i++) {
                const raw = selectedItems[i];
                const target = normalizeTarget(raw);
                try {
                    const result = await IPC.setSystemIcon(
                        target,
                        resolveTargetType(target, targetTypes?.[i]),
                        icoPath,
                        !!config.allowGlobalIconOverwrite,
                    );
                    if (result.success) applied++;
                    else {
                        failed++;
                        if (result.error) lastError = result.error;
                    }
                } catch (err: any) {
                    failed++;
                    lastError = err?.message || lastError;
                }
            }

            await IPC.clearIconCache();

            if (failed === 0) {
                pushToast({ kind: 'success', title: 'Icon applied', message: `"${iconInfo.name}" applied to ${applied} item(s).` });
            } else {
                pushToast({
                    kind: 'error',
                    title: 'Apply incomplete',
                    message: lastError || `Applied ${applied}, failed ${failed}.`,
                });
            }
        } catch (err: any) {
            pushToast({ kind: 'error', title: 'Apply failed', message: err?.message || 'The operation timed out or was interrupted.' });
        } finally {
            setIsApplying(false);
        }
    };

    const handleRestoreIcons = async () => {
        if (!selectedItems.length) return;
        setIsApplying(true);
        let restored = 0;
        let failed = 0;
        try {
            for (let i = 0; i < selectedItems.length; i++) {
                const raw = selectedItems[i];
                const target = normalizeTarget(raw);
                try {
                    const ok = await IPC.restoreSystemIcon(target, resolveTargetType(target, targetTypes?.[i]));
                    if (ok === false) failed++; else restored++;
                } catch {
                    failed++;
                }
            }
            await IPC.clearIconCache();
            if (failed === 0) pushToast({ kind: 'success', title: 'Icons restored', message: `Default icon restored on ${restored} item(s).` });
            else pushToast({ kind: 'warning', title: 'Partial restore', message: `Restored ${restored}, failed ${failed}.` });
        } finally {
            setIsApplying(false);
        }
    };

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

    return (
        <div className={styles.mainPanel}>
            {activeLibrary ? (
                <>
                    <div className={styles.header}>
                        <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-500/20 to-purple-600/20 flex items-center justify-center ring-1 ring-pink-500/20 shrink-0">
                                <Palette size={15} className="text-pink-300" />
                            </div>
                            <div className="min-w-0">
                                <div className="text-sm font-semibold text-white truncate">{activeLibrary.name}</div>
                                <div className="text-[10px] text-gray-500">{activeLibrary.icons.length} icons</div>
                            </div>
                        </div>
                        <div className="flex gap-2 items-center shrink-0">
                            <button
                                type="button"
                                onClick={handleRestoreIcons}
                                disabled={!selectedItems.length || isApplying}
                                className="text-[11px] text-gray-400 hover:text-white px-2.5 py-1.5 rounded-lg border border-white/8 hover:border-white/15 disabled:opacity-35 transition-colors"
                            >
                                Restore default
                            </button>
                            <button
                                type="button"
                                onClick={importLibraryFromFolder}
                                disabled={isApplying}
                                className="flex items-center gap-1.5 text-[11px] font-semibold text-white bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 px-3 py-1.5 rounded-lg shadow-lg shadow-pink-900/20 transition-all disabled:opacity-50"
                            >
                                <FolderOpen size={12} /> Import
                            </button>
                        </div>
                    </div>

                    <div
                        className={`${styles.content} bndz-scrollbar relative ${isDragOver ? 'ring-2 ring-inset ring-pink-500/30' : ''}`}
                        onDrop={handleDrop}
                        onDragOver={e => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setIsDragOver(true); }}
                        onDragLeave={() => setIsDragOver(false)}
                    >
                        {isApplying && (
                            <div className={styles.applyOverlay}>
                                <div className="flex flex-col items-center gap-4">
                                    <div className={styles.spinnerRing} />
                                    <span className="text-[11px] font-medium text-pink-200/80 tracking-wide">Applying icon…</span>
                                </div>
                            </div>
                        )}

                        {isDragOver && !isApplying && (
                            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm pointer-events-none rounded-lg m-2 border border-dashed border-pink-400/40">
                                <Upload size={36} className="text-pink-400 mb-2" />
                                <p className="text-sm font-medium text-white">Drop icons here</p>
                            </div>
                        )}

                        {activeLibrary.icons.length > 0 ? (
                            <div className="grid grid-cols-[repeat(auto-fill,minmax(108px,1fr))] gap-2.5">
                                {activeLibrary.icons.map(icon => {
                                    const canApply = selectedItems.length > 0 && !isApplying;
                                    const isHovered = hoveredId === icon.id;
                                    return (
                                        <div key={icon.id} className="relative group/tile">
                                            {isHovered && !isApplying && (
                                                <button
                                                    type="button"
                                                    title="Remove from library"
                                                    onClick={(e) => { e.stopPropagation(); removeIcon(activeLibrary.id, icon.id); }}
                                                    className="absolute -top-1.5 -right-1.5 z-10 w-5 h-5 rounded-full bg-[#1a1a22] border border-white/10 text-gray-400 hover:text-white hover:bg-rose-600/90 hover:border-rose-400/50 flex items-center justify-center opacity-0 group-hover/tile:opacity-100 transition-all"
                                                >
                                                    <X size={11} />
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => handleApplyIcon(icon)}
                                                onMouseEnter={() => setHoveredId(icon.id)}
                                                onMouseLeave={() => setHoveredId(null)}
                                                title={canApply ? `Apply to ${selectedItems.length} item(s)` : 'Select targets in file list'}
                                                disabled={!canApply}
                                                className={`${styles.iconTile} w-full flex flex-col items-center gap-2 p-3 rounded-xl disabled:opacity-45 disabled:cursor-not-allowed`}
                                            >
                                                <div className="w-14 h-14 rounded-xl bg-black/25 flex items-center justify-center ring-1 ring-white/5">
                                                    <IconPreviewImage path={resolveIconFilePath(icon.icoStr, activeLibrary?.sourceFolder)} size={48} />
                                                </div>
                                                <span className="font-medium text-[10px] text-gray-400 truncate w-full text-center">{icon.name}</span>
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-gray-500 gap-3">
                                <Paintbrush size={28} className="opacity-25" />
                                <p className="text-sm text-gray-400">This library is empty</p>
                                <p className="text-[11px] text-gray-600 max-w-[240px] text-center">Drop .ico / .png files here or import a folder</p>
                                <button type="button" onClick={importLibraryFromFolder} className="mt-1 flex items-center gap-2 px-4 py-2 rounded-lg bg-pink-600/15 border border-pink-500/25 text-pink-300 text-xs font-semibold hover:bg-pink-600/25 transition-colors">
                                    <FolderOpen size={14} /> Import icons
                                </button>
                            </div>
                        )}
                    </div>
                </>
            ) : (
                <div
                    className="h-full flex flex-col items-center justify-center text-gray-500 gap-4 p-8"
                    onDrop={handleDrop}
                    onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                    onDragLeave={() => setIsDragOver(false)}
                >
                    <Palette size={40} className="opacity-20" />
                    <p className="text-center text-sm text-gray-400 max-w-[280px]">Create or import a library to get started</p>
                    <div className="flex gap-2">
                        <button type="button" onClick={() => createLibrary('My Icons')} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 bg-white/5 text-gray-200 text-xs font-semibold hover:bg-white/10">
                            <FolderPlus size={14} /> New library
                        </button>
                        <button type="button" onClick={importLibraryFromFolder} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-pink-600/80 to-purple-600/80 text-white text-xs font-semibold">
                            <FolderOpen size={14} /> Import folder
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
