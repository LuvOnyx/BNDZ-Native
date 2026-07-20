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
  PLUGIN_INPUT_CLASS,
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

function formatFieldValue(key: string, value: string, formatSize: (bytes: string | undefined) => string) {
    return key === 'File Size' ? formatSize(value) : value;
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
    const [fieldFilter, setFieldFilter] = useState('');
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [copyAllFormat, setCopyAllFormat] = useState<'tsv' | 'json' | null>(null);

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

    useEffect(() => {
        setFieldFilter('');
        setCopiedKey(null);
        setCopyAllFormat(null);
    }, [path]);

    const grouped = useMemo(() => groupMetadata(meta), [meta]);

    const allEntries = useMemo(() => Object.entries(meta), [meta]);

    const filteredAllEntries = useMemo(() => {
        const q = fieldFilter.trim().toLowerCase();
        if (!q) return allEntries;
        return allEntries.filter(([key, value]) =>
            key.toLowerCase().includes(q) || String(value).toLowerCase().includes(q)
        );
    }, [allEntries, fieldFilter]);

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

    const flashCopied = (key: string) => {
        setCopiedKey(key);
        window.setTimeout(() => setCopiedKey(prev => (prev === key ? null : prev)), 1400);
    };

    const copyText = async (text: string, key: string) => {
        try {
            await navigator.clipboard.writeText(text);
            flashCopied(key);
        } catch {
            // Clipboard may be unavailable in some host contexts — fail silently.
        }
    };

    const copyField = async (key: string, value: string) => {
        const display = formatFieldValue(key, value, formatSize);
        await copyText(display, key);
    };

    const copyAllAsTsv = async () => {
        const entries = activeTab === 'all' ? filteredAllEntries : allEntries;
        if (!entries.length) return;
        const lines = entries.map(([key, value]) =>
            `${key}\t${formatFieldValue(key, value, formatSize).replace(/\t/g, ' ')}`
        );
        await copyText(lines.join('\n'), '__all_tsv');
        setCopyAllFormat('tsv');
        window.setTimeout(() => setCopyAllFormat(null), 1400);
    };

    const copyAllAsJson = async () => {
        const entries = activeTab === 'all' ? filteredAllEntries : allEntries;
        if (!entries.length) return;
        const obj: Record<string, string> = {};
        for (const [key, value] of entries) {
            obj[key] = formatFieldValue(key, value, formatSize);
        }
        if (hashes.md5) obj.MD5 = hashes.md5;
        if (hashes.sha256) obj['SHA-256'] = hashes.sha256;
        await copyText(JSON.stringify(obj, null, 2), '__all_json');
        setCopyAllFormat('json');
        window.setTimeout(() => setCopyAllFormat(null), 1400);
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
            {entries.map(([key, value]) => {
                const display = formatFieldValue(key, value, formatSize);
                return (
                    <React.Fragment key={key}>
                        <div className="bndz-plugin-field-label">{key}</div>
                        <div className="bndz-plugin-field-value bndz-mono group flex items-start gap-1.5 min-w-0">
                            <button
                                type="button"
                                onClick={() => void copyField(key, value)}
                                className="flex-1 min-w-0 text-left break-all hover:text-sky-200 transition-colors"
                                title="Click to copy field"
                            >
                                {display}
                            </button>
                            <button
                                type="button"
                                onClick={() => void copyField(key, value)}
                                className="shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 p-0.5 rounded text-slate-500 hover:text-sky-300 transition-opacity"
                                title={copiedKey === key ? 'Copied' : 'Copy field'}
                                aria-label={`Copy ${key}`}
                            >
                                <Icons8Icon id={copiedKey === key ? 'check' : 'copy'} size={12} />
                            </button>
                        </div>
                    </React.Fragment>
                );
            })}
        </PluginFieldGrid>
    );

    const hasAnyMeta = allEntries.length > 0;

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
                            <PluginHeroActionButton
                                icon="copy"
                                onClick={() => void copyAllAsTsv()}
                                disabled={!hasAnyMeta}
                                active={copyAllFormat === 'tsv'}
                            >
                                {copyAllFormat === 'tsv' ? 'Copied TSV' : 'Copy all (TSV)'}
                            </PluginHeroActionButton>
                            <PluginHeroActionButton
                                icon="braces_ui"
                                onClick={() => void copyAllAsJson()}
                                disabled={!hasAnyMeta}
                                active={copyAllFormat === 'json'}
                            >
                                {copyAllFormat === 'json' ? 'Copied JSON' : 'Copy all (JSON)'}
                            </PluginHeroActionButton>
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
                                        {hashes.md5 && (
                                            <PluginFieldRow label="MD5" mono>
                                                <button
                                                    type="button"
                                                    className="text-left break-all hover:text-sky-200"
                                                    onClick={() => void copyText(hashes.md5!, 'MD5')}
                                                    title="Copy MD5"
                                                >
                                                    {copiedKey === 'MD5' ? 'Copied' : hashes.md5}
                                                </button>
                                            </PluginFieldRow>
                                        )}
                                        {hashes.sha256 && (
                                            <PluginFieldRow label="SHA-256" mono>
                                                <button
                                                    type="button"
                                                    className="text-left break-all hover:text-sky-200"
                                                    onClick={() => void copyText(hashes.sha256!, 'SHA-256')}
                                                    title="Copy SHA-256"
                                                >
                                                    {copiedKey === 'SHA-256' ? 'Copied' : hashes.sha256}
                                                </button>
                                            </PluginFieldRow>
                                        )}
                                    </PluginFieldGrid>
                                </PluginCard>
                            )}
                            <PluginCard>
                                <PluginSectionTitle icon="file_ui">Key properties</PluginSectionTitle>
                                {(grouped.system.length > 0 || grouped.media.length > 0)
                                    ? renderRows([...grouped.system.slice(0, 8), ...grouped.media.slice(0, 4)])
                                    : !loading && (
                                        <PluginEmptyState
                                            icon="file_ui"
                                            title="No overview metadata"
                                            description="Extended properties were not available for this selection."
                                        />
                                    )}
                            </PluginCard>
                        </>
                    )}

                    {activeTab === 'media' && (
                        <PluginCard>
                            <PluginSectionTitle icon="picture_ui">Media & EXIF</PluginSectionTitle>
                            {grouped.media.length ? renderRows(grouped.media) : !loading && (
                                <PluginEmptyState
                                    icon="picture_ui"
                                    title="No media metadata"
                                    description="This item has no EXIF, codec, or media tags exposed by the shell."
                                />
                            )}
                        </PluginCard>
                    )}

                    {activeTab === 'system' && (
                        <PluginCard>
                            <PluginSectionTitle icon="shield_ui">System & NTFS</PluginSectionTitle>
                            {grouped.system.length ? renderRows(grouped.system) : !loading && (
                                <PluginEmptyState
                                    icon="shield_ui"
                                    title="No system metadata"
                                    description="NTFS attributes, owner, and ACL summary fields were not returned for this item."
                                />
                            )}
                        </PluginCard>
                    )}

                    {activeTab === 'all' && (
                        <PluginCard>
                            <PluginSectionTitle
                                icon="database_ui"
                                action={
                                    hasAnyMeta ? (
                                        <div className="flex items-center gap-1.5">
                                            <PluginToolbarButton
                                                icon="copy"
                                                onClick={() => void copyAllAsTsv()}
                                                active={copyAllFormat === 'tsv'}
                                            >
                                                {copyAllFormat === 'tsv' ? 'Copied' : 'TSV'}
                                            </PluginToolbarButton>
                                            <PluginToolbarButton
                                                icon="braces_ui"
                                                onClick={() => void copyAllAsJson()}
                                                active={copyAllFormat === 'json'}
                                            >
                                                {copyAllFormat === 'json' ? 'Copied' : 'JSON'}
                                            </PluginToolbarButton>
                                        </div>
                                    ) : undefined
                                }
                            >
                                All extended fields
                            </PluginSectionTitle>
                            {hasAnyMeta && (
                                <div className="mb-3 flex items-center gap-2">
                                    <div className="relative flex-1 min-w-0">
                                        <Icons8Icon
                                            id="file_search_ui"
                                            size={13}
                                            className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-45 pointer-events-none"
                                        />
                                        <input
                                            type="search"
                                            value={fieldFilter}
                                            onChange={e => setFieldFilter(e.target.value)}
                                            placeholder="Filter fields by name or value…"
                                            className={`${PLUGIN_INPUT_CLASS} !pl-8`}
                                            aria-label="Filter metadata fields"
                                        />
                                    </div>
                                    <span className="bndz-plugin-kind-pill shrink-0 tabular-nums">
                                        {filteredAllEntries.length}/{allEntries.length}
                                    </span>
                                </div>
                            )}
                            {filteredAllEntries.length ? renderRows(filteredAllEntries) : !loading && (
                                <PluginEmptyState
                                    icon="database_ui"
                                    title={hasAnyMeta ? 'No matching fields' : 'No extended metadata'}
                                    description={
                                        hasAnyMeta
                                            ? 'Try a different search term, or clear the filter to show all fields.'
                                            : 'The host returned no extended property bag for this selection.'
                                    }
                                />
                            )}
                        </PluginCard>
                    )}
                </div>
            </div>
        </PluginPanelShell>
    );
}
