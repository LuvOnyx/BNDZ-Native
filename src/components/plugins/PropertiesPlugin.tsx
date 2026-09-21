import React, { useMemo, useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { StorageUsageBar } from '../StorageUsageBar';
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
import { formatPropertiesPath, formatUiPath } from '../../lib/displayPath';
import { getPaneTabLabel } from '../../lib/paneLabels';
import { getLocationIconPath } from '../../lib/virtualLocations';
import { resolveShellPropertiesPath, toPanePath } from '../../lib/shellPaths';
import { isBndzHomePath, isBndzVirtualPath } from '../../lib/bndzVirtualViews';
import { PreviewHeroIcon } from '../PreviewHeroIcon';
import { isAudioExt, isVideoExt, isImageExt } from '../../lib/mediaTypes';
import { dispatchOpenPhotoStudio } from '../preview/BndzPhotoStudio';

type PropTab = 'general' | 'customize' | 'security' | 'hashes';

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
    const [folderByteSize, setFolderByteSize] = useState<number | null>(null);
    const [folderSizeLoading, setFolderSizeLoading] = useState(false);
    const [detailsOpen, setDetailsOpen] = useState(true);
    const [attrsOpen, setAttrsOpen] = useState(false);
    const [iconBusy, setIconBusy] = useState(false);
    const [iconStatus, setIconStatus] = useState<string | null>(null);

    const selectionCount = selectedItems.length;
    const isMulti = selectionCount > 1;

    const targetPath = useMemo(() => {
        if (selectedItems.length > 0) return formatPropertiesPath(selectedItems[0]);
        if (primarySelectedPath) return formatPropertiesPath(primarySelectedPath);
        if (entity?.path) return formatPropertiesPath(entity.path);
        return formatPropertiesPath(focusedPath);
    }, [primarySelectedPath, selectedItems, entity?.path, focusedPath]);

    const displayName = useMemo(() => {
        if (isMulti) return `${selectionCount} items selected`;
        if (selectedItems.length === 1) {
            const leaf = selectedItems[0].split(/[/\\]/).filter(Boolean).pop();
            if (leaf) return leaf;
        }
        if ((entity as any)?.isVirtual && entity?.name) return entity.name;
        if (entity?.name && !entity.name.toLowerCase().startsWith('shell:')) return entity.name;
        const pane = normalizePanePath(focusedPath || entity?.path || '');
        if (pane) return getPaneTabLabel(pane);
        return targetPath.split(/[/\\]/).pop() || 'Selection';
    }, [isMulti, selectionCount, entity?.name, entity?.path, focusedPath, targetPath, selectedItems]);

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

        Promise.all([
          import('../../lib/ipcBridge'),
          import('../../lib/extendedMetadataCache'),
        ]).then(([{ IPC }, { getExtendedMetadataCached }]) => {
            if (!shouldUpdate) return;

            if (IPC.isNative) {
                void getExtendedMetadataCached(targetPath, { priority: 950 }).then(entry => {
                    const details = entry.meta || {};
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

    // Settings -> Show folder size on Properties tab
    useEffect(() => {
        if (!config?.showFolderSizeOnPropertiesTab || !isDir || !targetPath || isMulti || isDriveEntity) {
            setFolderByteSize(null);
            setFolderSizeLoading(false);
            return;
        }
        let active = true;
        setFolderSizeLoading(true);
        setFolderByteSize(null);
        const winPath = targetPath.replace(/\//g, '\\');
        import('../../lib/ipcBridge').then(({ IPC }) => {
            IPC.scanFolderSizes([winPath]).then(result => {
                if (!active) return;
                const sizes = result.sizes || {};
                const hit =
                    sizes[winPath]
                    ?? sizes[winPath.toLowerCase()]
                    ?? sizes[targetPath]
                    ?? Object.entries(sizes).find(([k]) => k.replace(/\//g, '\\').toLowerCase() === winPath.toLowerCase())?.[1];
                setFolderByteSize(typeof hit === 'number' && hit >= 0 ? hit : null);
                setFolderSizeLoading(false);
            }).catch(() => {
                if (active) {
                    setFolderByteSize(null);
                    setFolderSizeLoading(false);
                }
            });
        });
        return () => { active = false; };
    }, [config?.showFolderSizeOnPropertiesTab, isDir, targetPath, isMulti, isDriveEntity]);

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
        const probe = primarySelectedPath || entity?.path || focusedPath || targetPath;
        const pane = toPanePath(probe);
        // Folders / Continuum / smart views: stay inside BNDZ.
        if (
            isDir
            || (entity as any)?.isVirtual
            || isBndzHomePath(pane)
            || isBndzVirtualPath(pane)
        ) {
            window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path: pane } }));
            return;
        }
        // Files: open BNDZ Quick Preview overlay.
        window.dispatchEvent(new CustomEvent('bndz-open-in-bndz', {
            detail: { path: pane, isDirectory: false },
        }));
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

    const openPhotoStudio = () => {
        if (!targetPath || isDir || isMulti) return;
        dispatchOpenPhotoStudio(targetPath);
    };

    const canOpenStudio = !isMulti && !isDir && !driveInfo && isImageExt(ext);

    const canCustomizeIcon = !isMulti && !driveInfo && !!(
        isDir || /\.lnk$/i.test(targetPath || '') || /\.lnk$/i.test(entity?.path || '')
    );

    const applyCustomIcon = (mode: 'pick' | 'restore') => {
        if (!targetPath || !canCustomizeIcon) return;
        setIconBusy(true);
        setIconStatus(null);
        runIpc(async (IPC) => {
            try {
                const { toWindowsPath } = await import('../../lib/pathUtils');
                const { prepareIconForApply } = await import('../../lib/iconPathUtils');
                const winPath = toWindowsPath(targetPath);
                const targetType = /\.lnk$/i.test(winPath) ? 'shortcut' : isDir ? 'folder' : 'file';
                if (mode === 'restore') {
                    const result = await IPC.setSystemIcon(winPath, targetType, '', !!config?.allowGlobalIconOverwrite);
                    await IPC.clearIconCache();
                    setIconStatus(result.success ? 'Default icon restored' : (result.error || 'Restore failed'));
                    return;
                }
                const picked = await IPC.openFileDialog(
                    'Icons (*.ico;*.png)|*.ico;*.png|Icon files (*.ico)|*.ico|All files (*.*)|*.*',
                );
                const rawIcon = Array.isArray(picked) ? picked[0] : '';
                if (!rawIcon) {
                    setIconStatus(null);
                    return;
                }
                const icoPath = await prepareIconForApply(rawIcon);
                if (!icoPath) {
                    setIconStatus('Could not prepare that icon file');
                    return;
                }
                const result = await IPC.setSystemIcon(winPath, targetType, icoPath, !!config?.allowGlobalIconOverwrite);
                await IPC.clearIconCache();
                setIconStatus(result.success ? 'Custom icon applied' : (result.error || 'Apply failed'));
                if (result.success) {
                    window.dispatchEvent(new CustomEvent('bndz-refresh-icons', { detail: { path: winPath } }));
                }
            } catch (err: any) {
                setIconStatus(err?.message || 'Icon change failed');
            } finally {
                setIconBusy(false);
            }
        });
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
        const { writeClipboardText } = await import('../../lib/clipboardSafe');
        const ok = await writeClipboardText(value);
        if (!ok) runIpc(IPC => IPC.shellExecute('copyPath', value));
        setHashCopied(kind);
        setTimeout(() => setHashCopied(null), 1500);
    };

    const heroIconPath = useMemo(() => {
        if (isMulti) return null;
        const probe = focusedPath || entity?.path || '';
        if (
            (entity as any)?.isVirtual
            || isRecycleBinPath(focusedPath)
            || isRecycleBinPath(entity?.path)
            || isBndzHomePath(probe)
            || isBndzVirtualPath(probe)
        ) {
            return getLocationIconPath(probe);
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
                    tone="idle"
                    title="Nothing selected"
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
        { id: 'customize', label: 'Customize', show: canCustomizeIcon },
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
        <div className="flex-1 w-full flex flex-col overflow-hidden min-h-0">
            <PluginHeroStrip
                icon={
                    config?.showEmbeddedIconsOnPropertiesTab !== false ? (
                    <PreviewHeroIcon
                        path={heroIconPath}
                        isDir={isDir}
                        isDrive={!!driveInfo}
                        size={80}
                        extension={ext}
                        preferThumbnail={!isDir && !isMulti}
                    />
                    ) : (
                    <PreviewHeroIcon
                        path={heroIconPath}
                        isDir={isDir}
                        isDrive={!!driveInfo}
                        size={80}
                        extension={ext}
                        preferThumbnail={false}
                    />
                    )
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
                        {canOpenStudio && (
                            <PluginHeroActionButton icon="picture_ui" onClick={openPhotoStudio}>
                                Studio
                            </PluginHeroActionButton>
                        )}
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
                    <div className="flex flex-col gap-3 max-w-2xl bndz-props-files">
                        {isMulti ? (
                            <PluginCard className="bndz-props-overview">
                                <PluginSectionTitle icon="layers_ui">Bulk selection</PluginSectionTitle>
                                <PluginFieldGrid>
                                    <PluginFieldRow label="Items">{selectionCount}</PluginFieldRow>
                                    <PluginFieldRow label="Primary" mono>{targetPath}</PluginFieldRow>
                                </PluginFieldGrid>
                                <div className="mt-3 max-h-[160px] overflow-y-auto bndz-scrollbar border border-white/[0.08] rounded-xl">
                                    {selectedItems.map((p, i) => (
                                        <div key={i} className="px-3 py-1.5 text-xs bndz-mono bndz-panel-muted border-b border-white/[0.04] last:border-0 truncate">{formatUiPath(p)}</div>
                                    ))}
                                </div>
                                <p className="bndz-panel-muted mt-3 text-xs leading-relaxed">Use the context menu for bulk copy, move, delete, or compress operations.</p>
                            </PluginCard>
                        ) : (
                            <>
                                <PluginCard className="bndz-props-overview">
                                    <div className="bndz-props-overview-row">
                                        <div className="bndz-props-icon-tile">
                                            {config?.showEmbeddedIconsOnPropertiesTab !== false ? (
                                                <PreviewHeroIcon
                                                    path={heroIconPath}
                                                    isDir={isDir}
                                                    isDrive={!!driveInfo}
                                                    size={56}
                                                    extension={ext}
                                                    preferThumbnail={!isDir && !isMulti}
                                                />
                                            ) : (
                                                <PreviewHeroIcon
                                                    path={heroIconPath}
                                                    isDir={isDir}
                                                    isDrive={!!driveInfo}
                                                    size={56}
                                                    extension={ext}
                                                    preferThumbnail={false}
                                                />
                                            )}
                                        </div>
                                        <div className="bndz-props-overview-meta min-w-0 flex-1">
                                            <div className="bndz-props-overview-name truncate" title={displayName}>{displayName}</div>
                                            <div className="bndz-props-overview-type">{typeLabel}</div>
                                            {canCustomizeIcon && (
                                                <button
                                                    type="button"
                                                    className="bndz-props-linkbtn"
                                                    onClick={() => setActiveTab('customize')}
                                                >
                                                    Change icon...
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </PluginCard>

                                {driveInfo && (
                                    <PluginCard className="bndz-props-disk">
                                        <PluginSectionTitle icon="hdd">Disk details</PluginSectionTitle>
                                        {(() => {
                                            const total = Number(driveInfo.totalSpace) || 0;
                                            const free = Number(driveInfo.freeSpace) || 0;
                                            const used = Math.max(0, total - free);
                                            // Never round a drive with free bytes up to 100% - that made
                                            // 4-6 GB free on large volumes look "full" in the old SVG ring.
                                            const rawPct = total > 0 ? (used / total) * 100 : 0;
                                            const pctDisplay = free > 0
                                              ? Math.min(99.9, Math.floor(rawPct * 10) / 10)
                                              : (total > 0 ? 100 : 0);
                                            const barPct = free > 0 ? Math.min(99.5, rawPct) : (total > 0 ? 100 : 0);
                                            const pctLabel = Number.isInteger(pctDisplay)
                                              ? `${pctDisplay}%`
                                              : `${pctDisplay.toFixed(1)}%`;
                                            const sizeUnavailable = !!(driveInfo as any).sizeUnavailable
                                              || (total <= 0 && free <= 0);
                                            return (
                                                <div className="bndz-props-disk-stack">
                                                    <div className="bndz-props-disk-meter" aria-label={`${pctLabel} used`}>
                                                        <div className="bndz-props-disk-meter-head">
                                                            <span className="bndz-props-disk-meter-free">
                                                              {sizeUnavailable ? 'Calculating...' : `${formatSize(free)} free`}
                                                            </span>
                                                            <span className="bndz-props-disk-meter-used">{pctLabel} used</span>
                                                        </div>
                                                        {!sizeUnavailable && (
                                                          <StorageUsageBar usedPct={barPct} height={8} className="w-full" />
                                                        )}
                                                        <div className="bndz-props-disk-meter-foot">
                                                          <span>{formatSize(used)} used</span>
                                                          <span>{formatSize(total)} capacity</span>
                                                        </div>
                                                    </div>
                                                    <PluginFieldGrid className="flex-1">
                                                        <PluginFieldRow label="Location" mono>{targetPath}</PluginFieldRow>
                                                        <PluginFieldRow label="Capacity" mono>{sizeUnavailable ? '-' : formatSize(total)}</PluginFieldRow>
                                                        <PluginFieldRow label="Used" mono><span className="text-sky-300">{sizeUnavailable ? '-' : formatSize(used)}</span></PluginFieldRow>
                                                        <PluginFieldRow label="Free" mono><span className="text-emerald-400">{sizeUnavailable ? '-' : formatSize(free)}</span></PluginFieldRow>
                                                        <PluginFieldRow label="Format">{(driveInfo as any).fileSystem || driveInfo.format || 'NTFS'}</PluginFieldRow>
                                                    </PluginFieldGrid>
                                                </div>
                                            );
                                        })()}
                                    </PluginCard>
                                )}

                                {!driveInfo && (
                                    <div className={`bndz-props-expander ${detailsOpen ? 'is-open' : ''}`}>
                                        <button
                                            type="button"
                                            className="bndz-props-expander-head"
                                            onClick={() => setDetailsOpen(v => !v)}
                                            aria-expanded={detailsOpen}
                                        >
                                            <span>More details</span>
                                            <Icons8Icon id={detailsOpen ? 'chevron_down' : 'chevron_right'} size={14} />
                                        </button>
                                        {detailsOpen && (
                                            <div className="bndz-props-expander-body">
                                                <PluginFieldGrid>
                                                    <PluginFieldRow label="Location" mono>{targetPath}</PluginFieldRow>
                                                    <PluginFieldRow label="Size" mono>
                                                        {isDir && !config?.showFolderSizeOnPropertiesTab
                                                          ? <span className="bndz-panel-muted">--</span>
                                                          : isDir && folderSizeLoading
                                                            ? <span className="bndz-panel-muted">Calculating...</span>
                                                            : isDir && folderByteSize != null
                                                              ? (
                                                                <>
                                                                  {formatSize(folderByteSize)}
                                                                  <span className="bndz-panel-muted ml-2">({folderByteSize.toLocaleString()} bytes)</span>
                                                                </>
                                                              )
                                                              : (
                                                                <>
                                                                  {fileDetails ? formatSize(fileDetails.exactSize) : '--'}
                                                                  {fileDetails?.exactSize != null && (
                                                                      <span className="bndz-panel-muted ml-2">({fileDetails.exactSize.toLocaleString()} bytes)</span>
                                                                  )}
                                                                </>
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
                                            </div>
                                        )}
                                    </div>
                                )}

                                {!driveInfo && (
                                    <div className={`bndz-props-expander ${attrsOpen ? 'is-open' : ''}`}>
                                        <button
                                            type="button"
                                            className="bndz-props-expander-head"
                                            onClick={() => setAttrsOpen(v => !v)}
                                            aria-expanded={attrsOpen}
                                        >
                                            <span>Attributes</span>
                                            <Icons8Icon id={attrsOpen ? 'chevron_down' : 'chevron_right'} size={14} />
                                        </button>
                                        {attrsOpen && (
                                            <div className="bndz-props-expander-body">
                                                <div className="grid grid-cols-2 gap-2">
                                                    {['Archive', 'Hidden', 'System', 'ReadOnly'].map(attr => (
                                                        <button
                                                            key={attr}
                                                            type="button"
                                                            onClick={() => toggleAttribute(attr)}
                                                            className="flex items-center gap-2.5 p-2.5 rounded-xl border border-white/[0.08] bg-black/20 hover:bg-white/[0.04] transition-colors group text-left"
                                                        >
                                                            <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                                                                fileDetails?.attributes?.[attr] ? 'bg-sky-500 border-sky-500' : 'border-white/20 group-hover:border-sky-400/45'
                                                            }`}>
                                                                {fileDetails?.attributes?.[attr] && <Icons8Icon id="check" size={9} />}
                                                            </div>
                                                            <span className="text-xs text-slate-300">{attr === 'ReadOnly' ? 'Read-only' : attr}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
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
                                                    placeholder="Add tag..."
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

                {activeTab === 'customize' && canCustomizeIcon && (
                    <div className="flex flex-col gap-4 max-w-xl bndz-props-files">
                        <PluginCard className="bndz-props-overview">
                            <PluginSectionTitle icon="icon_studio">Folder / shortcut icon</PluginSectionTitle>
                            <p className="text-xs bndz-panel-muted leading-relaxed mb-4">
                                Pick a modern .ico or .png -- BNDZ writes it through Icon Studio the same way Files Customization does, with restore-default when you want Explorer stock back.
                            </p>
                            <div className="bndz-props-overview-row mb-4">
                                <div className="bndz-props-icon-tile bndz-props-icon-tile--lg">
                                    <PreviewHeroIcon
                                        path={heroIconPath}
                                        isDir={isDir}
                                        size={72}
                                        extension={ext}
                                        preferThumbnail={false}
                                    />
                                </div>
                                <div className="min-w-0 flex-1 flex flex-col gap-2">
                                    <div className="bndz-props-overview-name truncate">{displayName}</div>
                                    <div className="flex flex-wrap gap-2">
                                        <PluginHeroActionButton icon="folder_open_ui" variant="primary" onClick={() => applyCustomIcon('pick')} disabled={iconBusy}>
                                            {iconBusy ? 'Working...' : 'Choose icon'}
                                        </PluginHeroActionButton>
                                        <PluginHeroActionButton icon="refresh" onClick={() => applyCustomIcon('restore')} disabled={iconBusy}>
                                            Restore default
                                        </PluginHeroActionButton>
                                        <PluginHeroActionButton icon="icon_studio" onClick={() => window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', { detail: { id: 'icon-studio' } }))}>
                                            Icon Studio
                                        </PluginHeroActionButton>
                                    </div>
                                    {iconStatus && <div className="text-xs text-sky-300">{iconStatus}</div>}
                                </div>
                            </div>
                        </PluginCard>
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
                    </div>
                )}

                {activeTab === 'hashes' && !isMulti && entity?.type === 'file' && (
                    <PluginCard className="max-w-xl relative">
                        <PluginSectionTitle icon="key_ui">Cryptographic hashes</PluginSectionTitle>
                        {hash.loading && (
                            <div className="absolute inset-0 z-10 bndz-native-scrim flex flex-col gap-2 items-center justify-center rounded-lg">
                                <Icons8Icon id="loading" size={24} spin className="text-emerald-400" />
                                <div className="text-xs text-emerald-400 font-medium">Computing...</div>
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
