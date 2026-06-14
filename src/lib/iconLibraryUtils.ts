import { toWindowsPath, encodeLocalStreamPath } from './pathUtils';

export interface ConfigIconLibrary {
    id: string;
    name: string;
    sourceFolder?: string;
    icons: string[];
}

export function formatLibrariesForConfig(libraries: Array<{ id?: string; name: string; sourceFolder?: string; icons: Array<{ icoStr?: string; name?: string } | string> }>): ConfigIconLibrary[] {
    return libraries.map(lib => ({
        id: lib.id || `lib_${lib.name}`,
        name: lib.name,
        sourceFolder: lib.sourceFolder,
        icons: (lib.icons || []).map(ic => {
            if (typeof ic === 'string') return ic;
            return ic.icoStr || '';
        }).filter(Boolean),
    }));
}

export function toLocalStreamUrl(icoPath: string): string {
    if (!icoPath) return '';
    if (icoPath.startsWith('data:')) return icoPath;
    return `http://bndz.local/local-stream/${encodeLocalStreamPath(toWindowsPath(icoPath))}`;
}
