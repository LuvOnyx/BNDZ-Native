import React, { useMemo, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { pushToast } from '../ToastHost';
import PluginPanelShell from './PluginPanelShell';

export const BatchRenamePluginDef = {
    id: "batch-rename",
    name: "Batch Rename",
    icon: 'batch_rename'
};

type RenameTarget = {
    sourcePath: string;
    oldName: string;
    parentDir: string;
};

function normalizeTargets(selectedItems: string[], focusedPath?: string): RenameTarget[] {
    const parentFallback = (focusedPath || '').replace(/\//g, '\\').replace(/\\+$/, '');
    return selectedItems.map(raw => {
        const normalized = raw.replace(/\//g, '\\');
        if (/^[A-Za-z]:\\/.test(normalized) || normalized.startsWith('\\\\')) {
            const sep = normalized.lastIndexOf('\\');
            return {
                sourcePath: normalized,
                oldName: sep >= 0 ? normalized.slice(sep + 1) : normalized,
                parentDir: sep >= 0 ? normalized.slice(0, sep) : parentFallback,
            };
        }
        return {
            sourcePath: parentFallback ? `${parentFallback}\\${raw}` : raw,
            oldName: raw,
            parentDir: parentFallback,
        };
    });
}

export default function BatchRenamePlugin({ activeTab, drives, config, entity, focusedPath, selectedItems }: any) {
    const [findStr, setFindStr] = useState("");
    const [replaceStr, setReplaceStr] = useState("");
    const [useRegex, setUseRegex] = useState(false);
    
    const [prefix, setPrefix] = useState("");
    const [suffix, setSuffix] = useState("");
    const [casing, setCasing] = useState<"none" | "lower" | "upper" | "title" | "camel">("none");
    const [useSequence, setUseSequence] = useState(false);
    const [seqStart, setSeqStart] = useState<number>(1);
    const [seqPad, setSeqPad] = useState<number>(3);
    const [seqSeparator, setSeqSeparator] = useState<string>("_");
    const [useDateTokens, setUseDateTokens] = useState(false);
    const [committing, setCommitting] = useState(false);
    const [aiPrompt, setAiPrompt] = useState('');
    const [aiLoading, setAiLoading] = useState(false);
    const [aiOverrides, setAiOverrides] = useState<Record<string, string>>({});

    const targets = useMemo(
        () => normalizeTargets(selectedItems || [], focusedPath),
        [selectedItems, focusedPath],
    );

    const expandTokens = (str: string, index: number) => {
        if (!str) return str;
        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
        return str
            .replace(/\{date\}/g, date)
            .replace(/\{time\}/g, time)
            .replace(/\{datetime\}/g, `${date}_${time}`)
            .replace(/\{index\}/g, String(seqStart + index).padStart(seqPad, '0'));
    };

    const applyCasing = (str: string, type: string) => {
        if (type === "lower") return str.toLowerCase();
        if (type === "upper") return str.toUpperCase();
        if (type === "title") return str.replace(/\b\w/g, c => c.toUpperCase());
        if (type === "camel") return str.replace(/(?:^\w|[A-Z]|\b\w|\s+)/g, (m, i) => {
            if (+m === 0) return ""; 
            return i === 0 ? m.toLowerCase() : m.toUpperCase();
        }).replace(/\s+/g, '');
        return str;
    };

    const processItem = (oldName: string, index: number) => {
        if (aiOverrides[oldName]) return aiOverrides[oldName];

        let baseName = oldName;
        let extension = "";
        const dotIndex = oldName.lastIndexOf('.');
        if (dotIndex > 0) {
            baseName = oldName.substring(0, dotIndex);
            extension = oldName.substring(dotIndex);
        }

        let newBase = baseName;

        if (findStr) {
            if (useRegex) {
                try {
                    const regex = new RegExp(findStr, 'g');
                    newBase = newBase.replace(regex, replaceStr);
                } catch { /* invalid regex while typing */ }
            } else {
                newBase = newBase.split(findStr).join(replaceStr);
            }
        }

        if (casing !== "none") {
            newBase = applyCasing(newBase, casing);
        }

        if (prefix) newBase = prefix + newBase;
        if (suffix) newBase = newBase + suffix;

        if (useSequence) {
            const numStr = (seqStart + index).toString().padStart(seqPad, '0');
            newBase = newBase + seqSeparator + numStr;
        }

        if (useDateTokens) {
            newBase = expandTokens(newBase, index);
            extension = expandTokens(extension, index);
        }

        return newBase + extension;
    };

    const previews = targets.map((t, i) => ({
        ...t,
        newName: processItem(t.oldName, i),
    }));

    const collisions = useMemo(
        () => previews.filter(p => p.oldName !== p.newName && p.newName),
        [previews],
    );

    const batchNameConflicts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const p of previews) {
            if (p.oldName === p.newName || !p.newName) continue;
            const key = `${p.parentDir.toLowerCase()}\\${p.newName.toLowerCase()}`;
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        return new Set([...counts.entries()].filter(([, c]) => c > 1).map(([k]) => k));
    }, [previews]);

    const handleCommit = async () => {
        if (!collisions.length || committing) return;
        setCommitting(true);
        let renamed = 0;
        let skipped = 0;
        let failed = 0;

        try {
            for (const p of collisions) {
                if (!p.parentDir) { failed++; continue; }
                const dest = `${p.parentDir}\\${p.newName}`;
                if (dest.toLowerCase() === p.sourcePath.toLowerCase()) {
                    skipped++;
                    continue;
                }
                try {
                    const exists = await IPC.checkPathExists(dest);
                    if (exists) {
                        skipped++;
                        continue;
                    }
                    await IPC.executeFsOperation(`rename-batch-${renamed}`, 'move', p.sourcePath, dest);
                    renamed++;
                } catch {
                    failed++;
                }
            }
            if (failed === 0 && skipped === 0) {
                pushToast({ kind: 'success', title: 'Rename complete', message: `${renamed} item(s) renamed.` });
            } else {
                pushToast({
                    kind: skipped > 0 && renamed === 0 ? 'warning' : 'info',
                    title: 'Rename finished',
                    message: `${renamed} renamed, ${skipped} skipped (collision/unchanged), ${failed} failed.`,
                });
            }
        } finally {
            setCommitting(false);
        }
    };

    const runAiRename = async () => {
        if (!targets.length || !aiPrompt.trim() || aiLoading) return;
        setAiLoading(true);
        try {
            const ops = await IPC.aiBatchRename(targets.map(t => t.oldName), aiPrompt.trim());
            if (!ops.length) {
                pushToast({ kind: 'warning', title: 'AI rename', message: 'No suggestions returned. Load the AI model in Smart Tools → Assistant.' });
                return;
            }
            const map: Record<string, string> = {};
            for (const op of ops) {
                if (op.originalName && op.newName) map[op.originalName] = op.newName;
            }
            setAiOverrides(map);
            pushToast({ kind: 'success', title: 'AI rename', message: `${ops.length} suggestion(s) applied to preview.` });
        } catch (err: any) {
            pushToast({ kind: 'error', title: 'AI rename failed', message: err?.message || 'Request failed.' });
        } finally {
            setAiLoading(false);
        }
    };

    return (
        <PluginPanelShell
            title="Batch Rename"
            icon="batch_rename"
            iconColor="#34d399"
            variant="embedded"
            subtitle={`${targets.length} item${targets.length === 1 ? '' : 's'} selected${batchNameConflicts.size ? ` · ${batchNameConflicts.size} name collision(s)` : ''}`}
            toolbar={
                <button
                    type="button"
                    onClick={() => void handleCommit()}
                    disabled={targets.length === 0 || committing || collisions.length === 0 || batchNameConflicts.size > 0}
                    className="px-3 py-1.5 text-[11px] bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-900/30 disabled:text-gray-600 rounded text-white font-semibold border border-emerald-500/50 flex items-center gap-1.5"
                >
                    {committing ? <Icons8Icon id="loading" size={12} spin /> : null}
                    Apply Renames
                </button>
            }
        >
            <div className="w-full h-full flex text-gray-200 text-xs font-sans overflow-hidden">
                <div className="w-[320px] bg-[#141414] border-r border-[#222] flex flex-col overflow-y-auto bndz-scrollbar">
                    <div className="p-4 border-b border-[#222]">
                        <h3 className="text-gray-400 font-semibold mb-3 flex items-center gap-1 uppercase tracking-wider text-[10px]"><Icons8Icon id="search" size={12}/> Find & Replace</h3>
                        <div className="space-y-3">
                            <div>
                                <label className="text-[#888] text-[10px] mb-1 block">Find Context</label>
                                <div className="flex gap-1 relative">
                                    <input type="text" value={findStr} onChange={e => setFindStr(e.target.value)} placeholder="Text to find..." className="flex-1 bg-[#090909] border border-[#333] px-2 py-1.5 outline-none focus:border-emerald-500 rounded-sm transition-colors text-white" />
                                    <button onClick={() => setUseRegex(!useRegex)} className={`px-2 py-1 flex items-center justify-center rounded-sm border ${useRegex ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50' : 'bg-[#1a1a1a] text-gray-400 border-[#333] hover:bg-[#222]'}`} title="Use Regular Expressions">
                                        .*
                                    </button>
                                </div>
                            </div>
                            <div>
                                <label className="text-[#888] text-[10px] mb-1 block">Replace With</label>
                                <input type="text" value={replaceStr} onChange={e => setReplaceStr(e.target.value)} placeholder="Replacement text..." className="w-full bg-[#090909] border border-[#333] px-2 py-1.5 outline-none focus:border-emerald-500 rounded-sm transition-colors text-white" />
                            </div>
                        </div>
                    </div>

                    <div className="p-4 border-b border-[#222]">
                        <h3 className="text-gray-400 font-semibold mb-3 flex items-center gap-1 uppercase tracking-wider text-[10px]"><Icons8Icon id="file_ui" size={12}/> Affixes</h3>
                        <div className="flex gap-3">
                            <div className="flex-1">
                                <label className="text-[#888] text-[10px] mb-1 block">Prefix</label>
                                <input type="text" value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="prepend_" className="w-full bg-[#090909] border border-[#333] px-2 py-1.5 outline-none focus:border-emerald-500 rounded-sm transition-colors text-white" />
                            </div>
                            <div className="flex-1">
                                <label className="text-[#888] text-[10px] mb-1 block">Suffix</label>
                                <input type="text" value={suffix} onChange={e => setSuffix(e.target.value)} placeholder="_append" className="w-full bg-[#090909] border border-[#333] px-2 py-1.5 outline-none focus:border-emerald-500 rounded-sm transition-colors text-white" />
                            </div>
                        </div>
                    </div>

                    <div className="p-4 border-b border-[#222]">
                        <h3 className="text-gray-400 font-semibold mb-3 flex items-center gap-1 uppercase tracking-wider text-[10px]"><Icons8Icon id="category_ui" size={12}/> Formatting</h3>
                        <div>
                            <label className="text-[#888] text-[10px] mb-1 block">Casing Rule</label>
                            <select value={casing} onChange={e => setCasing(e.target.value as any)} className="w-full bg-[#090909] border border-[#333] px-2 py-1.5 outline-none focus:border-emerald-500 rounded-sm transition-colors text-white">
                                <option value="none">No Change</option>
                                <option value="lower">lowercase (all)</option>
                                <option value="upper">UPPERCASE (all)</option>
                                <option value="title">Title Case</option>
                                <option value="camel">camelCase</option>
                            </select>
                        </div>
                    </div>

                    <div className="p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-gray-400 font-semibold flex items-center gap-1 uppercase tracking-wider text-[10px]"><Icons8Icon id="category_ui" size={12}/> Sequential Numbering</h3>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" checked={useSequence} onChange={e => setUseSequence(e.target.checked)} className="sr-only peer" />
                                <div className="w-7 h-4 bg-gray-700 rounded-full peer peer-checked:bg-emerald-500 peer-focus:outline-none transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:after:translate-x-full"></div>
                            </label>
                        </div>
                        {useSequence && (
                            <div className="space-y-3 bg-[#0a0a0a] p-3 rounded border border-[#222]">
                                <div className="flex gap-2">
                                    <div className="flex-1">
                                        <label className="text-[#666] text-[10px] mb-1 block">Start at</label>
                                        <input type="number" min="0" value={seqStart} onChange={e => setSeqStart(parseInt(e.target.value)||0)} className="w-full bg-[#111] border border-[#333] px-2 py-1 outline-none focus:border-emerald-500 rounded-sm" />
                                    </div>
                                    <div className="flex-1">
                                        <label className="text-[#666] text-[10px] mb-1 block">Padding (0s)</label>
                                        <input type="number" min="1" max="10" value={seqPad} onChange={e => setSeqPad(parseInt(e.target.value)||1)} className="w-full bg-[#111] border border-[#333] px-2 py-1 outline-none focus:border-emerald-500 rounded-sm" />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[#666] text-[10px] mb-1 block">Separator</label>
                                    <input type="text" value={seqSeparator} onChange={e => setSeqSeparator(e.target.value)} className="w-full bg-[#111] border border-[#333] px-2 py-1 outline-none focus:border-emerald-500 rounded-sm" />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="p-4 border-t border-[#222]">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-gray-400 font-semibold flex items-center gap-1 uppercase tracking-wider text-[10px]"><Icons8Icon id="clock_ui" size={12}/> Date tokens</h3>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" checked={useDateTokens} onChange={e => setUseDateTokens(e.target.checked)} className="sr-only peer" />
                                <div className="w-7 h-4 bg-gray-700 rounded-full peer peer-checked:bg-emerald-500 transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:after:translate-x-full"></div>
                            </label>
                        </div>
                        {useDateTokens && (
                            <p className="text-[10px] text-gray-500 leading-relaxed">
                                Use <code className="text-emerald-400">{'{date}'}</code>, <code className="text-emerald-400">{'{time}'}</code>, <code className="text-emerald-400">{'{datetime}'}</code>, <code className="text-emerald-400">{'{index}'}</code> in prefix, suffix, or find/replace fields.
                            </p>
                        )}
                    </div>

                    <div className="p-4 border-t border-[#222]">
                        <h3 className="text-gray-400 font-semibold mb-2 flex items-center gap-1 uppercase tracking-wider text-[10px]">
                            <Icons8Icon id="sparkles_ui" size={12} /> AI rename
                        </h3>
                        <textarea
                            value={aiPrompt}
                            onChange={e => setAiPrompt(e.target.value)}
                            placeholder="e.g. Add date prefix, lowercase, remove spaces…"
                            className="w-full min-h-[64px] bg-[#090909] border border-[#333] px-2 py-1.5 text-[11px] outline-none focus:border-emerald-500 text-white resize-y"
                        />
                        <button
                            type="button"
                            onClick={() => void runAiRename()}
                            disabled={!targets.length || !aiPrompt.trim() || aiLoading}
                            className="mt-2 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] bg-[#094771] hover:bg-[#0a5a8c] disabled:opacity-40 text-white"
                        >
                            {aiLoading ? <Icons8Icon id="loading" size={12} spin /> : <Icons8Icon id="sparkles_ui" size={12} />}
                            Generate AI names
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto bg-[#0a0a0a] relative bndz-scrollbar">
                    {targets.length === 0 ? (
                        <div className="absolute inset-0 flex items-center justify-center text-gray-600 flex-col gap-2 pointer-events-none">
                            <Icons8Icon id="batch_rename" size={48} className="opacity-20" />
                            <span className="font-medium text-sm">Select files to preview renames</span>
                            <span className="text-[10px] text-gray-500">Hold CTRL or SHIFT in the list to select multiple files.</span>
                        </div>
                    ) : (
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-[#111] sticky top-0 border-b border-[#222] shadow-sm z-10">
                                <tr>
                                    <th className="p-2.5 font-semibold text-[#888] w-1/2 uppercase tracking-wide text-[10px]">Original Name</th>
                                    <th className="p-2.5 w-8"></th>
                                    <th className="p-2.5 font-semibold text-[#888] w-1/2 uppercase tracking-wide text-[10px]">New Name</th>
                                </tr>
                            </thead>
                            <tbody>
                                {previews.map((p, i) => {
                                    const changed = p.oldName !== p.newName;
                                    const conflictKey = `${p.parentDir.toLowerCase()}\\${p.newName.toLowerCase()}`;
                                    const hasConflict = changed && batchNameConflicts.has(conflictKey);
                                    return (
                                    <tr key={i} className={`border-b border-[#181818] hover:bg-[#111] group ${hasConflict ? 'bg-red-950/20' : ''}`}>
                                        <td className="p-2.5 truncate max-w-xs transition-colors" style={{ color: changed ? '#888' : '#ccc' }} title={p.sourcePath}>
                                            <span className={changed ? 'line-through decoration-red-500/50' : ''}>{p.oldName}</span>
                                        </td>
                                        <td className="p-2.5 flex justify-center text-gray-600 group-hover:text-emerald-500/50 transition-colors">
                                            {changed ? <Icons8Icon id="chevron_right" size={12} /> : <div className="w-3" />}
                                        </td>
                                        <td className="p-2.5 truncate max-w-xs transition-colors" style={{ color: changed ? '#34d399' : '#ccc' }} title={`${p.parentDir}\\${p.newName}`}>
                                            {p.newName}
                                        </td>
                                    </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </PluginPanelShell>
    );
}
