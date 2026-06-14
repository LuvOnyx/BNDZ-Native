import React, { useState } from 'react';
import { Folder, RotateCcw, Target, CheckCircle2 } from 'lucide-react';
import { ShellNativeIcon } from '../../ShellNativeIcon';
import { IPC } from '../../../lib/ipcBridge';
import { toWindowsPath } from '../../../lib/pathUtils';
import styles from './IconStudio.module.css';
import { pushToast } from '../../ToastHost';

export default function PreviewPane({ selectedItems }: { selectedItems: string[] }) {
    const paths = selectedItems || [];
    const [restoring, setRestoring] = useState(false);

    const restoreAll = async () => {
        setRestoring(true);
        let restored = 0;
        let failed = 0;
        try {
            for (const raw of paths) {
                const p = toWindowsPath(raw);
                const name = p.split(/[/\\]/).pop() || '';
                const type = name.toLowerCase().endsWith('.lnk') ? 'shortcut' : !name.includes('.') ? 'folder' : 'file';
                try {
                    const ok = await IPC.restoreSystemIcon(p, type);
                    if (ok === false) failed++; else restored++;
                } catch {
                    failed++;
                }
            }
            await IPC.clearIconCache();
            if (failed === 0) pushToast({ kind: 'success', title: 'Restored', message: `Default icon on ${restored} item(s).` });
            else pushToast({ kind: 'warning', title: 'Partial restore', message: `Restored ${restored}, failed ${failed}.` });
        } finally {
            setRestoring(false);
        }
    };

    return (
        <div className={styles.rightPane}>
            <div className={styles.header}>
                <div className="flex items-center gap-2">
                    <Target size={14} className="text-sky-400" />
                    <span className="text-[13px] font-semibold text-white">Apply targets</span>
                </div>
                <span className="text-[10px] bg-white/5 text-gray-400 px-2 py-0.5 rounded-full border border-white/8">{paths.length}</span>
            </div>

            <div className={styles.content}>
                {paths.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center px-4">
                        <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center mb-4 ring-1 ring-white/8">
                            <Folder size={24} className="text-gray-600" />
                        </div>
                        <p className="text-xs font-medium text-gray-400">Nothing selected</p>
                        <p className="text-[10px] text-gray-600 mt-2 leading-relaxed max-w-[200px]">
                            Select folders or files in the file list, then click an icon to apply.
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3 h-full">
                        <div className="text-[10px] text-emerald-300/90 bg-emerald-500/8 p-3 rounded-xl border border-emerald-500/15 flex gap-2 items-start">
                            <CheckCircle2 size={14} className="shrink-0 mt-0.5 text-emerald-400" />
                            <span className="leading-relaxed">Click any icon in the grid — changes write to <code className="text-emerald-200/70">desktop.ini</code> or shell registry.</span>
                        </div>

                        <div className="flex-1 overflow-y-auto bndz-scrollbar space-y-1.5 min-h-0">
                            {paths.map((item, i) => {
                                const win = toWindowsPath(item);
                                const name = win.split(/[/\\]/).pop() || item;
                                const isDrive = /^[A-Za-z]:\\?$/.test(win) || win.endsWith(':\\');
                                const isDir = isDrive || !name.includes('.');
                                return (
                                    <div key={i} className="bg-white/4 border border-white/6 hover:border-white/12 rounded-xl px-3 py-2.5 flex items-center gap-3 transition-colors">
                                        <ShellNativeIcon path={win} isDir={isDir} size={30} eager />
                                        <div className="min-w-0 flex-1">
                                            <div className="text-[11px] font-semibold text-white truncate">{name}</div>
                                            <div className="text-[9px] text-gray-600 font-mono truncate" title={win}>{win}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <button
                            type="button"
                            onClick={restoreAll}
                            disabled={restoring}
                            className="shrink-0 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-amber-500/20 bg-amber-500/8 hover:bg-amber-500/15 text-xs font-semibold text-amber-200/90 transition-colors disabled:opacity-50"
                        >
                            {restoring ? <span className="w-4 h-4 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" /> : <RotateCcw size={13} />}
                            Restore default icons
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
