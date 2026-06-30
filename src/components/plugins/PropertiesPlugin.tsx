import React, { useMemo, useEffect, useState } from 'react';
import {
    Check, Settings, Loader2, Key, AlertCircle, Copy, ExternalLink, FolderOpen,
    Layers, Shield, Tag, Save,
} from 'lucide-react';
import PluginPanelShell from './PluginPanelShell';
import { FSEntity } from '../../types';
import { toWindowsPath, normalizePanePath, isRecycleBinPath } from '../../lib/pathUtils';
import { formatPropertiesPath } from '../../lib/displayPath';
import { getPaneTabLabel } from '../../lib/paneLabels';
import { getLocationIconPath } from '../../lib/virtualLocations';
import { resolveShellPropertiesPath } from '../../lib/shellPaths';
import { PreviewHeroIcon } from '../PreviewHeroIcon';
import { isAudioExt, isVideoExt } from '../../lib/mediaTypes';

type PropTab = 'general' | 'security' | 'hashes';

export default function PropertiesPlugin({
    entity,
    config,
    drives = [],
    focusedPath = "",
    primarySelectedPath = null,
    selectedItems = [],
}: {
    entity: FSEntity | null;
    config: any;
    drives?: any[];
    focusedPath?: string;
    primarySelectedPath?: string | null;
    selectedItems?: string[];
}) {
    const [fileDetails, setFileDetails] = useState<any>(null);
    const [hash, setHash] = useState<{ md5?: string; sha256?: string; loading?: boolean }>({});
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<PropTab>('general');
    const [copied, setCopied] = useState(false);
    const [sidecarLabel, setSidecarLabel] = useState('');
    const [sidecarComment, setSidecarComment] = useState('');
    const [sidecarTags, setSidecarTags] = useState<string[]>([]);
    const [tagDraft, setTagDraft] = useState('');
    const [sidecarDirty, setSidecarDirty] = useState(false);
    const [sidecarSaving, setSidecarSaving] = useState(false);
    const [hashCopied, setHashCopied] = useState<'md5' | 'sha256' | null>(null);
    const [aclNotice, setAclNotice] = useState<string | null>(null);

    const selectionCount = selectedItems.length;
    const isMulti = selectionCount > 1;

    const targetPath = useMemo(() => {
        if (primarySelectedPath) return formatPropertiesPath(primarySelectedPath);
        if (selectedItems.length > 0) return formatPropertiesPath(selectedItems[0]);
        if (entity?.path) return formatPropertiesPath(entity.path);
        return formatPropertiesPath(focusedPath);
    }, [primarySelectedPath, selectedItems, entity?.path, focusedPath]);

    const displayName = useMemo(() => {
        if (isMulti) return `${selectionCount} items selected`;
        if ((entity as any)?.isVirtual && entity?.name) return entity.name;
        if (entity?.name && !entity.name.toLowerCase().startsWith('shell:')) return entity.name;
        const pane = normalizePanePath(focusedPath || entity?.path || '');
        if (pane) return getPaneTabLabel(pane);
        return targetPath.split(/[/\\]/).pop() || 'Selection';
    }, [isMulti, selectionCount, entity?.name, entity?.path, focusedPath, targetPath]);

    const ext = !isMulti && entity?.type === 'file' ? ((entity as any)?.extension?.toLowerCase() || '') : '';
    const isDir = !isMulti && (entity?.type === 'directory' || (entity as any)?.isVirtual || isRecycleBinPath(focusedPath));
    const isDrive = !!(entity as any)?.driveInfo;

    const driveInfo = useMemo(() => {
        if ((entity as any)?.driveInfo) return (entity as any).driveInfo;
        const norm = normalizePanePath(targetPath.replace(/\\/g, '/'));
        return drives.find(d => {
            const dn = normalizePanePath((d.name || '').replace(/\\/g, '/'));
            return dn === norm || norm === dn || norm.startsWith(dn + '/');
        }) || null;
    }, [drives, targetPath, entity]);

    const isDriveEntity = isDrive || !!driveInfo;

    useEffect(() => {
        if (!targetPath || isMulti) {
            setFileDetails(null);
            setHash({ loading: false });
            return;
        }

        if (isDriveEntity && driveInfo) {
            setFileDetails({
                exactSize: driveInfo.totalSpace ?? 0,
                attributes: { Archive: false, Hidden: false, System: false, ReadOnly: false },
                acl: { read: true, write: true, execute: false },
                creation: '',
                modification: '',
                accessed: '',
                owner: 'System',
            });
            setHash({ loading: false });
            setError(null);
            return;
        }

        setFileDetails(null);
        setHash({ loading: true });
        setError(null);
        let shouldUpdate = true;

        import('../../lib/ipcBridge').then(({ IPC }) => {
            if (!shouldUpdate) return;

            if (IPC.isNative) {
                IPC.getExtendedMetadata(targetPath).then((details: any) => {
                    if (!shouldUpdate) return;
                    const exactSize = details["File Size"] ? parseInt(details["File Size"], 10) : (entity?.type === 'file' ? (entity as any).size || 0 : 0);
                    setFileDetails({
                        exactSize,
                        attributes: {
                            Archive: details["Archive"] === "true",
                            Hidden: details["Hidden"] === "true",
                            System: details["System"] === "true",
                            ReadOnly: details["ReadOnly"] === "true",
                        },
                        acl: { read: true, write: details["ACL Rule"]?.includes("W"), execute: details["ACL Rule"]?.includes("X") },
                        aclRules: details["ACL Rules"] ? details["ACL Rules"].split('\n').filter(Boolean) : [],
                        creation: details["Created"] || (entity?.created || ''),
                        modification: details["Modified"] || (entity?.modified || ''),
                        accessed: details["Accessed"] || '',
                        owner: details["Owner"] || "Unknown User",
                    });
                }).catch((err: any) => {
                    if (shouldUpdate) setError(err.message || "Failed to fetch properties.");
                });

                if (entity?.type === 'file') {
                    IPC.getAsyncHashes(targetPath).then(hashes => {
                        if (shouldUpdate) setHash({ ...hashes, loading: false });
                    }).catch(() => {
                        if (shouldUpdate) setHash({ loading: false });
                    });
                } else {
                    if (shouldUpdate) setHash({ loading: false });
                }
            } else {
                if (shouldUpdate) {
                    setError("Full system properties require the BNDZ Native Host.");
                    setHash({ loading: false });
                }
            }
        });

        return () => { shouldUpdate = false; };
    }, [targetPath, entity, isMulti, isDriveEntity, driveInfo]);

    useEffect(() => {
        if (!targetPath || isMulti || isDriveEntity) {
            setSidecarLabel('');
            setSidecarComment('');
            setSidecarTags([]);
            setSidecarDirty(false);
            return;
        }
        let active = true;
        import('../../lib/ipcBridge').then(({ IPC }) => {
            const winPath = targetPath.replace(/\//g, '\\');
            IPC.getTagSidecar(winPath).then(sc => {
                if (!active) return;
                setSidecarLabel(sc?.label || '');
                setSidecarComment(sc?.comment || '');
                setSidecarTags(Array.isArray(sc?.tags) ? sc!.tags! : []);
                setSidecarDirty(false);
            });
        });
        return () => { active = false; };
    }, [targetPath, isMulti, isDriveEntity]);

    const saveSidecarMeta = async () => {
        if (!targetPath || sidecarSaving) return;
        setSidecarSaving(true);
        try {
            const { IPC } = await import('../../lib/ipcBridge');
            const winPath = targetPath.replace(/\//g, '\\');
            await IPC.setTagMeta(winPath, sidecarLabel, sidecarComment, sidecarTags);
            setSidecarDirty(false);
        } finally {
            setSidecarSaving(false);
        }
    };

    const formatSize = (bytes: number) => {
        if (bytes === undefined || bytes === null || isNaN(bytes)) return "-- B";
        if (bytes === 0) return "0 B";
        const k = 1024, sizes = ["B", "KB", "MB", "GB", "TB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    };

    const runIpc = (fn: (IPC: any) => void) => {
        import('../../lib/ipcBridge').then(({ IPC }) => fn(IPC));
    };

    const copyPath = () => {
        if (!targetPath) return;
        runIpc(IPC => IPC.shellExecute('copyPath', targetPath));
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const openItem = () => {
        if (!targetPath) return;
        runIpc(IPC => IPC.executeContextMenuVerb(targetPath, 'open'));
    };

    const showInExplorer = () => {
        if (!targetPath) return;
        runIpc(IPC => IPC.shellExecute('openExplorer', targetPath));
    };

    const showNativeProperties = () => {
        const raw = primarySelectedPath || entity?.path || focusedPath || targetPath;
        const shellPath = resolveShellPropertiesPath(raw);
        if (!shellPath) return;
        runIpc(IPC => IPC.executeContextMenuVerb(shellPath, 'properties'));
    };

    const toggleAttribute = (attr: string) => {
        if (!fileDetails || !targetPath) return;
        const newAttributes = { ...fileDetails.attributes, [attr]: !fileDetails.attributes[attr] };
        setFileDetails({ ...fileDetails, attributes: newAttributes });
        runIpc(IPC => { if (IPC.isNative) IPC.setFileAttributes(targetPath, newAttributes); });
    };

    const toggleAcl = async (type: 'read' | 'write' | 'execute') => {
        if (!fileDetails || !targetPath) return;
        const newAcl = { ...fileDetails.acl, [type]: !fileDetails.acl?.[type] };
        setFileDetails({ ...fileDetails, acl: newAcl });
        const { IPC } = await import('../../lib/ipcBridge');
        if (IPC.isNative) {
            const ok = await IPC.setFileAcl(targetPath, newAcl);
            if (!ok) {
                setAclNotice('ACL editing is preview-only in this build. Use Windows Security tab for full control.');
                setFileDetails({ ...fileDetails, acl: fileDetails.acl });
            }
        }
    };

    const addTagChip = () => {
        const t = tagDraft.trim().toLowerCase();
        if (!t || sidecarTags.some(x => x.toLowerCase() === t)) { setTagDraft(''); return; }
        setSidecarTags(prev => [...prev, t]);
        setTagDraft('');
        setSidecarDirty(true);
    };

    const removeTagChip = (tag: string) => {
        setSidecarTags(prev => prev.filter(t => t !== tag));
        setSidecarDirty(true);
    };

    const copyHash = async (kind: 'md5' | 'sha256') => {
        const value = (hash as any)[kind];
        if (!value || value === 'Pending...') return;
        try {
            await navigator.clipboard.writeText(value);
            setHashCopied(kind);
            setTimeout(() => setHashCopied(null), 1500);
        } catch {
            runIpc(IPC => IPC.shellExecute('copyPath', value));
            setHashCopied(kind);
            setTimeout(() => setHashCopied(null), 1500);
        }
    };

    const heroIconPath = useMemo(() => {
        if (isMulti) return null;
        if ((entity as any)?.isVirtual || isRecycleBinPath(focusedPath) || isRecycleBinPath(entity?.path)) {
            return getLocationIconPath(focusedPath || entity?.path || '');
        }
        return resolveShellPropertiesPath(focusedPath || entity?.path || targetPath);
    }, [isMulti, entity, focusedPath, targetPath]);

    if (!targetPath && selectionCount === 0) {
        return (
            <PluginPanelShell
                title="Properties"
                icon={Layers}
                iconColor="#38bdf8"
                subtitle="No selection"
            >
                <div className="flex flex-col items-center justify-center h-full min-h-[120px] text-gray-500 gap-3 p-6 select-none">
                    <Layers size={40} className="opacity-20 text-sky-400" />
                    <p className="text-xs text-center max-w-[260px] leading-relaxed">
                        Select items to inspect properties, attributes, hashes, and BNDZ tags.
                    </p>
                </div>
            </PluginPanelShell>
        );
    }

    const typeLabel = isMulti
        ? 'Multi-Selection'
        : (entity as any)?.isVirtual
            ? 'System Folder'
        : driveInfo
            ? 'System Volume'
            : isDir
                ? 'Folder'
                : isAudioExt(ext)
                    ? 'Audio File'
                    : isVideoExt(ext)
                        ? 'Video File'
                        : ext
                            ? `${ext.toUpperCase()} File`
                            : 'File';

    const tabs: { id: PropTab; label: string; show: boolean }[] = [
        { id: 'general', label: 'General', show: true },
        { id: 'security', label: 'Security', show: !isMulti && !driveInfo },
        { id: 'hashes', label: 'Hashes', show: !isMulti && !driveInfo && entity?.type === 'file' },
    ];

    return (
        <PluginPanelShell
            title="Properties"
            icon={Layers}
            iconColor="#38bdf8"
            subtitle={displayName}
            toolbar={
                <>
                    {!isMulti && (
                        <button type="button" onClick={openItem} className="px-2 py-1 text-[10px] font-semibold bg-sky-600/20 border border-sky-500/30 text-sky-400 rounded">Open</button>
                    )}
                    <button type="button" onClick={copyPath} className="px-2 py-1 text-[10px] font-semibold bg-[#1a1a1a] border border-[#333] text-gray-400 rounded">{copied ? 'Copied' : 'Copy Path'}</button>
                </>
            }
        >
        <div className="flex-1 w-full flex flex-col bg-[#0d0d0d] overflow-hidden text-gray-300 min-h-0">
            {/* Hero header — distinct from preview panel (actions + identity, not content) */}
            <div className="shrink-0 border-b border-[#222] bg-gradient-to-r from-[#141414] to-[#0f0f0f] px-5 py-4 flex gap-5 items-center">
                <PreviewHeroIcon
                    path={heroIconPath}
                    isDir={isDir}
                    isDrive={!!driveInfo}
                    size={96}
                    extension={ext}
                    preferThumbnail={!isDir && !isMulti}
                />
                <div className="flex-1 min-w-0">
                    <h2 className="text-[15px] font-bold text-white truncate leading-tight">{displayName}</h2>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] uppercase tracking-widest font-bold text-sky-500/80 bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/20">{typeLabel}</span>
                        {isMulti && (
                            <span className="text-[10px] text-gray-500 font-mono">{selectionCount} paths</span>
                        )}
                    </div>
                    {!isMulti && targetPath && (
                        <p className="text-[10px] text-gray-500 font-mono mt-2 truncate" title={targetPath}>{targetPath}</p>
                    )}
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                    {!isMulti && (
                        <button type="button" onClick={openItem} className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-sky-600/20 border border-sky-500/30 text-sky-400 rounded hover:bg-sky-600/30 transition-colors">
                            <ExternalLink size={11} /> Open
                        </button>
                    )}
                    <button type="button" onClick={copyPath} className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-[#1a1a1a] border border-[#333] text-gray-400 rounded hover:text-white hover:border-[#555] transition-colors">
                        <Copy size={11} /> {copied ? 'Copied!' : 'Copy Path'}
                    </button>
                    {!isMulti && (
                        <>
                            <button type="button" onClick={showInExplorer} className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-[#1a1a1a] border border-[#333] text-gray-400 rounded hover:text-white hover:border-[#555] transition-colors">
                                <FolderOpen size={11} /> Reveal
                            </button>
                            <button type="button" onClick={showNativeProperties} className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-[#1a1a1a] border border-[#333] text-gray-400 rounded hover:text-white hover:border-[#555] transition-colors">
                                <Settings size={11} /> Windows Props
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Tab strip */}
            <div className="shrink-0 flex border-b border-[#222] bg-[#111]">
                {tabs.filter(t => t.show).map(t => (
                    <button
                        key={t.id}
                        type="button"
                        onClick={() => setActiveTab(t.id)}
                        className={`px-4 py-2 text-[10px] font-bold uppercase tracking-wider border-r border-[#222] transition-colors ${
                            activeTab === t.id ? 'bg-[#1a1a1a] text-sky-400 border-b-2 border-b-sky-500' : 'text-gray-500 hover:text-gray-300'
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            <div className="flex-1 overflow-y-auto bndz-scrollbar p-5 min-h-0">
                {error && (
                    <div className="mb-4 flex items-center gap-2 text-amber-400 text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                        <AlertCircle size={14} /> {error}
                    </div>
                )}

                {activeTab === 'general' && (
                    <div className="flex flex-col gap-4 max-w-2xl">
                        {isMulti ? (
                            <div className="bg-[#141414] border border-[#222] rounded-xl p-5">
                                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-4">
                                    <Layers size={13} className="text-purple-400" /> Bulk Selection Summary
                                </div>
                                <div className="grid grid-cols-[120px_1fr] gap-y-2 text-[12px]">
                                    <div className="text-gray-500">Items</div>
                                    <div className="text-white font-mono">{selectionCount}</div>
                                    <div className="text-gray-500">Primary</div>
                                    <div className="text-gray-300 font-mono text-[11px] break-all">{targetPath}</div>
                                </div>
                                <div className="mt-4 max-h-[160px] overflow-y-auto bndz-scrollbar border border-[#222] rounded-lg bg-[#0a0a0a]">
                                    {selectedItems.map((p, i) => (
                                        <div key={i} className="px-3 py-1.5 text-[10px] font-mono text-gray-400 border-b border-[#1a1a1a] last:border-0 truncate">{p}</div>
                                    ))}
                                </div>
                                <p className="text-[10px] text-gray-600 mt-3">Use the context menu for bulk copy, move, delete, or compress operations.</p>
                            </div>
                        ) : driveInfo ? (
                            <div className="bg-[#141414] border border-[#222] rounded-xl p-5 grid grid-cols-[120px_1fr] gap-y-3 text-[12px]">
                                <div className="text-gray-500 uppercase text-[10px] font-bold">Location</div>
                                <div className="text-gray-300 font-mono text-[11px] break-all bg-[#0a0a0a] border border-[#222] px-2 py-1 rounded">{targetPath}</div>
                                <div className="text-gray-500 uppercase text-[10px] font-bold">Capacity</div>
                                <div className="text-white font-mono">{formatSize(driveInfo.totalSpace)}</div>
                                <div className="text-gray-500 uppercase text-[10px] font-bold">Free Space</div>
                                <div className="text-emerald-400 font-mono">{formatSize(driveInfo.freeSpace)}</div>
                                <div className="text-gray-500 uppercase text-[10px] font-bold">Used</div>
                                <div className="text-sky-400 font-mono">{formatSize(driveInfo.totalSpace - driveInfo.freeSpace)}</div>
                                <div className="text-gray-500 uppercase text-[10px] font-bold">Format</div>
                                <div className="text-gray-300">{driveInfo.format || 'NTFS'}</div>
                            </div>
                        ) : (
                            <div className="bg-[#141414] border border-[#222] rounded-xl p-5 grid grid-cols-[120px_1fr] gap-y-3 text-[12px]">
                                <div className="text-gray-500 uppercase text-[10px] font-bold">Location</div>
                                <div className="text-gray-300 font-mono text-[11px] break-all bg-[#0a0a0a] border border-[#222] px-2 py-1 rounded">{targetPath}</div>
                                <div className="text-gray-500 uppercase text-[10px] font-bold">Size</div>
                                <div className="text-sky-400 font-mono">
                                    {fileDetails ? formatSize(fileDetails.exactSize) : '--'}
                                    {fileDetails?.exactSize != null && (
                                        <span className="text-gray-600 ml-2">({fileDetails.exactSize.toLocaleString()} bytes)</span>
                                    )}
                                </div>
                                <div className="text-gray-500 uppercase text-[10px] font-bold">Created</div>
                                <div className="text-gray-300 font-mono text-[11px]">
                                    {fileDetails?.creation ? new Date(fileDetails.creation).toLocaleString() : '--'}
                                </div>
                                <div className="text-gray-500 uppercase text-[10px] font-bold">Modified</div>
                                <div className="text-gray-300 font-mono text-[11px]">
                                    {fileDetails?.modification ? new Date(fileDetails.modification).toLocaleString() : '--'}
                                </div>
                                {fileDetails?.accessed && (
                                    <>
                                        <div className="text-gray-500 uppercase text-[10px] font-bold">Accessed</div>
                                        <div className="text-gray-300 font-mono text-[11px]">{new Date(fileDetails.accessed).toLocaleString()}</div>
                                    </>
                                )}
                                <div className="text-gray-500 uppercase text-[10px] font-bold">Owner</div>
                                <div className="text-gray-300 font-mono text-[11px] break-all">{fileDetails?.owner || 'Loading...'}</div>
                            </div>
                        )}

                        {!isMulti && !driveInfo && targetPath && (
                            <div className="bg-[#141414] border border-[#222] rounded-xl p-5">
                                <div className="flex items-center justify-between gap-2 mb-4">
                                    <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-gray-500">
                                        <Tag size={13} className="text-violet-400" /> BNDZ Tags
                                    </div>
                                    <button
                                        type="button"
                                        disabled={!sidecarDirty || sidecarSaving}
                                        onClick={() => void saveSidecarMeta()}
                                        className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded border transition-colors ${
                                            sidecarDirty
                                                ? 'bg-violet-600/20 border-violet-500/40 text-violet-300 hover:bg-violet-600/30'
                                                : 'bg-[#1a1a1a] border-[#333] text-gray-600 cursor-not-allowed'
                                        }`}
                                    >
                                        {sidecarSaving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                                        Save
                                    </button>
                                </div>
                                <div className="grid grid-cols-[100px_1fr] gap-y-3 text-[12px] items-start">
                                    <div className="text-gray-500 pt-1">Label</div>
                                    <input
                                        type="text"
                                        value={sidecarLabel}
                                        onChange={e => { setSidecarLabel(e.target.value); setSidecarDirty(true); }}
                                        placeholder="Custom label for this item"
                                        className="bg-[#0a0a0a] border border-[#333] rounded px-2 py-1.5 text-gray-200 text-[11px] outline-none focus:border-violet-500/50 w-full"
                                    />
                                    <div className="text-gray-500 pt-1">Comment</div>
                                    <textarea
                                        value={sidecarComment}
                                        onChange={e => { setSidecarComment(e.target.value); setSidecarDirty(true); }}
                                        placeholder="Notes or description"
                                        rows={3}
                                        className="bg-[#0a0a0a] border border-[#333] rounded px-2 py-1.5 text-gray-200 text-[11px] outline-none focus:border-violet-500/50 w-full resize-y min-h-[60px]"
                                    />
                                    <div className="text-gray-500 pt-1">Tags</div>
                                    <div className="flex flex-col gap-2">
                                        <div className="flex flex-wrap gap-1.5 min-h-[24px]">
                                            {sidecarTags.length > 0 ? sidecarTags.map(t => (
                                                <button
                                                    key={t}
                                                    type="button"
                                                    onClick={() => removeTagChip(t)}
                                                    className="group bg-violet-500/10 text-[10px] px-2 py-0.5 rounded border border-violet-500/30 text-violet-200 uppercase tracking-wide hover:bg-red-500/10 hover:border-red-500/40 hover:text-red-300 transition-colors"
                                                    title="Remove tag"
                                                >
                                                    {t} <span className="opacity-0 group-hover:opacity-100">×</span>
                                                </button>
                                            )) : (
                                                <span className="text-[11px] text-gray-600 italic">No tags yet</span>
                                            )}
                                        </div>
                                        <div className="flex gap-1.5">
                                            <input
                                                type="text"
                                                value={tagDraft}
                                                onChange={e => setTagDraft(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTagChip(); } }}
                                                placeholder="Add tag…"
                                                className="flex-1 bg-[#0a0a0a] border border-[#333] rounded px-2 py-1 text-gray-200 text-[11px] outline-none focus:border-violet-500/50"
                                            />
                                            <button
                                                type="button"
                                                onClick={addTagChip}
                                                className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded border border-[#444] text-gray-400 hover:text-violet-300 hover:border-violet-500/40"
                                            >
                                                Add
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'security' && !isMulti && (
                    <div className="flex flex-col gap-5 max-w-xl">
                        <div className="bg-[#141414] border border-[#222] rounded-xl p-5">
                            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-4">
                                <Shield size={13} className="text-pink-400" /> Access Control
                            </div>
                            <p className="text-[11px] text-gray-500 mb-3">Effective permissions preview. Full ACL editing uses Windows Security.</p>
                            {aclNotice && (
                                <p className="text-[11px] text-amber-400/90 mb-3">{aclNotice}</p>
                            )}
                            <div className="grid grid-cols-3 gap-2 mb-4">
                                {(['read', 'write', 'execute'] as const).map(type => (
                                    <button
                                        key={type}
                                        type="button"
                                        onClick={() => void toggleAcl(type)}
                                        className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-colors ${
                                            fileDetails?.acl?.[type]
                                                ? 'bg-pink-500/10 border-pink-500 text-pink-400'
                                                : 'bg-[#111] border-[#333] text-gray-400 hover:border-pink-500/30'
                                        }`}
                                    >
                                        <Check className={fileDetails?.acl?.[type] ? 'opacity-100' : 'opacity-0'} size={16} />
                                        <span className="text-[11px] font-bold uppercase">{type}</span>
                                    </button>
                                ))}
                            </div>
                            {Array.isArray(fileDetails?.aclRules) && fileDetails.aclRules.length > 0 && (
                                <div className="rounded-lg border border-[#222] bg-[#0a0a0a] p-3 max-h-40 overflow-y-auto">
                                    <div className="text-[10px] uppercase font-bold tracking-wider text-gray-500 mb-2">NTFS rules</div>
                                    <ul className="space-y-1">
                                        {fileDetails.aclRules.map((rule: string, i: number) => (
                                            <li key={i} className="text-[10px] font-mono text-gray-400 break-all leading-relaxed">{rule}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                        <div className="bg-[#141414] border border-[#222] rounded-xl p-5">
                            <div className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-4">NTFS Attributes</div>
                            <div className="grid grid-cols-2 gap-3">
                                {['Archive', 'Hidden', 'System', 'ReadOnly'].map(attr => (
                                    <button
                                        key={attr}
                                        type="button"
                                        onClick={() => toggleAttribute(attr)}
                                        className="flex items-center gap-3 p-2.5 rounded border border-[#222] bg-[#0a0a0a] hover:bg-[#1a1a1a] transition-all group"
                                    >
                                        <div className={`w-[14px] h-[14px] rounded border flex items-center justify-center ${
                                            fileDetails?.attributes?.[attr] ? 'bg-sky-500 border-sky-500' : 'border-[#444] group-hover:border-sky-500/50'
                                        }`}>
                                            {fileDetails?.attributes?.[attr] && <Check size={10} className="text-black" />}
                                        </div>
                                        <span className="text-[12px] font-mono text-gray-300">{attr}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'hashes' && !isMulti && entity?.type === 'file' && (
                    <div className="bg-[#141414] border border-[#222] rounded-xl p-5 max-w-xl relative">
                        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-4">
                            <Key size={13} className="text-emerald-400" /> Cryptographic Hashes
                        </div>
                        {hash.loading && (
                            <div className="absolute inset-0 z-10 bg-black/60 backdrop-blur-sm flex flex-col gap-3 items-center justify-center rounded-xl">
                                <Loader2 size={24} className="animate-spin text-emerald-500" />
                                <div className="text-[10px] uppercase font-bold tracking-widest text-emerald-400">Computing...</div>
                            </div>
                        )}
                        <div className="flex flex-col gap-4">
                            {['md5', 'sha256'].map(kind => (
                                <div key={kind} className="flex flex-col gap-1.5">
                                    <div className="flex items-center justify-between">
                                        <div className="text-[10px] uppercase font-bold tracking-wider text-gray-500">{kind.toUpperCase()}</div>
                                        <button
                                            type="button"
                                            disabled={!(hash as any)[kind] || (hash as any)[kind] === 'Pending...'}
                                            onClick={() => void copyHash(kind as 'md5' | 'sha256')}
                                            className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-emerald-500/80 hover:text-emerald-400 disabled:opacity-30"
                                        >
                                            <Copy size={11} />
                                            {hashCopied === kind ? 'Copied' : 'Copy'}
                                        </button>
                                    </div>
                                    <input
                                        readOnly
                                        className="w-full bg-[#0a0a0a] border border-[#222] rounded-md px-3 py-2 text-[11px] text-gray-300 font-mono selection:bg-emerald-500/30"
                                        value={(hash as any)[kind] || 'Pending...'}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
        </PluginPanelShell>
    );
}
