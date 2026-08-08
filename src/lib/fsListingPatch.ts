/**
 * Patch an open directory listing from FS watcher events without a full GET_DIR.
 * Returns null when the event cannot be applied locally (caller may soft-refetch).
 */
export type FsListingEvent = {
  type?: string;
  dir?: string;
  name?: string;
  oldName?: string;
};

export function applyFsEventsToListing(
  listing: any[] | undefined,
  events: FsListingEvent[],
): { next: any[] | null; needsSoftRefresh: boolean } {
  if (!Array.isArray(listing)) {
    return { next: null, needsSoftRefresh: true };
  }

  let next = listing.slice();
  let mutated = false;
  let needsSoftRefresh = false;

  for (const ev of events) {
    const type = String(ev.type || '');
    const name = String(ev.name || '').trim();
    if (!name) continue;

    if (type === 'Changed') {
      // Attribute/size chatter — skip full listing churn.
      continue;
    }

    if (type === 'Deleted') {
      const before = next.length;
      next = next.filter((e: any) => String(e.name || '') !== name);
      if (next.length !== before) mutated = true;
      continue;
    }

    if (type === 'Renamed') {
      const oldName = String(ev.oldName || '').trim();
      if (!oldName) {
        needsSoftRefresh = true;
        continue;
      }
      const idx = next.findIndex((e: any) => String(e.name || '') === oldName);
      if (idx < 0) {
        needsSoftRefresh = true;
        continue;
      }
      const prev = next[idx];
      const updated = {
        ...prev,
        name,
        id: typeof prev.id === 'string' && prev.id.endsWith(oldName)
          ? prev.id.slice(0, -oldName.length) + name
          : prev.id,
        path: typeof prev.path === 'string'
          ? prev.path.replace(/[/\\][^/\\]+$/, (m: string) => m[0] + name)
          : prev.path,
      };
      next = next.slice();
      next[idx] = updated;
      mutated = true;
      continue;
    }

    if (type === 'Created') {
      // Need host metadata (size/type/id) — soft-refresh once, don't kick every Changed.
      needsSoftRefresh = true;
      continue;
    }
  }

  return { next: mutated ? next : listing, needsSoftRefresh };
}
