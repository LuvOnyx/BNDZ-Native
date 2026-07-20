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
  PluginHeroStrip,
  PluginHeroActionButton,
  PLUGIN_INPUT_CLASS,
} from './PluginPanelPrimitives';
import { FSEntity } from '../../types';
import { normalizePanePath, isRecycleBinPath } from '../../lib/pathUtils';
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
                title="System Properties"
                icon="sys_properties"
                iconColor="#38bdf8"
                variant="embedded"
                subtitle="No selection"
            >
                <PluginEmptyState
                    icon="sys_properties"
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
            title="System Properties"
            icon="sys_properties"
            iconColor="#38bdf8"
            variant="embedded"
            subtitle={displayName}
        >
        <div className="flex-1 w-full flex flex-col overflow-hidden text-slate-300 min-h-0">
            <PluginHeroStrip
                icon={
                    <PreviewHeroIcon
                        path={heroIconPath}
                        isDir={isDir}
                        isDrive={!!driveInfo}
                        size={80}
                        extension={ext}
                        preferThumbnail={!isDir && !isMulti}
                    />
                }
                name={displayName}
                typeLabel={typeLabel}
                path={!isMulti ? targetPath : undefined}
                meta={isMulti ? <span className="bndz-panel-muted text-xs">{selectionCount} paths</span> : undefined}
                actions={!isMulti ? (
                    <>
                        <PluginHeroActionButton icon="folder_open_ui" variant="primary" onClick={openItem}>Open</PluginHeroActionButton>
                        <PluginHeroActionButton icon="copy" onClick={copyPath} active={copied}>
                            {copied ? 'Copied!' : 'Copy path'}
                        </PluginHeroActionButton>
                        <PluginHeroActionButton icon="folder_open_ui" onClick={showInExplorer}>Reveal</PluginHeroActionButton>
                        <PluginHeroActionButton icon="sys_properties" onClick={showNativeProperties}>Windows props</PluginHeroActionButton>
                    </>
                ) : (
                    <PluginHeroActionButton icon="copy" onClick={copyPath} active={copied}>
                        {copied ? 'Copied!' : 'Copy path'}
                    </PluginHeroActionButton>
                )}
            />

            <PluginTabStrip>
                {tabs.filter(t => t.show).map(t => (
                    <PluginTab key={t.id} active={activeTab === t.id} onClick={() => setActiveTab(t.id)}>
                        {t.label}
                    </PluginTab>
                ))}
            </PluginTabStrip>

            <div className="flex-1 overflow-y-auto bndz-scrollbar p-5 min-h-0">
                {error && (
                    <div className="mb-4 flex items-center gap-2 text-amber-400 text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                        <Icons8Icon id="error_ui" size={14} /> {error}
                    </div>
                )}

                {activeTab === 'general' && (
                    <div className="flex flex-col gap-4 max-w-2xl">
                        {isMulti ? (
                            <PluginCard>
                                <PluginSectionTitle icon="layers_ui">Bulk selection</PluginSectionTitle>
                                <PluginFieldGrid>
                                    <PluginFieldRow label="Items">{selectionCount}</PluginFieldRow>
                                    <PluginFieldRow label="Primary" mono>{targetPath}</PluginFieldRow>
                                </PluginFieldGrid>
                                <div className="mt-3 max-h-[160px] overflow-y-auto bndz-scrollbar border border-white/[0.08] rounded-lg">
                                    {selectedItems.map((p, i) => (
                                        <div key={i} className="px-3 py-1.5 text-xs bndz-mono bndz-panel-muted border-b border-white/[0.04] last:border-0 truncate">{p}</div>
                                    ))}
                                </div>
                                <p className="bndz-panel-muted mt-3 text-xs leading-relaxed">Use the context menu for bulk copy, move, delete, or compress operations.</p>
                            </PluginCard>
                        ) : driveInfo ? (
                            <PluginCard>
                                <PluginFieldGrid>
                                    <PluginFieldRow label="Location" mono>{targetPath}</PluginFieldRow>
                                    <PluginFieldRow label="Capacity" mono>{formatSize(driveInfo.totalSpace)}</PluginFieldRow>
                                    <PluginFieldRow label="Free space" mono><span className="text-emerald-400">{formatSize(driveInfo.freeSpace)}</span></PluginFieldRow>
                                    <PluginFieldRow label="Used" mono><span className="text-sky-300">{formatSize(driveInfo.totalSpace - driveInfo.freeSpace)}</span></PluginFieldRow>
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
                                            className={PLUGIN_INPUT_CLASS}
                                        />
                                    </PluginFieldRow>
                                    <PluginFieldRow label="Comment">
                                        <textarea
                                            value={sidecarComment}
                                            onChange={e => { setSidecarComment(e.target.value); setSidecarDirty(true); }}
                                            placeholder="Notes or description"
                                            rows={3}
                                            className={`${PLUGIN_INPUT_CLASS} resize-y min-h-[56px]`}
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
                                                        className="group bg-violet-500/10 text-xs px-2 py-0.5 rounded-md border border-violet-500/30 text-violet-200 hover:bg-red-500/10 hover:border-red-500/40 hover:text-red-300 transition-colors"
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
                                                    className={`flex-1 ${PLUGIN_INPUT_CLASS}`}
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
                    <div className="flex flex-col gap-4 max-w-xl">
                        <PluginCard>
                            <PluginSectionTitle
                                icon="shield_ui"
                                action={
                                    <PluginToolbarButton icon="key_ui" onClick={openWindowsSecurity}>
                                        Windows security
                                    </PluginToolbarButton>
                                }
                            >
                                Access control
                            </PluginSectionTitle>
                            <p className="text-xs bndz-panel-muted leading-relaxed mb-3">
                                Viewing effective permissions (read-only). To change ACLs, open Windows Security.
                            </p>
                            <div className="flex flex-wrap gap-2 mb-4">
                                {([
                                    { key: 'read' as const, label: 'Read' },
                                    { key: 'write' as const, label: 'Write' },
                                    { key: 'execute' as const, label: 'Execute' },
                                ]).map(({ key, label }) => {
                                    const granted = !!fileDetails?.acl?.[key];
                                    return (
                                        <span
                                            key={key}
                                            className={`bndz-plugin-kind-pill inline-flex items-center gap-1.5 ${
                                                granted
                                                    ? 'bg-emerald-500/15 border-emerald-400/35 text-emerald-300'
                                                    : 'bg-black/25 border-white/[0.08] text-slate-500'
                                            }`}
                                            title={granted ? `${label} granted` : `${label} not indicated`}
                                        >
                                            <Icons8Icon id={granted ? 'check' : 'close'} size={11} />
                                            {label}
                                        </span>
                                    );
                                })}
                            </div>
                            {Array.isArray(fileDetails?.aclRules) && fileDetails.aclRules.length > 0 ? (
                                <div className="rounded-lg border border-white/[0.08] bg-black/25 p-3 max-h-44 overflow-y-auto bndz-scrollbar">
                                    <div className="bndz-plugin-section-title mb-2">Effective NTFS ACL rules</div>
                                    <ul className="space-y-1">
                                        {fileDetails.aclRules.map((rule: string, i: number) => (
                                            <li key={i} className="text-[10px] bndz-mono text-slate-400 break-all leading-relaxed">{rule}</li>
                                        ))}
                                    </ul>
                                </div>
                            ) : (
                                <PluginEmptyState
                                    icon="shield_ui"
                                    title="No ACL rules listed"
                                    description="Effective rule details were not returned for this item. Use Windows Security to inspect or edit permissions."
                                />
                            )}
                        </PluginCard>
                        <PluginCard>
                            <PluginSectionTitle>NTFS attributes</PluginSectionTitle>
                            <div className="grid grid-cols-2 gap-2">
                                {['Archive', 'Hidden', 'System', 'ReadOnly'].map(attr => (
                                    <button
                                        key={attr}
                                        type="button"
                                        onClick={() => toggleAttribute(attr)}
                                        className="flex items-center gap-2.5 p-2.5 rounded-lg border border-white/[0.08] bg-black/20 hover:bg-white/[0.04] transition-colors group text-left"
                                    >
                                        <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                                            fileDetails?.attributes?.[attr] ? 'bg-sky-500 border-sky-500' : 'border-white/20 group-hover:border-sky-400/45'
                                        }`}>
                                            {fileDetails?.attributes?.[attr] && <Icons8Icon id="check" size={9} />}
                                        </div>
                                        <span className="text-xs text-slate-300">{attr}</span>
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
                            <div className="absolute inset-0 z-10 bg-black/50 backdrop-blur-sm flex flex-col gap-2 items-center justify-center rounded-lg">
                                <Icons8Icon id="loading" size={24} spin className="text-emerald-400" />
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
                                        className={`w-full ${PLUGIN_INPUT_CLASS} bndz-mono py-2`}
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
