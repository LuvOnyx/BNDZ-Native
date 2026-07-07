import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Icons8Icon } from './Icons8Icon';
import { CloseGlyph } from './ChromeGlyphs';
import { toWindowsPath } from '../lib/pathUtils';
import BndzAssistantPanel from './assistant/BndzAssistantPanel';
import BndzDuplicatesPanel from './duplicates/BndzDuplicatesPanel';

export type SmartToolsTab = 'assistant' | 'organize' | 'duplicates';

interface SmartToolsDialogProps {
    isOpen?: boolean;
    onClose: () => void;
    selectedItems?: string[];
    selectedFiles?: Array<{ path?: string; name?: string }>;
    currentPath?: string;
    initialPrompt?: string;
    initialTab?: SmartToolsTab | 'agent' | 'organize' | 'tasks' | 'memories';
    onNavigate?: (path: string) => void;
}

function resolveSelectedPaths(props: SmartToolsDialogProps): string[] {
    if (props.selectedItems?.length) {
        return props.selectedItems.map(p => toWindowsPath(p));
    }
    if (props.selectedFiles?.length) {
        const base = toWindowsPath(props.currentPath || '');
        return props.selectedFiles.map(f => {
            if (f.path) return toWindowsPath(f.path);
            if (f.name && base) return `${base}\\${f.name}`;
            return '';
        }).filter(Boolean);
    }
    return [];
}

function normalizeTab(tab?: SmartToolsDialogProps['initialTab']): SmartToolsTab {
    if (tab === 'agent' || tab === 'tasks' || tab === 'memories') return 'assistant';
    if (tab === 'duplicates') return 'duplicates';
    if (tab === 'assistant') return 'assistant';
    return 'assistant';
}

export default function SmartToolsDialog({
    isOpen = true,
    onClose,
    selectedItems,
    selectedFiles,
    currentPath,
    initialPrompt,
    initialTab = 'assistant',
    onNavigate,
}: SmartToolsDialogProps) {
    const [tab, setTab] = useState<SmartToolsTab>(normalizeTab(initialTab));

    useEffect(() => {
        if (isOpen) setTab(normalizeTab(initialTab));
    }, [isOpen, initialTab]);

    if (!isOpen) return null;

    const paths = resolveSelectedPaths({ isOpen, onClose, selectedItems, selectedFiles, currentPath });

    const handleOrganize = () => {
        window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', {
            detail: { id: 'storage-cleanup', currentPath, paths, wizardMode: 'organize' },
        }));
        window.dispatchEvent(new CustomEvent('bndz-storage-wizard', { detail: { mode: 'organize', currentPath } }));
        onClose();
    };

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
                onClick={onClose}
            >
                <motion.div
                    initial={{ scale: 0.98, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.98, opacity: 0 }}
                    transition={{ duration: 0.12 }}
                    className="w-full max-w-2xl bg-[#2b2b2b] border border-[#454545] shadow-[0_8px_32px_rgba(0,0,0,0.55)] flex flex-col overflow-hidden max-h-[88vh]"
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                >
                    <div className="bg-[#323232] px-4 py-2.5 flex justify-between items-center border-b border-[#454545] shrink-0">
                        <div className="flex items-center gap-2">
                            <Icons8Icon id="smart_tools" size={16} />
                            <h2 className="text-[13px] font-semibold text-gray-100">Smart Tools</h2>
                            {paths.length > 0 && (
                                <span className="text-[10px] bg-[#094771] text-white px-2 py-0.5">{paths.length} selected</span>
                            )}
                        </div>
                        <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-white hover:bg-[#3d3d3d]">
                            <CloseGlyph size={14} />
                        </button>
                    </div>

                    <div className="flex border-b border-[#454545] bg-[#2b2b2b]">
                        {([
                            { id: 'organize' as const, label: 'Organize', iconId: 'category_ui' },
                            { id: 'assistant' as const, label: 'Assistant', iconId: 'sparkles_ui' },
                            { id: 'duplicates' as const, label: 'Duplicates', iconId: 'copy' },
                        ]).map(t => (
                            <button
                                key={t.id}
                                type="button"
                                onClick={() => setTab(t.id)}
                                className={`flex items-center gap-1.5 px-4 py-2 text-[12px] border-b-2 ${
                                    tab === t.id ? 'border-sky-500 text-white bg-[#333]' : 'border-transparent text-gray-500 hover:text-gray-300'
                                }`}
                            >
                                <Icons8Icon id={t.iconId} size={12} /> {t.label}
                            </button>
                        ))}
                    </div>

                    <div className="p-4 flex flex-col gap-3 overflow-y-auto flex-1 min-h-0">
                        {tab === 'organize' && (
                            <div className="flex flex-col gap-2">
                                <button
                                    type="button"
                                    onClick={handleOrganize}
                                    className="bg-[#333] hover:bg-[#3a3a3a] border border-[#454545] p-3 flex items-center gap-3 text-left"
                                >
                                    <div className="w-9 h-9 bg-[#094771]/30 flex items-center justify-center shrink-0">
                                        <Icons8Icon id="category_ui" size={18} />
                                    </div>
                                    <div>
                                        <h3 className="text-[13px] font-semibold text-gray-100">Auto-Organize Folder</h3>
                                        <p className="text-[11px] text-gray-500 mt-0.5">Sort into Images, Documents, Audio, Video, and more.</p>
                                    </div>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', {
                                            detail: { id: 'batch-rename', paths, currentPath },
                                        }));
                                        onClose();
                                    }}
                                    className="bg-[#333] hover:bg-[#3a3a3a] border border-[#454545] p-3 flex items-center gap-3 text-left"
                                >
                                    <div className="w-9 h-9 bg-emerald-900/30 flex items-center justify-center shrink-0">
                                        <Icons8Icon id="sparkles_ui" size={18} />
                                    </div>
                                    <div>
                                        <h3 className="text-[13px] font-semibold text-gray-100">Batch Rename</h3>
                                        <p className="text-[11px] text-gray-500 mt-0.5">Pattern rename and AI-assisted renaming for selected files.</p>
                                    </div>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        window.dispatchEvent(new CustomEvent('bndz-open-tag-assignment'));
                                        onClose();
                                    }}
                                    className="bg-[#333] hover:bg-[#3a3a3a] border border-[#454545] p-3 flex items-center gap-3 text-left"
                                >
                                    <div className="w-9 h-9 bg-pink-900/30 flex items-center justify-center shrink-0">
                                        <Icons8Icon id="tag_manager" size={18} />
                                    </div>
                                    <div>
                                        <h3 className="text-[13px] font-semibold text-gray-100">Quick Tag</h3>
                                        <p className="text-[11px] text-gray-500 mt-0.5">Keyboard-driven tagging overlay for the current selection.</p>
                                    </div>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', {
                                            detail: { id: 'storage-cleanup', currentPath, paths },
                                        }));
                                        onClose();
                                    }}
                                    className="bg-[#333] hover:bg-[#3a3a3a] border border-[#454545] p-3 flex items-center gap-3 text-left"
                                >
                                    <div className="w-9 h-9 bg-amber-900/20 flex items-center justify-center shrink-0">
                                        <Icons8Icon id="storage_cleanup" size={18} />
                                    </div>
                                    <div>
                                        <h3 className="text-[13px] font-semibold text-gray-100">Storage Cleanup</h3>
                                        <p className="text-[11px] text-gray-500 mt-0.5">Find large files, empty folders, and reclaim disk space.</p>
                                    </div>
                                </button>
                            </div>
                        )}

                        {tab === 'assistant' && (
                            <BndzAssistantPanel
                                selectedPaths={paths}
                                currentPath={currentPath ? toWindowsPath(currentPath) : undefined}
                                initialPrompt={initialPrompt}
                            />
                        )}

                        {tab === 'duplicates' && (
                            <BndzDuplicatesPanel
                                folderPath={currentPath || '/'}
                                onReveal={p => {
                                    onNavigate?.(p.startsWith('/') ? p : `/${p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:')}`);
                                    onClose();
                                }}
                            />
                        )}
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
