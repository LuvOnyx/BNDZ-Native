import type { QuickScriptHandlers } from './addressQuickScripts';
import { catalogVirtualPath } from './virtualPaths';

/** Try ::slug as a catalog name (when not a built-in script). */
export function tryNavigateCatalogSlug(slug: string, handlers: QuickScriptHandlers): boolean {
  const s = slug.trim();
  if (!s || s.includes(' ')) return false;
  handlers.navigate(catalogVirtualPath(s));
  handlers.toast(`Catalog: ${s}`);
  return true;
}
