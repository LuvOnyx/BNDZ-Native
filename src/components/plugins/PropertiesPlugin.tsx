import React, { useMemo, useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import PluginPanelShell from './PluginPanelShell';
import {
  PluginToolbarButton,
  PluginTabStrip,
  PluginTab,
  PluginSectionTitle,
  PluginCard,
  PluginFieldGrid,
  PluginFieldRow,
  PluginEmptyState,
  PluginIdentityHeader,
} from './PluginPanelPrimitives';
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

    const openWindowsSecurity = () => {
        if (!targetPath) return;
        runIpc(IPC => IPC.shellExecute('properties', targetPath));
    };

    const toggleAttribute = (attr: string) => {
        if (!fileDetails || !targetPath) return;
        const newAttributes = { ...fileDetails.attributes, [attr]: !fileDetails.attributes[attr] };
        setFileDetails({ ...fileDetails, attributes: newAttributes });
        runIpc(IPC => { if (IPC.isNative) IPC.setFileAttributes(targetPath, newAttributes); });
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
                icon="sys_properties"
                iconColor="#0078d4"
                variant="embedded"
                subtitle="No selection"
            >
                <PluginEmptyState
                    icon="layers_ui"
                    description="Select items to inspect properties, attributes, hashes, and BNDZ tags."
                />
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
            icon="sys_properties"
            iconColor="#0078d4"
            variant="embedded"
            subtitle={displayName}
            toolbar={
                <>
                    {!isMulti && (
                        <PluginToolbarButton icon="folder_open_ui" onClick={openItem}>Open</PluginToolbarButton>
                    )}
                    <PluginToolbarButton icon="copy_path" onClick={copyPath} active={copied}>
                        {copied ? 'Copied' : 'Copy path'}
                    </PluginToolbarButton>
                    {!isMulti && (
                        <>
                            <PluginToolbarButton icon="folder_open_ui" onClick={showInExplorer}>Reveal</PluginToolbarButton>
                            <PluginToolbarButton icon="config" onClick={showNativeProperties}>Windows props</PluginToolbarButton>
                        </>
                    )}
                </>
            }
        >
        <div className="flex-1 w-full flex flex-col overflow-hidden text-slate-300 min-h-0">
            <PluginIdentityHeader
                icon={
                    <PreviewHeroIcon
                        path={heroIconPath}
                        isDir={isDir}
                        isDrive={!!driveInfo}
                        size={48}
                        extension={ext}
                        preferThumbnail={!isDir && !isMulti}
                    />
                }
                name={displayName}
                typeLabel={typeLabel}
                path={!isMulti ? targetPath : undefined}
                meta={isMulti ? <span className="bndz-panel-muted text-xs">{selectionCount} paths</span> : undefined}
            />

            <PluginTabStrip>
                {tabs.filter(t => t.show).map(t => (
                    <PluginTab key={t.id} active={activeTab === t.id} onClick={() => setActiveTab(t.id)}>
                        {t.label}
                    </PluginTab>
                ))}
            </PluginTabStrip>

            <div className="flex-1 overflow-y-auto bndz-scrollbar p-4 min-h-0">
                {error && (
                    <div className="mb-4 flex items-center gap-2 text-amber-400 text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                        <Icons8Icon id="error_ui" size={14} /> {error}
                    </div>
                )}

                {activeTab === 'general' && (
                    <div className="flex flex-col gap-3 max-w-2xl">
                        {isMulti ? (
                            <PluginCard>
                                <PluginSectionTitle icon="layers_ui">Bulk selection</PluginSectionTitle>
                                <PluginFieldGrid>
                                    <PluginFieldRow label="Items">{selectionCount}</PluginFieldRow>
                                    <PluginFieldRow label="Primary" mono>{targetPath}</PluginFieldRow>
                                </PluginFieldGrid>
                                <div className="mt-3 max-h-[140px] overflow-y-auto bndz-scrollbar border border-white/[0.06] rounded-md">
                                    {selectedItems.map((p, i) => (
                                        <div key={i} className="px-3 py-1.5 text-xs bndz-mono bndz-panel-muted border-b border-white/[0.04] last:border-0 truncate">{p}</div>
                                    ))}
                                </div>
                                <p className="bndz-panel-muted mt-3">Use the context menu for bulk copy, move, delete, or compress operations.</p>
                            </PluginCard>
                        ) : driveInfo ? (
                            <PluginCard>
                                <PluginFieldGrid>
                                    <PluginFieldRow label="Location" mono>{targetPath}</PluginFieldRow>
                                    <PluginFieldRow label="Capacity" mono>{formatSize(driveInfo.totalSpace)}</PluginFieldRow>
                                    <PluginFieldRow label="Free space" mono><span className="text-emerald-400">{formatSize(driveInfo.freeSpace)}</span></PluginFieldRow>
                                    <PluginFieldRow label="Used" mono><span className="text-[#7eb8e8]">{formatSize(driveInfo.totalSpace - driveInfo.freeSpace)}</span></PluginFieldRow>
                                    <PluginFieldRow label="Format">{driveInfo.format || 'NTFS'}</PluginFieldRow>
                                </PluginFieldGrid>
                            </PluginCard>
                        ) : (
                            <PluginCard>
                                <PluginFieldGrid>
                                    <PluginFieldRow label="Location" mono>{targetPath}</PluginFieldRow>
                                    <PluginFieldRow label="Size" mono>
                                        {fileDetails ? formatSize(fileDetails.exactSize) : '--'}
                                        {fileDetails?.exactSize != null && (
                                            <span className="bndz-panel-muted ml-2">({fileDetails.exactSize.toLocaleString()} bytes)</span>
                                        )}
                                    </PluginFieldRow>
                                    <PluginFieldRow label="Created" mono>
                                        {fileDetails?.creation ? new Date(fileDetails.creation).toLocaleString() : '--'}
                                    </PluginFieldRow>
                                    <PluginFieldRow label="Modified" mono>
                                        {fileDetails?.modification ? new Date(fileDetails.modification).toLocaleString() : '--'}
                                    </PluginFieldRow>
                                    {fileDetails?.accessed && (
                                        <PluginFieldRow label="Accessed" mono>{new Date(fileDetails.accessed).toLocaleString()}</PluginFieldRow>
                                    )}
                                    <PluginFieldRow label="Owner" mono>{fileDetails?.owner || 'Loading...'}</PluginFieldRow>
                                </PluginFieldGrid>
                            </PluginCard>
                        )}

                        {!isMulti && !driveInfo && targetPath && (
                            <PluginCard>
                                <PluginSectionTitle
                                    icon="tag_manager"
                                    action={
                                        <PluginToolbarButton
                                            icon={sidecarSaving ? 'loading' : 'check'}
                                            onClick={() => void saveSidecarMeta()}
                                            disabled={!sidecarDirty || sidecarSaving}
                                            active={sidecarDirty}
                                        >
                                            Save
                                        </PluginToolbarButton>
                                    }
                                >
                                    BNDZ tags
                                </PluginSectionTitle>
                                <PluginFieldGrid>
                                    <PluginFieldRow label="Label">
                                        <input
                                            type="text"
                                            value={sidecarLabel}
                                            onChange={e => { setSidecarLabel(e.target.value); setSidecarDirty(true); }}
                                            placeholder="Custom label for this item"
                                            className="w-full bg-black/30 border border-white/10 rounded-md px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-violet-500/50"
                                        />
                                    </PluginFieldRow>
                                    <PluginFieldRow label="Comment">
                                        <textarea
                                            value={sidecarComment}
                                            onChange={e => { setSidecarComment(e.target.value); setSidecarDirty(true); }}
                                            placeholder="Notes or description"
                                            rows={3}
                                            className="w-full bg-black/30 border border-white/10 rounded-md px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-violet-500/50 resize-y min-h-[56px]"
                                        />
                                    </PluginFieldRow>
                                    <PluginFieldRow label="Tags">
                                        <div className="flex flex-col gap-2">
                                            <div className="flex flex-wrap gap-1.5 min-h-[24px]">
                                                {sidecarTags.length > 0 ? sidecarTags.map(t => (
                                                    <button
                                                        key={t}
                                                        type="button"
                                                        onClick={() => removeTagChip(t)}
                                                        className="group bg-violet-500/10 text-xs px-2 py-0.5 rounded border border-violet-500/30 text-violet-200 hover:bg-red-500/10 hover:border-red-500/40 hover:text-red-300 transition-colors"
                                                        title="Remove tag"
                                                    >
                                                        {t} <span className="opacity-0 group-hover:opacity-100">×</span>
                                                    </button>
                                                )) : (
                                                    <span className="bndz-panel-muted italic">No tags yet</span>
                                                )}
                                            </div>
                                            <div className="flex gap-1.5">
                                                <input
                                                    type="text"
                                                    value={tagDraft}
                                                    onChange={e => setTagDraft(e.target.value)}
                                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTagChip(); } }}
                                                    placeholder="Add tag…"
                                                    className="flex-1 bg-black/30 border border-white/10 rounded-md px-2 py-1 text-xs text-gray-200 outline-none focus:border-violet-500/50"
                                                />
                                                <PluginToolbarButton onClick={addTagChip}>Add</PluginToolbarButton>
                                            </div>
                                        </div>
                                    </PluginFieldRow>
                                </PluginFieldGrid>
                            </PluginCard>
                        )}
                    </div>
                )}

                {activeTab === 'security' && !isMulti && (
                    <div className="flex flex-col gap-3 max-w-xl">
                        <PluginCard>
                            <PluginSectionTitle
                                icon="shield_ui"
                                action={
                                    <PluginToolbarButton icon="key_ui" onClick={openWindowsSecurity}>
                                        Windows security
                                    </PluginToolbarButton>
                                }
                            >
                                Security
                            </PluginSectionTitle>
                            <p className="text-xs bndz-panel-muted leading-relaxed">
                                NTFS permissions and access control are managed by Windows. Use the button above to open the native Security editor for this item.
                            </p>
                        </PluginCard>
                        <PluginCard>
                            <PluginSectionTitle>NTFS attributes</PluginSectionTitle>
                            <div className="grid grid-cols-2 gap-2">
                                {['Archive', 'Hidden', 'System', 'ReadOnly'].map(attr => (
                                    <button
                                        key={attr}
                                        type="button"
                                        onClick={() => toggleAttribute(attr)}
                                        className="flex items-center gap-2.5 p-2 rounded-md border border-white/[0.06] bg-black/20 hover:bg-white/[0.04] transition-colors group text-left"
                                    >
                                        <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                                            fileDetails?.attributes?.[attr] ? 'bg-[#0078d4] border-[#0078d4]' : 'border-white/20 group-hover:border-[#0078d4]/45'
                                        }`}>
                                            {fileDetails?.attributes?.[attr] && <Icons8Icon id="check" size={9} className="text-black" />}
                                        </div>
                                        <span className="text-xs text-gray-300">{attr}</span>
                                    </button>
                                ))}
                            </div>
                        </PluginCard>
                    </div>
                )}

                {activeTab === 'hashes' && !isMulti && entity?.type === 'file' && (
                    <PluginCard className="max-w-xl relative">
                        <PluginSectionTitle icon="key_ui">Cryptographic hashes</PluginSectionTitle>
                        {hash.loading && (
                            <div className="absolute inset-0 z-10 bg-black/50  flex flex-col gap-2 items-center justify-center rounded-md">
                                <Icons8Icon id="loading" size={22} spin className="text-emerald-500" />
                                <div className="text-xs text-emerald-400 font-medium">Computing…</div>
                            </div>
                        )}
                        <div className="flex flex-col gap-3">
                            {['md5', 'sha256'].map(kind => (
                                <div key={kind} className="flex flex-col gap-1">
                                    <div className="flex items-center justify-between">
                                        <div className="bndz-plugin-section-title">{kind.toUpperCase()}</div>
                                        <PluginToolbarButton
                                            icon="copy"
                                            disabled={!(hash as any)[kind] || (hash as any)[kind] === 'Pending...'}
                                            onClick={() => void copyHash(kind as 'md5' | 'sha256')}
                                        >
                                            {hashCopied === kind ? 'Copied' : 'Copy'}
                                        </PluginToolbarButton>
                                    </div>
                                    <input
                                        readOnly
                                        className="w-full bg-black/30 border border-white/10 rounded-md px-3 py-2 text-xs text-gray-300 bndz-mono"
                                        value={(hash as any)[kind] || 'Pending...'}
                                    />
                                </div>
                            ))}
                        </div>
                    </PluginCard>
                )}
            </div>
        </div>
        </PluginPanelShell>
    );
}
