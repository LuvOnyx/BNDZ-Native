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
  /** When true (default), await refetch before select/rename. Prefer false after optimistic insert. */
  awaitRefetch?: boolean;
};

function findCreatedEntity(
  listing: Array<{ id: string; name?: string; path?: string }>,
  name: string,
) {
  const lower = name.toLowerCase();
  return listing.find(e => (e.name || '').toLowerCase() === lower)
    || listing.find(e => String(e.path || '').replace(/\\/g, '/').toLowerCase().endsWith(`/${lower}`));
}

function scrollCreatedIntoView(entityId: string) {
  try {
    const byId = document.getElementById(`fs-item-${entityId}`);
    if (byId) {
      byId.scrollIntoView({ block: 'nearest' });
      return;
    }
    // FileListRow uses data-id on .fs-item-wrapper (not id="fs-item-…").
    const safe = (typeof CSS !== 'undefined' && CSS.escape)
      ? CSS.escape(entityId)
      : entityId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const byData = document.querySelector(`.fs-item-wrapper[data-id="${safe}"]`) as HTMLElement | null;
    byData?.scrollIntoView({ block: 'nearest' });
  } catch { /* ignore */ }
}

/** Explorer parity: after create, select the new item and enter rename mode. */
export async function finishCreateAndRename(ctx: FinishCreateContext): Promise<void> {
  const panePath = normalizePanePath(ctx.panePath);
  const awaitRefetch = ctx.awaitRefetch !== false;

  if (isBndzRamPath(panePath)) {
    ctx.invalidateRamZone?.();
    window.dispatchEvent(new CustomEvent('bndz-refresh-path', { detail: { path: panePath } }));
  } else if (awaitRefetch) {
    await ctx.refetchPath(panePath);
  } else {
    // Background refresh — keep create/rename snappy; don't leave UI waiting on listing IPC.
    void ctx.refetchPath(panePath);
  }

  const name = ctx.finalName
    || (ctx.finalWinPath ? ctx.finalWinPath.split(/[/\\]/).filter(Boolean).pop() : undefined);
  if (!name) return;

  // Cache ref can lag one frame behind setState after refetch — brief retry.
  let entity = findCreatedEntity(ctx.getListing(panePath), name);
  if (!entity) {
    for (let i = 0; i < 10 && !entity; i++) {
      await new Promise<void>(r => requestAnimationFrame(() => r()));
      entity = findCreatedEntity(ctx.getListing(panePath), name);
    }
  }

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
  requestAnimationFrame(() => {
    scrollCreatedIntoView(target.id);
    requestAnimationFrame(() => scrollCreatedIntoView(target.id));
  });
  ctx.beginInlineRename(panePath, target.id, target);
}
