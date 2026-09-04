import { joinPanePath, normalizePanePath } from './pathUtils';
import { isBndzRamPath } from './bndzVirtualViews';

export type CreatedItemKind = 'dir' | 'file';

export type FinishCreateContext = {
  paneId: string;
  panePath: string;
  kind: CreatedItemKind;
  finalWinPath?: string;
  finalName?: string;
  refetchPath: (path: string) => Promise<void>;
  getListing: (path: string) => Array<{ id: string; name?: string; path?: string; type?: string; isDirectory?: boolean }>;
  setSelectedItems: (ids: string[], paneId: string) => void;
  setFocusedItemId: (id: string | null) => void;
  beginInlineRename: (path: string, entityId: string, entity: Record<string, unknown>) => void;
  invalidateRamZone?: () => void;
};

/** Explorer parity: after create, select the new item and enter rename mode. */
export async function finishCreateAndRename(ctx: FinishCreateContext): Promise<void> {
  const panePath = normalizePanePath(ctx.panePath);
  if (isBndzRamPath(panePath)) {
    ctx.invalidateRamZone?.();
    window.dispatchEvent(new CustomEvent('bndz-refresh-path', { detail: { path: panePath } }));
  } else {
    await ctx.refetchPath(panePath);
  }

  const name = ctx.finalName
    || (ctx.finalWinPath ? ctx.finalWinPath.split(/[/\\]/).filter(Boolean).pop() : undefined);
  if (!name) return;

  const listing = ctx.getListing(panePath);
  const entity = listing.find(e => e.name === name)
    || listing.find(e => String(e.path || '').replace(/\\/g, '/').endsWith(`/${name}`));

  const isDir = ctx.kind === 'dir';
  const stubPath = joinPanePath(panePath, { name });
  const target = entity ?? {
    id: stubPath,
    path: stubPath,
    name,
    type: isDir ? 'directory' : 'file',
    isDirectory: isDir,
  };

  ctx.setSelectedItems([target.id], ctx.paneId);
  ctx.setFocusedItemId(target.id);
  ctx.beginInlineRename(panePath, target.id, target);
}
