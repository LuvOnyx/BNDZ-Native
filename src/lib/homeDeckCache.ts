/** Session cache for Home deck — instant repaint, no full resync on every tab visit. */

export type HomeDeckSnapshot = {
  continuum: any[];
  places: any[];
  drives: any[];
  index: { fileCount?: number; folderCount?: number; locations?: Array<{ path: string; lastIndexed: number }> };
  library?: { images?: number; videos?: number; audio?: number; documents?: number; large?: number };
  pulse: { activeCount: number; queuedCount: number; label: string; transferLabel?: string; queue?: any };
  orbits: Record<string, any[]>;
  mostOpened?: any[];
  continuumFingerprint?: string;
  generatedAt?: number;
};

let memory: HomeDeckSnapshot | null = null;
let memoryAt = 0;

const STALE_MS = 90_000;
const PULSE_STALE_MS = 4_000;

export function getHomeDeckCache(): HomeDeckSnapshot | null {
  return memory;
}

export function getHomeDeckCacheAge(): number {
  return memoryAt ? Date.now() - memoryAt : Infinity;
}

export function isHomeDeckBodyFresh(): boolean {
  return !!memory && getHomeDeckCacheAge() < STALE_MS;
}

export function isHomeDeckPulseFresh(): boolean {
  return !!memory && getHomeDeckCacheAge() < PULSE_STALE_MS;
}

export function setHomeDeckCache(deck: HomeDeckSnapshot): void {
  memory = deck;
  memoryAt = Date.now();
}

export function buildIndexFingerprint(index?: { fileCount?: number; locations?: Array<{ path: string; lastIndexed: number }> }): string {
  const fc = index?.fileCount ?? 0;
  const locs = (index?.locations || [])
    .map(l => `${l.path}:${l.lastIndexed || 0}`)
    .sort()
    .join('|');
  return `${fc}::${locs}`;
}
