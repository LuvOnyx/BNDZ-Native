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
import { PluginToolbarButton, PluginCard, PluginEmptyState } from '../PluginPanelPrimitives';

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
                    <Icons8Icon id="target_ui" size={14} className="text-gray-400" />
                    <span className="text-xs font-semibold text-white">Preview & apply</span>
                </div>
                <span className="bndz-plugin-kind-pill">{paths.length}</span>
            </div>

            <div className={styles.content}>
                {paths.length === 0 ? (
                    <PluginEmptyState
                        icon="explorer"
                        title="Nothing selected"
                        description="Select folders or files in the list, pick an icon, then apply."
                    />
                ) : (
                    <div className="flex flex-col gap-2.5 h-full">
                        {selectedIcon ? (
                            <PluginCard className="!py-2.5">
                                <div className="bndz-plugin-section-title mb-2">Selected icon</div>
                                <div className="flex items-center gap-3">
                                    <div className="w-11 h-11 rounded-md bg-black/30 flex items-center justify-center border border-white/[0.08]">
                                        <IconPreviewImage path={selectedPreviewPath} size={36} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs font-semibold text-white truncate">{selectedIcon.name}</div>
                                        <div className="text-xs bndz-panel-muted">Before → after on each target</div>
                                    </div>
                                </div>
                            </PluginCard>
                        ) : (
                            <PluginCard className="!py-2.5 text-xs bndz-panel-muted text-center">
                                Click an icon in the grid to preview changes
                            </PluginCard>
                        )}

                        <div className="flex-1 overflow-y-auto bndz-scrollbar space-y-1.5 min-h-0">
                            {paths.map((item, i) => {
                                const win = toWindowsPath(item);
                                const name = win.split(/[/\\]/).pop() || item;
                                const isDrive = /^[A-Za-z]:\\?$/.test(win) || win.endsWith(':\\');
                                const isDir = isDrive || !name.includes('.');
                                return (
                                    <div key={i} className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                                        <div className="text-xs bndz-mono bndz-panel-muted truncate mb-2" title={win}>{name}</div>
                                        <div className="flex items-center justify-center gap-2.5">
                                            <div className="flex flex-col items-center gap-1">
                                                <ShellNativeIcon path={win} isDir={isDir} size={32} eager />
                                                <span className="text-[10px] bndz-panel-muted">Now</span>
                                            </div>
                                            <Icons8Icon id="arrow_right_ui" size={12} className="text-gray-500 shrink-0" />
                                            <div className="flex flex-col items-center gap-1">
                                                <div className="w-8 h-8 rounded-md bg-black/30 flex items-center justify-center border border-white/[0.08]">
                                                    {selectedPreviewPath ? (
                                                        <IconPreviewImage path={selectedPreviewPath} size={28} />
                                                    ) : (
                                                        <Icons8Icon id="wand_ui" size={14} className="text-gray-600" />
                                                    )}
                                                </div>
                                                <span className="text-[10px] text-[#7eb8e8]/80">After</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <PluginToolbarButton
                            icon={isApplying ? 'loading' : 'wand_ui'}
                            active
                            onClick={() => void runApply()}
                            disabled={!selectedIcon || isApplying}
                        >
                            {selectedIcon ? `Apply "${selectedIcon.name}"` : 'Select an icon'}
                        </PluginToolbarButton>

                        <PluginToolbarButton
                            icon={restoring ? 'loading' : 'reset_ui'}
                            onClick={() => void restoreAll()}
                            disabled={restoring || isApplying}
                        >
                            Restore default icons
                        </PluginToolbarButton>
                    </div>
                )}
            </div>
        </div>
    );
}
