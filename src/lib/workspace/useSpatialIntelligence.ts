import { useEffect, useRef, useState } from 'react';
import { IPC } from '../ipcBridge';
import type { CanvasItem } from '../spatialCanvasStore';

export interface PinHealthSummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
}

export interface PinLineageSummary {
  inboundCount: number;
  outboundCount: number;
  recentOp?: string;
  recentUtc?: string;
}

export interface PinCapacitySummary {
  freeBytes: number;
  totalBytes: number;
  usedPercent: number;
  deficitBytes: number;
}

export interface PinIntelligence {
  health?: PinHealthSummary;
  lineage?: PinLineageSummary;
  capacity?: PinCapacitySummary;
  loading: boolean;
}

export type IntelligenceMap = Map<string, PinIntelligence>;

const BATCH_SIZE = 8;
const DEBOUNCE_MS = 600;
const STALE_MS = 60_000;

function looksLikeDir(path: string): boolean {
  const base = path.split(/[/\\]/).pop() || '';
  return !base.includes('.');
}

/**
 * Batch-fetch health / lineage / capacity summaries for folder-pins on the spatial board.
 * Returns a stable map keyed by path. Debounces and caps concurrent requests.
 */
export function useSpatialIntelligence(items: CanvasItem[], enabled: boolean): IntelligenceMap {
  const [intel, setIntel] = useState<IntelligenceMap>(new Map());
  const fetchedAtRef = useRef<Map<string, number>>(new Map());
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    return () => { activeRef.current = false; };
  }, []);

  useEffect(() => {
    if (!enabled || !IPC.isNative || !items.length) return;

    const folderPins = items.filter(it => looksLikeDir(it.path));
    if (!folderPins.length) return;

    const now = Date.now();
    const stale = folderPins.filter(fp => {
      const last = fetchedAtRef.current.get(fp.path);
      return !last || now - last > STALE_MS;
    });
    if (!stale.length) return;

    const timer = window.setTimeout(async () => {
      if (!activeRef.current) return;

      for (let i = 0; i < stale.length; i += BATCH_SIZE) {
        if (!activeRef.current) return;
        const batch = stale.slice(i, i + BATCH_SIZE);

        const results = await Promise.allSettled(
          batch.map(async (pin) => {
            const path = pin.path;
            const entry: PinIntelligence = { loading: false };

            const [healthRes, lineageRes, capacityRes] = await Promise.allSettled([
              IPC.healthListProblems(path, 50),
              IPC.lineageGet(path, 2),
              IPC.capacityBuildPlan(path),
            ]);

            if (healthRes.status === 'fulfilled') {
              const problems = healthRes.value.problems || [];
              let critical = 0, warning = 0, info = 0;
              for (const p of problems) {
                const sev = (p.severity || p.Severity || '').toLowerCase();
                if (sev === 'error' || sev === 'critical') critical++;
                else if (sev === 'warning') warning++;
                else info++;
              }
              entry.health = { total: problems.length, critical, warning, info };
            }

            if (lineageRes.status === 'fulfilled') {
              const data = lineageRes.value;
              const inbound = Array.isArray(data.inbound) ? data.inbound : [];
              const outbound = Array.isArray(data.outbound) ? data.outbound : [];
              const timeline = Array.isArray(data.timeline) ? data.timeline : (data.edges || []);
              const recent = timeline[0];
              entry.lineage = {
                inboundCount: inbound.length,
                outboundCount: outbound.length,
                recentOp: recent?.op || recent?.Op,
                recentUtc: recent?.utc || recent?.Utc,
              };
            }

            if (capacityRes.status === 'fulfilled' && capacityRes.value.ok) {
              const plan = capacityRes.value.plan;
              if (plan) {
                const total = plan.totalBytes || plan.TotalBytes || 0;
                const free = plan.freeBytes || plan.FreeBytes || 0;
                const deficit = plan.deficitBytes || plan.DeficitBytes || 0;
                entry.capacity = {
                  freeBytes: free,
                  totalBytes: total,
                  usedPercent: total > 0 ? Math.round(((total - free) / total) * 100) : 0,
                  deficitBytes: deficit,
                };
              }
            }

            return { path, entry };
          }),
        );

        if (!activeRef.current) return;

        setIntel(prev => {
          const next = new Map(prev);
          for (const r of results) {
            if (r.status === 'fulfilled') {
              next.set(r.value.path, r.value.entry);
              fetchedAtRef.current.set(r.value.path, Date.now());
            }
          }
          return next;
        });
      }
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [items, enabled]);

  return intel;
}

export interface LineageEdgeForRelation {
  fromPath: string;
  toPath: string;
  op: string;
}

/**
 * Collect lineage edges between pinned paths for relation arc rendering.
 */
export function useLineageRelations(
  items: CanvasItem[],
  intel: IntelligenceMap,
  enabled: boolean,
): LineageEdgeForRelation[] {
  const [edges, setEdges] = useState<LineageEdgeForRelation[]>([]);

  useEffect(() => {
    if (!enabled || !IPC.isNative || !items.length) {
      setEdges([]);
      return;
    }

    const pinnedPaths = new Set(items.map(it => it.path.toLowerCase()));
    let active = true;

    const timer = window.setTimeout(async () => {
      if (!active) return;
      try {
        const result = await IPC.lineageGetRecent(200);
        if (!active) return;
        const relevant = (result.edges || []).filter((e: any) => {
          const from = (e.fromPath || e.FromPath || '').toLowerCase();
          const to = (e.toPath || e.ToPath || '').toLowerCase();
          return pinnedPaths.has(from) && pinnedPaths.has(to);
        }).map((e: any) => ({
          fromPath: (e.fromPath || e.FromPath || ''),
          toPath: (e.toPath || e.ToPath || ''),
          op: e.op || e.Op || 'link',
        }));
        setEdges(relevant);
      } catch {
        setEdges([]);
      }
    }, 800);

    return () => { active = false; window.clearTimeout(timer); };
  }, [items, enabled, intel]);

  return edges;
}
