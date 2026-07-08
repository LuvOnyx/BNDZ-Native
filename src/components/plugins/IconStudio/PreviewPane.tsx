import React, { useState } from 'react';
import { Icons8Icon } from '../../Icons8Icon';
import { ShellNativeIcon } from '../../ShellNativeIcon';
import { toWindowsPath } from '../../../lib/pathUtils';
import styles from './IconStudio.module.css';
import { useIconStudio } from './IconStudioContext';
import { useAppConfig } from '../../../data/configContext';
import IconPreviewImage from './IconPreviewImage';
import { resolveIconFilePath } from '../../../lib/iconPathUtils';
import { applyIconToTargets, restoreTargets } from './iconApply';

export default function PreviewPane({
    selectedItems,
    targetTypes,
    focusedPath,
}: {
    selectedItems: string[];
    targetTypes?: string[];
    focusedPath: string;
}) {
    const paths = selectedItems || [];
    const { selectedIcon, activeLibraryId, libraries, isApplying, setIsApplying } = useIconStudio();
    const { config } = useAppConfig();
    const activeLibrary = libraries.find(l => l.id === activeLibraryId);
    const [restoring, setRestoring] = useState(false);

    const selectedPreviewPath = selectedIcon
        ? resolveIconFilePath(selectedIcon.icoStr, activeLibrary?.sourceFolder)
        : '';

    const runApply = async () => {
        if (!selectedIcon) return;
        setIsApplying(true);
        try {
            await applyIconToTargets({
                icon: selectedIcon,
                activeLibrary,
                selectedItems: paths,
                targetTypes,
                focusedPath,
                allowGlobalOverwrite: !!config.allowGlobalIconOverwrite,
            });
        } finally {
            setIsApplying(false);
        }
    };

    const restoreAll = async () => {
        setRestoring(true);
        try {
            await restoreTargets({ selectedItems: paths, targetTypes, focusedPath });
        } finally {
            setRestoring(false);
        }
    };

    return (
        <div className={styles.rightPane}>
            <div className={styles.header}>
                <div className="flex items-center gap-2">
                    <Icons8Icon id="target_ui" size={14} className="text-sky-400" />
                    <span className="text-sm font-semibold text-white">Preview & apply</span>
                </div>
                <span className="bndz-plugin-kind-pill">{paths.length}</span>
            </div>

            <div className={styles.content}>
                {paths.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center px-4">
                        <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center mb-4 ring-1 ring-white/8">
                            <Icons8Icon id="explorer" size={24} className="text-gray-600" />
                        </div>
                        <p className="text-xs font-medium text-gray-400">Nothing selected</p>
                        <p className="text-xs bndz-panel-muted mt-2 leading-relaxed max-w-[200px]">
                            Select folders or files in the list, pick an icon, then apply.
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3 h-full">
                        {selectedIcon ? (
                            <div className="shrink-0 p-3 rounded-xl border border-pink-500/20 bg-pink-500/5">
                                <div className="bndz-plugin-section-title text-pink-300/80 mb-2">Selected icon</div>
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 rounded-lg bg-black/30 flex items-center justify-center ring-1 ring-white/10">
                                        <IconPreviewImage path={selectedPreviewPath} size={40} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-[12px] font-semibold text-white truncate">{selectedIcon.name}</div>
                                        <div className="text-xs bndz-panel-muted">Before → after on each target</div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="shrink-0 p-3 rounded-xl border border-white/8 bg-white/3 text-xs bndz-panel-muted text-center">
                                Click an icon in the grid to preview changes
                            </div>
                        )}

                        <div className="flex-1 overflow-y-auto bndz-scrollbar space-y-2 min-h-0">
                            {paths.map((item, i) => {
                                const win = toWindowsPath(item);
                                const name = win.split(/[/\\]/).pop() || item;
                                const isDrive = /^[A-Za-z]:\\?$/.test(win) || win.endsWith(':\\');
                                const isDir = isDrive || !name.includes('.');
                                return (
                                    <div key={i} className="bg-white/4 border border-white/6 rounded-xl px-3 py-2.5">
                                        <div className="text-xs bndz-mono bndz-panel-muted truncate mb-2" title={win}>{name}</div>
                                        <div className="flex items-center justify-center gap-3">
                                            <div className="flex flex-col items-center gap-1">
                                                <ShellNativeIcon path={win} isDir={isDir} size={36} eager />
                                                <span className="text-xs bndz-panel-muted">Now</span>
                                            </div>
                                            <Icons8Icon id="arrow_right_ui" size={14} className="text-pink-400/60 shrink-0" />
                                            <div className="flex flex-col items-center gap-1">
                                                <div className="w-9 h-9 rounded-lg bg-black/30 flex items-center justify-center ring-1 ring-pink-500/20">
                                                    {selectedPreviewPath ? (
                                                        <IconPreviewImage path={selectedPreviewPath} size={32} />
                                                    ) : (
                                                        <Icons8Icon id="wand_ui" size={16} className="text-gray-600" />
                                                    )}
                                                </div>
                                                <span className="text-xs text-pink-400/70">After</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <button
                            type="button"
                            onClick={() => void runApply()}
                            disabled={!selectedIcon || isApplying}
                            className="shrink-0 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-xs font-bold text-white shadow-lg shadow-pink-900/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {isApplying ? <Icons8Icon id="loading" size={14} spin /> : <Icons8Icon id="wand_ui" size={13} />}
                            {selectedIcon ? `Apply "${selectedIcon.name}"` : 'Select an icon'}
                        </button>

                        <button
                            type="button"
                            onClick={() => void restoreAll()}
                            disabled={restoring || isApplying}
                            className="shrink-0 w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-amber-500/20 bg-amber-500/8 hover:bg-amber-500/15 text-xs font-semibold text-amber-200/90 transition-colors disabled:opacity-50"
                        >
                            {restoring ? <Icons8Icon id="loading" size={13} spin /> : <Icons8Icon id="reset_ui" size={13} />}
                            Restore default icons
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
