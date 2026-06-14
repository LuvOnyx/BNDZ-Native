import React, { useEffect, useState } from 'react';
import { Database, Loader2, FileText, HardDrive } from 'lucide-react';
import { IPC } from '../../lib/ipcBridge';
import { toWindowsPath } from '../../lib/pathUtils';

export const MetadataPluginDef = {
    id: 'metadata',
    name: 'Metadata Inspector',
    icon: Database,
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
            <div className="flex items-center justify-center h-full text-gray-600 text-xs">
                Select a file or folder to inspect metadata.
            </div>
        );
    }

    return (
        <div className="w-full h-full flex flex-col bg-[#0d0d0d] text-gray-300 min-h-0">
            <div className="px-4 py-3 border-b border-[#222] bg-[#111] shrink-0 flex items-center gap-2">
                <Database size={14} className="text-sky-400" />
                <span className="font-bold text-sm text-white">Metadata Inspector</span>
                {loading && <Loader2 size={12} className="animate-spin text-gray-500 ml-2" />}
            </div>

            <div className="flex-1 overflow-y-auto bndz-scrollbar p-4 space-y-4 min-h-0">
                {error && (
                    <div className="p-3 bg-red-900/20 border border-red-500/30 rounded text-red-400 text-xs">{error}</div>
                )}

                <div className="p-3 bg-[#111] border border-[#222] rounded-lg">
                    <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Target Path</div>
                    <div className="text-xs font-mono text-sky-300 break-all">{path}</div>
                </div>

                {(hashes.md5 || hashes.sha256) && (
                    <div className="p-3 bg-[#111] border border-[#222] rounded-lg space-y-2">
                        <div className="text-[10px] uppercase tracking-wider text-gray-500 flex items-center gap-1"><HardDrive size={10} /> Cryptographic Hashes</div>
                        {hashes.md5 && <div className="text-[10px] font-mono"><span className="text-gray-500">MD5: </span>{hashes.md5}</div>}
                        {hashes.sha256 && <div className="text-[10px] font-mono break-all"><span className="text-gray-500">SHA256: </span>{hashes.sha256}</div>}
                    </div>
                )}

                <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-1"><FileText size={10} /> Extended Properties</div>
                    {Object.entries(meta).length === 0 && !loading && (
                        <div className="text-xs text-gray-600 italic">No extended metadata available.</div>
                    )}
                    {Object.entries(meta).map(([key, value]) => (
                        <div key={key} className="flex gap-3 py-1.5 px-2 hover:bg-[#1a1a1a] rounded text-xs border-b border-[#1a1a1a]">
                            <span className="text-gray-500 w-36 shrink-0 font-medium">{key}</span>
                            <span className="text-gray-300 font-mono break-all flex-1">
                                {key === 'File Size' ? formatSize(value) : value}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
