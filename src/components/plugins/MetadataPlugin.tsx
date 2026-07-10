import React, { useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { toWindowsPath } from '../../lib/pathUtils';
import PluginPanelShell from './PluginPanelShell';
import {
  PluginToolbarButton,
  PluginSectionTitle,
  PluginCard,
  PluginFieldGrid,
  PluginFieldRow,
  PluginEmptyState,
} from './PluginPanelPrimitives';

export const MetadataPluginDef = {
    id: 'metadata',
    name: 'Metadata Inspector',
    icon: 'metadata',
    description: 'Deep file metadata, shell properties, and cryptographic hash analysis.',
    isNative: true,
    targetPanel: 'bottom' as const,
};

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

    const path = primarySelectedPath
        ? toWindowsPath(primarySelectedPath)
        : selectedItems[0]
            ? toWindowsPath(selectedItems[0])
            : entity?.path
                ? toWindowsPath(entity.path)
                : toWindowsPath(focusedPath || '');

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

    const formatSize = (bytes: string | undefined) => {
        if (!bytes) return '--';
        const n = parseInt(bytes, 10);
        if (isNaN(n)) return bytes;
        const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(n) / Math.log(k));
        return parseFloat((n / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    if (!path) {
        return (
            <PluginPanelShell
                title="Metadata Inspector"
                icon="metadata"
                iconColor="#0078d4"
                variant="embedded"
                subtitle="No selection"
            >
                <PluginEmptyState
                    icon="metadata"
                    description="Select a file or folder in the list to inspect extended metadata and hashes."
                />
            </PluginPanelShell>
        );
    }

    return (
        <PluginPanelShell
            title="Metadata Inspector"
            icon="metadata"
            iconColor="#0078d4"
            variant="embedded"
            subtitle={path.split(/[/\\]/).pop() || path}
            status={loading ? (
                <span className="flex items-center gap-2 text-gray-500"><Icons8Icon id="loading" size={12} spin /> Loading…</span>
            ) : undefined}
        >
            <div className="h-full overflow-y-auto bndz-scrollbar p-4 space-y-3">
                <PluginCard className="flex items-center justify-between gap-3 !py-2.5">
                    <p className="text-xs bndz-panel-muted leading-relaxed">
                        Full ACL, tags, and hash analysis live in <strong className="text-white font-medium">System Properties</strong>.
                    </p>
                    <PluginToolbarButton
                        onClick={() => window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', { detail: { id: 'properties' } }))}
                    >
                        Open Properties
                    </PluginToolbarButton>
                </PluginCard>
                {error && (
                    <div className="p-3 bg-red-900/20 border border-red-500/30 rounded-md text-red-400 text-xs">{error}</div>
                )}

                <PluginCard>
                    <PluginFieldGrid>
                        <PluginFieldRow label="Target path" mono>{path}</PluginFieldRow>
                    </PluginFieldGrid>
                </PluginCard>

                {(hashes.md5 || hashes.sha256) && (
                    <PluginCard>
                        <PluginSectionTitle icon="disk_mgmt">Cryptographic hashes</PluginSectionTitle>
                        <PluginFieldGrid>
                            {hashes.md5 && <PluginFieldRow label="MD5" mono>{hashes.md5}</PluginFieldRow>}
                            {hashes.sha256 && <PluginFieldRow label="SHA-256" mono>{hashes.sha256}</PluginFieldRow>}
                        </PluginFieldGrid>
                    </PluginCard>
                )}

                <PluginCard>
                    <PluginSectionTitle icon="file_ui">Extended properties</PluginSectionTitle>
                    {Object.entries(meta).length === 0 && !loading && (
                        <div className="bndz-panel-muted italic">No extended metadata available.</div>
                    )}
                    <PluginFieldGrid className="mt-1">
                        {Object.entries(meta).map(([key, value]) => (
                            <PluginFieldRow key={key} label={key} mono>
                                {key === 'File Size' ? formatSize(value) : value}
                            </PluginFieldRow>
                        ))}
                    </PluginFieldGrid>
                </PluginCard>
            </div>
        </PluginPanelShell>
    );
}
