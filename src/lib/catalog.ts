import { IPC } from './ipcBridge';

export type CatalogEntry = {
  id: string;
  name: string;
  paths: string[];
  query?: string | null;
  createdAt?: number;
  updatedAt?: number;
};

export async function listCatalogs(): Promise<CatalogEntry[]> {
  return IPC.listCatalogs();
}

export async function upsertCatalog(entry: Partial<CatalogEntry> & { name: string }): Promise<CatalogEntry | null> {
  return IPC.upsertCatalog(entry as any);
}

export async function deleteCatalog(catalogId: string): Promise<boolean> {
  return IPC.deleteCatalog(catalogId);
}

export async function getCatalogContents(path: string): Promise<any[]> {
  if (IPC.isNative) return IPC.getCatalogContents(path);
  const { isVirtualCatalogRoot, parseVirtualCatalogId } = await import('./virtualPaths');
  const catalogs = await listCatalogs();
  if (isVirtualCatalogRoot(path)) {
    return catalogs.map(c => ({
      id: `catalog-${c.id}`,
      name: c.name,
      type: 'directory',
      path: `/vf/${c.id}`,
      size: 0,
      itemCount: c.paths.length,
    }));
  }
  const slug = parseVirtualCatalogId(path);
  const cat = catalogs.find(c => c.id === slug || c.name.toLowerCase() === slug?.toLowerCase());
  if (!cat) return [];
  return cat.paths.map((p, i) => ({
    id: `vf-${cat.id}-${i}`,
    name: p.split(/[/\\]/).pop() || p,
    type: 'file',
    path: p.replace(/\\/g, '/'),
    size: 0,
  }));
}
