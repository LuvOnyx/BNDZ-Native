import { IPC } from './ipcBridge';

export type IndexStatus = {
  fileCount: number;
  folderCount: number;
  locations: Array<{ path: string; lastIndexed: number }>;
  error?: string;
};

const TTL_MS = 12_000;

let cached: IndexStatus | null = null;
let cachedAt = 0;
let inflight: Promise<IndexStatus> | null = null;

export function invalidateIndexStatusCache(): void {
  cached = null;
  cachedAt = 0;
}

/** Coalesced index status — one IPC round-trip serves Hub, settings, and FM chrome. */
export async function getIndexStatusCached(force = false): Promise<IndexStatus> {
  if (!IPC.isNative) {
    return { fileCount: 0, folderCount: 0, locations: [] };
  }
  if (!force && cached && Date.now() - cachedAt < TTL_MS) {
    return cached;
  }
  if (inflight) return inflight;

  inflight = IPC.getIndexStatus()
    .then(status => {
      cached = status;
      cachedAt = Date.now();
      return status;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}
