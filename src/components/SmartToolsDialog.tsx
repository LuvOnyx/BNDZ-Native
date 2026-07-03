import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Sparkles, FileText, CheckCircle2, FolderTree, Wand2 } from 'lucide-react';
import { IPC } from '../lib/ipcBridge';
import { toWindowsPath } from '../lib/pathUtils';

interface SmartToolsDialogProps {
    isOpen?: boolean;
    onClose: () => void;
    selectedItems?: string[];
    selectedFiles?: Array<{ path?: string; name?: string }>;
    currentPath?: string;
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

export default function SmartToolsDialog({ isOpen = true, onClose, selectedItems, selectedFiles, currentPath }: SmartToolsDialogProps) {
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState('');

    if (!isOpen) return null;

    const paths = resolveSelectedPaths({ isOpen, onClose, selectedItems, selectedFiles, currentPath });

    const handleRunAIAction = async (action: string) => {
        setLoading(true);
        setResult('');

        try {
            if (action === 'summarize') {
                if (paths.length === 0) {
                    setResult('Select one or more text files to summarize.');
                    return;
                }
                const textPromises = paths.map(p => IPC.readFileContent(p).catch(() => ''));
                const texts = await Promise.all(textPromises);
                const combined = texts.filter(Boolean).join('\n\n---\n\n');

                if (IPC.isNative) {
                    const summary = await IPC.aiGenerate(
                        `Summarize the following file excerpts into concise bullet points:\n\n${combined.slice(0, 12000)}`
                    );
                    if (!summary) {
                        setResult('AI download cancelled or unavailable. Select files and try again when ready.');
                        return;
                    }
                    setResult(summary);
                    return;
                }

                setResult('Summarize requires the native BNDZ app with local AI.');
            } else if (action === 'organize') {
                window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', { detail: { id: 'storage-cleanup' } }));
                window.dispatchEvent(new CustomEvent('bndz-storage-wizard', { detail: { mode: 'organize' } }));
                setResult('Opened Storage Cleanup — use the wizard to pick a folder, preview, and confirm.');
                onClose();
            }
        } catch (e: any) {
            setResult(`Error: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4"
                onClick={onClose}
            >
                <motion.div
                    initial={{ scale: 0.95, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.95, opacity: 0, y: 20 }}
                    className="w-full max-w-2xl bg-[#0d0d0d] border border-[#222] shadow-2xl rounded-2xl flex flex-col overflow-hidden"
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                >
                    <div className="bg-gradient-to-r from-purple-500/10 to-[#111] px-6 py-4 flex justify-between items-center border-b border-[#222]">
                        <div className="flex items-center gap-3">
                            <Sparkles size={18} className="text-purple-400" />
                            <h2 className="text-sm font-bold text-gray-200 tracking-wide uppercase">AI Smart Tools</h2>
                            {paths.length > 0 && (
                                <span className="text-[10px] bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full">{paths.length} selected</span>
                            )}
                        </div>
                        <button onClick={onClose} className="p-1.5 text-gray-500 hover:text-white hover:bg-[#222] rounded-lg transition-colors">
                            <X size={16} />
                        </button>
                    </div>

                    <div className="p-6 flex flex-col gap-6">
                        <div className="grid grid-cols-2 gap-4">
                            <button onClick={() => handleRunAIAction('summarize')} className="bg-[#141414] hover:bg-[#1a1a1a] border border-[#222] hover:border-purple-500/50 rounded-xl p-4 flex flex-col items-center gap-3 transition-all group">
                                <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                                    <FileText size={18} className="text-purple-400" />
                                </div>
                                <div className="text-center">
                                    <h3 className="text-sm font-bold text-gray-200">Summarize Documents</h3>
                                    <p className="text-[11px] text-gray-500 mt-1">Read selected text files and generate a summary.</p>
                                </div>
                            </button>
                            <button onClick={() => handleRunAIAction('organize')} className="bg-[#141414] hover:bg-[#1a1a1a] border border-[#222] hover:border-sky-500/50 rounded-xl p-4 flex flex-col items-center gap-3 transition-all group">
                                <div className="w-10 h-10 rounded-full bg-sky-500/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                                    <FolderTree size={18} className="text-sky-400" />
                                </div>
                                <div className="text-center">
                                    <h3 className="text-sm font-bold text-gray-200">Auto-Organize Folder</h3>
                                    <p className="text-[11px] text-gray-500 mt-1">Sort files into Images, Documents, Audio, Video, and more.</p>
                                </div>
                            </button>
                        </div>

                        <div className="flex items-center gap-2 text-[10px] text-gray-600 uppercase tracking-widest">
                            <Wand2 size={12} /> Local AI (offline after first download) · smart rules fallback
                        </div>

                        {(loading || result) && (
                            <div className="bg-[#111] border border-[#333] rounded-xl p-4 mt-2">
                                {loading ? (
                                    <div className="flex justify-center items-center gap-2 text-purple-400 text-xs font-mono py-4 animate-pulse">
                                        <Sparkles size={14} className="animate-spin" /> Processing...
                                    </div>
                                ) : (
                                    <div className="text-gray-300 text-sm whitespace-pre-wrap font-sans leading-relaxed">
                                        {result}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
