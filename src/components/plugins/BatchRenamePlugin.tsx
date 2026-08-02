import React, { useEffect, useMemo, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { isQueuedIpcResult } from '../../lib/transferIpc';
import { pushToast } from '../ToastHost';
import PluginPanelShell from './PluginPanelShell';
import {
  PluginToolbarButton,
  PluginControlSection,
  PluginFieldLabel,
  PluginEmptyState,
  PluginHeroStrip,
  PluginHeroActionButton,
  PLUGIN_INPUT_CLASS,
  PLUGIN_SELECT_CLASS,
} from './PluginPanelPrimitives';

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

    const expandTokens = (str: string, index: number, oldName: string, parentDir: string) => {
        if (!str) return str;
        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
        const dot = oldName.lastIndexOf('.');
        const nameStem = dot > 0 ? oldName.slice(0, dot) : oldName;
        const ext = dot > 0 ? oldName.slice(dot + 1) : '';
        const parent = parentDir.split(/[/\\]/).filter(Boolean).pop() || '';
        return str
            .replace(/\{date\}/g, date)
            .replace(/\{time\}/g, time)
            .replace(/\{datetime\}/g, `${date}_${time}`)
            .replace(/\{index\}/g, String(seqStart + index).padStart(seqPad, '0'))
            .replace(/\{name\}/g, nameStem)
            .replace(/\{ext\}/g, ext)
            .replace(/\{parent\}/g, parent);
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

    const processItemFromRules = (oldName: string, index: number, parentDir: string) => {
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

        if (prefix) newBase = expandTokens(prefix, index, oldName, parentDir) + newBase;
        if (suffix) newBase = newBase + expandTokens(suffix, index, oldName, parentDir);

        if (useSequence) {
            const numStr = (seqStart + index).toString().padStart(seqPad, '0');
            newBase = newBase + seqSeparator + numStr;
        }

        if (useDateTokens) {
            newBase = expandTokens(newBase, index, oldName, parentDir);
            extension = expandTokens(extension, index, oldName, parentDir);
        }

        // Always expand {name}/{ext}/{parent} in the result base
        newBase = expandTokens(newBase, index, oldName, parentDir);

        return newBase + extension;
    };

    const processItem = (oldName: string, index: number, parentDir: string) => {
        if (aiOverrides[oldName] !== undefined) return aiOverrides[oldName];
        return processItemFromRules(oldName, index, parentDir);
    };

    const [autoSuffixCollisions, setAutoSuffixCollisions] = useState(true);
    const [targetOrder, setTargetOrder] = useState<string[]>([]);

    const orderedTargets = useMemo(() => {
        if (!targetOrder.length) return targets;
        const map = new Map(targets.map(t => [t.sourcePath, t]));
        const ordered = targetOrder.map(p => map.get(p)).filter(Boolean) as RenameTarget[];
        const rest = targets.filter(t => !targetOrder.includes(t.sourcePath));
        return [...ordered, ...rest];
    }, [targets, targetOrder]);

    useEffect(() => {
        setTargetOrder(prev => {
            const next = targets.map(t => t.sourcePath);
            if (prev.length && prev.every((p, i) => p === next[i])) return prev;
            return next;
        });
    }, [targets]);

    const rawPreviews = orderedTargets.map((t, i) => ({
        ...t,
        newName: processItem(t.oldName, i, t.parentDir),
    }));

    const previews = useMemo(() => {
        if (!autoSuffixCollisions) return rawPreviews;
        const used = new Map<string, number>();
        return rawPreviews.map(p => {
            if (p.oldName === p.newName || !p.newName) return p;
            const dir = p.parentDir.toLowerCase();
            let name = p.newName;
            let key = `${dir}\\${name.toLowerCase()}`;
            let n = used.get(key) || 0;
            if (n === 0) {
                used.set(key, 1);
                return p;
            }
            const dot = name.lastIndexOf('.');
            const stem = dot > 0 ? name.slice(0, dot) : name;
            const ext = dot > 0 ? name.slice(dot) : '';
            while (used.has(key)) {
                n += 1;
                name = `${stem} (${n})${ext}`;
                key = `${dir}\\${name.toLowerCase()}`;
            }
            used.set(key, 1);
            return { ...p, newName: name };
        });
    }, [rawPreviews, autoSuffixCollisions]);

    const collisions = useMemo(
        () => previews.filter(p => p.oldName !== p.newName && p.newName),
        [previews],
    );

    const batchNameConflicts = useMemo(() => {
        if (autoSuffixCollisions) return new Set<string>();
        const counts = new Map<string, number>();
        for (const p of previews) {
            if (p.oldName === p.newName || !p.newName) continue;
            const key = `${p.parentDir.toLowerCase()}\\${p.newName.toLowerCase()}`;
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        return new Set([...counts.entries()].filter(([, c]) => c > 1).map(([k]) => k));
    }, [previews, autoSuffixCollisions]);

    type RenamePreset = {
        name: string;
        findStr: string;
        replaceStr: string;
        useRegex: boolean;
        prefix: string;
        suffix: string;
        casing: typeof casing;
        useSequence: boolean;
        seqStart: number;
        seqPad: number;
        seqSeparator: string;
        useDateTokens: boolean;
    };
    const PRESET_KEY = 'bndz-rename-presets-v1';
    const [presets, setPresets] = useState<RenamePreset[]>(() => {
        try {
            const raw = localStorage.getItem(PRESET_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
    });
    const persistPresets = (next: RenamePreset[]) => {
        setPresets(next);
        localStorage.setItem(PRESET_KEY, JSON.stringify(next));
    };
    const savePreset = () => {
        const name = window.prompt('Preset name');
        if (!name?.trim()) return;
        const preset: RenamePreset = {
            name: name.trim(), findStr, replaceStr, useRegex, prefix, suffix, casing,
            useSequence, seqStart, seqPad, seqSeparator, useDateTokens,
        };
        persistPresets([...presets.filter(p => p.name !== preset.name), preset]);
        pushToast({ kind: 'success', title: 'Preset saved', message: preset.name });
    };
    const loadPreset = (p: RenamePreset) => {
        setFindStr(p.findStr); setReplaceStr(p.replaceStr); setUseRegex(p.useRegex);
        setPrefix(p.prefix); setSuffix(p.suffix); setCasing(p.casing);
        setUseSequence(p.useSequence); setSeqStart(p.seqStart); setSeqPad(p.seqPad);
        setSeqSeparator(p.seqSeparator); setUseDateTokens(p.useDateTokens);
    };
    const moveTarget = (index: number, dir: -1 | 1) => {
        const next = [...orderedTargets.map(t => t.sourcePath)];
        const j = index + dir;
        if (j < 0 || j >= next.length) return;
        [next[index], next[j]] = [next[j], next[index]];
        setTargetOrder(next);
    };

    const handleCommit = async () => {
        if (!collisions.length || committing) return;

        if (config?.previewAllRenameSpecialOperations) {
            const lines = collisions.slice(0, 24).map(p => `${p.oldName}  →  ${p.newName}`);
            const more = collisions.length > 24 ? `\n…and ${collisions.length - 24} more` : '';
            const ok = window.confirm(
                `Apply ${collisions.length} rename operation(s)?\n\n${lines.join('\n')}${more}`,
            );
            if (!ok) return;
        }

        setCommitting(true);

        try {
            const renames: Array<{ source: string; target: string }> = [];
            for (const p of collisions) {
                if (!p.parentDir) continue;
                const dest = `${p.parentDir}\\${p.newName}`;
                if (dest.toLowerCase() === p.sourcePath.toLowerCase()) continue;
                const exists = await IPC.checkPathExists(dest);
                if (exists) continue;
                renames.push({ source: p.sourcePath, target: dest });
            }

            if (!renames.length) {
                pushToast({ kind: 'warning', title: 'Nothing to rename', message: 'All items were unchanged, skipped, or would collide.' });
                return;
            }

            const operationId = `batch-rename-${Date.now()}`;
            const label = `Batch rename (${renames.length} items)`;
            const result = await IPC.executeBatchRename(operationId, renames, label);

            if (isQueuedIpcResult(result)) {
                pushToast({ kind: 'info', title: 'Rename queued', message: 'Running in the transfer panel…' });
                return;
            }

            if (result.ok) {
                const renamed = result.renamed ?? 0;
                const skipped = result.skipped ?? 0;
                if (skipped === 0) {
                    pushToast({ kind: 'success', title: 'Rename complete', message: `${renamed} item(s) renamed — undo restores all in one step.` });
                } else {
                    pushToast({
                        kind: 'info',
                        title: 'Rename finished',
                        message: `${renamed} renamed, ${skipped} skipped.`,
                    });
                }
            } else {
                pushToast({ kind: 'error', title: 'Rename failed', message: result.error || 'Batch rename could not complete.' });
            }
        } catch (err: any) {
            pushToast({ kind: 'error', title: 'Rename failed', message: err?.message || 'Unexpected error.' });
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
        >
            <div className="flex flex-col h-full min-h-0 overflow-hidden">
                <PluginHeroStrip
                    icon={<Icons8Icon id="batch_rename" size={52} className="opacity-90" />}
                    name={targets.length ? `${targets.length} item${targets.length === 1 ? '' : 's'} to rename` : 'Batch rename'}
                    typeLabel="Rename engine"
                    meta={
                        <span className="bndz-panel-muted text-xs">
                            {collisions.length ? `${collisions.length} pending change(s)` : 'Select files in the list'}
                            {batchNameConflicts.size > 0 ? ` · ${batchNameConflicts.size} collision(s)` : ''}
                        </span>
                    }
                    actions={
                        <>
                            <PluginHeroActionButton
                                icon={committing ? 'loading' : 'check'}
                                variant="primary"
                                onClick={() => void handleCommit()}
                                disabled={targets.length === 0 || committing || collisions.length === 0 || batchNameConflicts.size > 0}
                            >
                                Apply renames
                            </PluginHeroActionButton>
                            {targets.length > 0 && (
                                <PluginHeroActionButton icon="reset_ui" onClick={() => { setAiOverrides({}); setFindStr(''); setReplaceStr(''); }}>
                                    Reset rules
                                </PluginHeroActionButton>
                            )}
                        </>
                    }
                />
            <div className="px-4 py-2 border-b border-white/[0.06] flex flex-wrap items-center gap-2 shrink-0">
                <label className="inline-flex items-center gap-1.5 text-[10px] text-white/50 cursor-pointer">
                    <input type="checkbox" checked={autoSuffixCollisions} onChange={e => setAutoSuffixCollisions(e.target.checked)} />
                    Auto-suffix collisions
                </label>
                <span className="text-[10px] text-white/30">Tokens: {'{name}'} {'{ext}'} {'{parent}'} {'{date}'} {'{index}'}</span>
                <div className="flex-1" />
                <PluginToolbarButton icon="bookmark" onClick={savePreset}>Save preset</PluginToolbarButton>
                {presets.length > 0 && (
                    <select
                        className={PLUGIN_SELECT_CLASS}
                        defaultValue=""
                        onChange={e => {
                            const p = presets.find(x => x.name === e.target.value);
                            if (p) loadPreset(p);
                            e.target.value = '';
                        }}
                    >
                        <option value="">Load preset…</option>
                        {presets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                    </select>
                )}
            </div>
            <div className="w-full flex-1 flex text-gray-200 overflow-hidden min-h-0">
                <div className="bndz-plugin-sidebar max-w-[300px] flex flex-col overflow-y-auto bndz-scrollbar p-0">
                    <PluginControlSection title="Find & replace" icon="search">
                        <div>
                            <PluginFieldLabel>Find</PluginFieldLabel>
                            <div className="flex gap-1">
                                <input type="text" value={findStr} onChange={e => setFindStr(e.target.value)} placeholder="Text to find…" className={`${PLUGIN_INPUT_CLASS} flex-1`} />
                                <button type="button" onClick={() => setUseRegex(!useRegex)} className={`px-2 py-1 rounded-md border text-xs ${useRegex ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50' : 'bg-white/[0.03] text-gray-400 border-white/10'}`} title="Regular expressions">.*</button>
                            </div>
                        </div>
                        <div>
                            <PluginFieldLabel>Replace with</PluginFieldLabel>
                            <input type="text" value={replaceStr} onChange={e => setReplaceStr(e.target.value)} placeholder="Replacement text…" className={PLUGIN_INPUT_CLASS} />
                        </div>
                    </PluginControlSection>

                    <PluginControlSection title="Affixes" icon="file_ui">
                        <div className="flex gap-2">
                            <div className="flex-1">
                                <PluginFieldLabel>Prefix</PluginFieldLabel>
                                <input type="text" value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="prepend_" className={PLUGIN_INPUT_CLASS} />
                            </div>
                            <div className="flex-1">
                                <PluginFieldLabel>Suffix</PluginFieldLabel>
                                <input type="text" value={suffix} onChange={e => setSuffix(e.target.value)} placeholder="_append" className={PLUGIN_INPUT_CLASS} />
                            </div>
                        </div>
                    </PluginControlSection>

                    <PluginControlSection title="Formatting" icon="category_ui">
                        <PluginFieldLabel>Casing</PluginFieldLabel>
                        <select value={casing} onChange={e => setCasing(e.target.value as any)} className={`${PLUGIN_SELECT_CLASS} w-full`}>
                            <option value="none">No change</option>
                            <option value="lower">lowercase</option>
                            <option value="upper">UPPERCASE</option>
                            <option value="title">Title Case</option>
                            <option value="camel">camelCase</option>
                        </select>
                    </PluginControlSection>

                    <PluginControlSection
                        title="Sequential numbering"
                        icon="category_ui"
                        action={
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" checked={useSequence} onChange={e => setUseSequence(e.target.checked)} className="sr-only peer" />
                                <div className="w-7 h-4 bg-gray-700 rounded-full peer peer-checked:bg-emerald-500 transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:after:translate-x-full" />
                            </label>
                        }
                    >
                        {useSequence && (
                            <div className="space-y-2 bndz-plugin-card !p-2">
                                <div className="flex gap-2">
                                    <div className="flex-1">
                                        <PluginFieldLabel>Start at</PluginFieldLabel>
                                        <input type="number" min="0" value={seqStart} onChange={e => setSeqStart(parseInt(e.target.value) || 0)} className={PLUGIN_INPUT_CLASS} />
                                    </div>
                                    <div className="flex-1">
                                        <PluginFieldLabel>Padding</PluginFieldLabel>
                                        <input type="number" min="1" max="10" value={seqPad} onChange={e => setSeqPad(parseInt(e.target.value) || 1)} className={PLUGIN_INPUT_CLASS} />
                                    </div>
                                </div>
                                <div>
                                    <PluginFieldLabel>Separator</PluginFieldLabel>
                                    <input type="text" value={seqSeparator} onChange={e => setSeqSeparator(e.target.value)} className={PLUGIN_INPUT_CLASS} />
                                </div>
                            </div>
                        )}
                    </PluginControlSection>

                    <PluginControlSection
                        title="Date tokens"
                        icon="clock_ui"
                        action={
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" checked={useDateTokens} onChange={e => setUseDateTokens(e.target.checked)} className="sr-only peer" />
                                <div className="w-7 h-4 bg-gray-700 rounded-full peer peer-checked:bg-emerald-500 transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:after:translate-x-full" />
                            </label>
                        }
                    >
                        {useDateTokens && (
                            <p className="text-xs bndz-panel-muted leading-relaxed">
                                Use <code className="text-emerald-400">{'{date}'}</code>, <code className="text-emerald-400">{'{time}'}</code>, <code className="text-emerald-400">{'{datetime}'}</code>, <code className="text-emerald-400">{'{index}'}</code> in fields above.
                            </p>
                        )}
                    </PluginControlSection>

                    <PluginControlSection title="AI rename" icon="sparkles_ui">
                        <textarea
                            value={aiPrompt}
                            onChange={e => setAiPrompt(e.target.value)}
                            placeholder="e.g. Add date prefix, lowercase, remove spaces…"
                            className={`${PLUGIN_INPUT_CLASS} min-h-[64px] resize-y`}
                        />
                        <PluginToolbarButton
                            icon={aiLoading ? 'loading' : 'sparkles_ui'}
                            onClick={() => void runAiRename()}
                            disabled={!targets.length || !aiPrompt.trim() || aiLoading}
                            active
                        >
                            Generate AI names
                        </PluginToolbarButton>
                    </PluginControlSection>
                </div>

                <div className="flex-1 overflow-y-auto relative bndz-scrollbar p-3">
                    {targets.length === 0 ? (
                        <PluginEmptyState icon="batch_rename" title="Select files to preview renames" description="Hold Ctrl or Shift in the list to select multiple files." />
                    ) : (
                        <div className="flex flex-col gap-2">
                            {previews.map((p, i) => {
                                const changed = p.oldName !== p.newName;
                                const emptyName = !p.newName?.trim();
                                const conflictKey = `${p.parentDir.toLowerCase()}\\${p.newName.toLowerCase()}`;
                                const hasConflict = changed && !emptyName && batchNameConflicts.has(conflictKey);
                                const skipReason = emptyName
                                    ? 'Empty name'
                                    : !changed
                                        ? 'Unchanged — skipped'
                                        : null;
                                return (
                                    <div
                                        key={`${p.sourcePath}-${i}`}
                                        className={`bndz-plugin-card !py-2.5 !px-3 flex items-center gap-3 border border-white/[0.06] ${
                                            hasConflict || emptyName
                                                ? 'border-rose-500/35 bg-rose-950/15'
                                                : !changed
                                                    ? 'opacity-70'
                                                    : 'hover:border-emerald-500/25'
                                        }`}
                                    >
                                        <div className="flex-1 min-w-0 space-y-1">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span
                                                    className={`text-xs truncate ${changed ? 'text-slate-500 line-through decoration-rose-500/40' : 'text-slate-300'}`}
                                                    title={p.sourcePath}
                                                >
                                                    {p.oldName}
                                                </span>
                                                {hasConflict && (
                                                    <span className="bndz-plugin-kind-pill !text-[9px] shrink-0 text-rose-300 border-rose-500/30 bg-rose-500/10">
                                                        Conflict
                                                    </span>
                                                )}
                                                {skipReason && (
                                                    <span
                                                        className={`bndz-plugin-kind-pill !text-[9px] shrink-0 ${
                                                            emptyName
                                                                ? 'text-rose-300 border-rose-500/30 bg-rose-500/10'
                                                                : 'text-slate-400 border-white/10 bg-white/[0.03]'
                                                        }`}
                                                    >
                                                        {skipReason}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 min-w-0">
                                                <Icons8Icon
                                                    id="chevron_right"
                                                    size={12}
                                                    className={`shrink-0 ${changed && !skipReason ? 'text-emerald-500/60' : 'text-slate-600'}`}
                                                />
                                                <input
                                                    type="text"
                                                    value={p.newName}
                                                    onChange={e => {
                                                        const next = e.target.value;
                                                        setAiOverrides(prev => {
                                                            const copy = { ...prev };
                                                            if (next === processItemFromRules(p.oldName, i)) {
                                                                delete copy[p.oldName];
                                                            } else {
                                                                copy[p.oldName] = next;
                                                            }
                                                            return copy;
                                                        });
                                                    }}
                                                    title={`${p.parentDir}\\${p.newName}`}
                                                    className={`${PLUGIN_INPUT_CLASS} !py-1 flex-1 min-w-0 ${
                                                        hasConflict || emptyName
                                                            ? 'border-rose-500/40 text-rose-200'
                                                            : changed
                                                                ? 'text-emerald-300'
                                                                : 'text-slate-400'
                                                    }`}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
            </div>
        </PluginPanelShell>
    );
}
