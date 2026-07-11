import React, { useEffect, useMemo, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { toWindowsPath } from '../../lib/pathUtils';
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
} from './PluginPanelPrimitives';

export const MetadataPluginDef = {
    id: 'metadata',
    name: 'Metadata Inspector',
    icon: 'metadata',
    description: 'Deep file metadata, shell properties, and cryptographic hash analysis.',
    isNative: true,
    targetPanel: 'bottom' as const,
};

const MEDIA_KEYS = new Set([
    'Dimensions', 'Duration', 'Bitrate', 'Codec', 'Camera Model', 'Date Taken',
    'F-Stop', 'Exposure Time', 'Focal Length', 'ISO Speed', 'Frame Rate',
    'Audio Bitrate', 'Sample Rate', 'Channels',
]);

function groupMetadata(meta: Record<string, string>) {
    const media: [string, string][] = [];
    const system: [string, string][] = [];
    const other: [string, string][] = [];
    for (const [key, value] of Object.entries(meta)) {
        if (!value) continue;
        if (MEDIA_KEYS.has(key) || /camera|exif|audio|video|resolution/i.test(key)) {
            media.push([key, value]);
        } else if (/ACL|Owner|Archive|Hidden|System|ReadOnly|Created|Modified|Accessed|File Size/i.test(key)) {
            system.push([key, value]);
        } else {
            other.push([key, value]);
        }
    }
    return { media, system, other };
}

export default function MetadataPlugin({
    focusedPath,
    entity,
    primarySelectedPath,
    selectedItems = [],
}: {
    focusedPath?: string;
    entity?: any;
    primarySelectedPath?: string | null;
    selectedItems?: string[];
}) {
    const [meta, setMeta] = useState<Record<string, string>>({});
    const [hashes, setHashes] = useState<{ md5?: string; sha256?: string }>({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'overview' | 'media' | 'system' | 'all'>('overview');

    const path = primarySelectedPath
        ? toWindowsPath(primarySelectedPath)
        : selectedItems[0]
            ? toWindowsPath(selectedItems[0])
            : entity?.path
                ? toWindowsPath(entity.path)
                : toWindowsPath(focusedPath || '');

    const displayName = path.split(/[/\\]/).pop() || path;
    const ext = entity?.type === 'file' ? ((entity as any)?.extension?.toLowerCase() || '') : '';

    useEffect(() => {
        if (!path) {
            setMeta({});
            setHashes({});
            return;
        }

        let active = true;
        setLoading(true);
        setError(null);

        Promise.all([
            IPC.getExtendedMetadata(path),
            entity?.type === 'file' ? IPC.getAsyncHashes(path) : Promise.resolve({}),
        ]).then(([details, hashResult]) => {
            if (!active) return;
            setMeta(details || {});
            setHashes(hashResult || {});
            setLoading(false);
        }).catch(err => {
            if (active) {
                setError(err?.message || 'Failed to load metadata');
                setLoading(false);
            }
        });

        return () => { active = false; };
    }, [path, entity?.type]);

    const grouped = useMemo(() => groupMetadata(meta), [meta]);

    const formatSize = (bytes: string | undefined) => {
        if (!bytes) return '--';
        const n = parseInt(bytes, 10);
        if (isNaN(n)) return bytes;
        const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(n) / Math.log(k));
        return parseFloat((n / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const openProperties = () => {
        window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', { detail: { id: 'properties' } }));
    };

    if (!path) {
        return (
            <PluginPanelShell title="Metadata Inspector" icon="metadata" iconColor="#38bdf8" variant="embedded" subtitle="No selection">
                <PluginEmptyState icon="metadata" description="Select a file or folder to inspect extended metadata, media tags, and hashes." />
            </PluginPanelShell>
        );
    }

    const renderRows = (entries: [string, string][]) => (
        <PluginFieldGrid className="mt-1">
            {entries.map(([key, value]) => (
                <PluginFieldRow key={key} label={key} mono>
                    {key === 'File Size' ? formatSize(value) : value}
                </PluginFieldRow>
            ))}
        </PluginFieldGrid>
    );

    return (
        <PluginPanelShell
            title="Metadata Inspector"
            icon="metadata"
            iconColor="#38bdf8"
            variant="embedded"
            subtitle={displayName}
            status={loading ? (
                <span className="flex items-center gap-2 text-slate-500"><Icons8Icon id="loading" size={12} spin /> Loading metadata…</span>
            ) : undefined}
        >
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <PluginHeroStrip
                    icon={<Icons8Icon id="metadata" size={56} className="opacity-90" />}
                    name={displayName}
                    typeLabel={ext ? `${ext.toUpperCase()} file` : entity?.type === 'directory' ? 'Folder' : 'Item'}
                    path={path}
                    actions={
                        <>
                            <PluginHeroActionButton icon="sys_properties" variant="primary" onClick={openProperties}>Full properties</PluginHeroActionButton>
                            <PluginHeroActionButton icon="copy" onClick={() => void navigator.clipboard.writeText(path)}>Copy path</PluginHeroActionButton>
                        </>
                    }
                />

                <PluginTabStrip>
                    <PluginTab active={activeTab === 'overview'} onClick={() => setActiveTab('overview')}>Overview</PluginTab>
                    <PluginTab active={activeTab === 'media'} onClick={() => setActiveTab('media')}>Media</PluginTab>
                    <PluginTab active={activeTab === 'system'} onClick={() => setActiveTab('system')}>System</PluginTab>
                    <PluginTab active={activeTab === 'all'} onClick={() => setActiveTab('all')}>All fields</PluginTab>
                </PluginTabStrip>

                <div className="flex-1 overflow-y-auto bndz-scrollbar p-5 space-y-4 min-h-0">
                    {error && (
                        <div className="p-3 bg-red-900/20 border border-red-500/30 rounded-lg text-red-400 text-xs flex items-center gap-2">
                            <Icons8Icon id="error_ui" size={14} /> {error}
                        </div>
                    )}

                    {activeTab === 'overview' && (
                        <>
                            {(hashes.md5 || hashes.sha256) && (
                                <PluginCard>
                                    <PluginSectionTitle icon="key_ui">Hashes</PluginSectionTitle>
                                    <PluginFieldGrid>
                                        {hashes.md5 && <PluginFieldRow label="MD5" mono>{hashes.md5}</PluginFieldRow>}
                                        {hashes.sha256 && <PluginFieldRow label="SHA-256" mono>{hashes.sha256}</PluginFieldRow>}
                                    </PluginFieldGrid>
                                </PluginCard>
                            )}
                            <PluginCard>
                                <PluginSectionTitle icon="file_ui">Key properties</PluginSectionTitle>
                                {renderRows([...grouped.system.slice(0, 8), ...grouped.media.slice(0, 4)])}
                                {!grouped.system.length && !grouped.media.length && !loading && (
                                    <p className="bndz-panel-muted text-xs italic">No overview metadata available.</p>
                                )}
                            </PluginCard>
                        </>
                    )}

                    {activeTab === 'media' && (
                        <PluginCard>
                            <PluginSectionTitle icon="picture_ui">Media & EXIF</PluginSectionTitle>
                            {grouped.media.length ? renderRows(grouped.media) : (
                                <p className="bndz-panel-muted text-xs italic">No media metadata for this item.</p>
                            )}
                        </PluginCard>
                    )}

                    {activeTab === 'system' && (
                        <PluginCard>
                            <PluginSectionTitle icon="shield_ui">System & NTFS</PluginSectionTitle>
                            {grouped.system.length ? renderRows(grouped.system) : (
                                <p className="bndz-panel-muted text-xs italic">No system metadata for this item.</p>
                            )}
                        </PluginCard>
                    )}

                    {activeTab === 'all' && (
                        <PluginCard>
                            <PluginSectionTitle icon="database_ui">All extended fields</PluginSectionTitle>
                            {Object.entries(meta).length ? renderRows(Object.entries(meta)) : (
                                !loading && <p className="bndz-panel-muted text-xs italic">No extended metadata available.</p>
                            )}
                        </PluginCard>
                    )}
                </div>
            </div>
        </PluginPanelShell>
    );
}
