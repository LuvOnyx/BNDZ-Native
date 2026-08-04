import { useEffect, useRef, useState } from 'react';
import { IPC } from './ipcBridge';
import { joinPanePath, toWindowsPath } from './pathUtils';

export type HealthSeverity = 'critical' | 'warning' | 'info';

export type HealthBadgeEntry = {
  severity: HealthSeverity;
  kind: string;
  detail: string;
  title: string;
};

type DirEntity = { type?: string; name: string; path?: string; id?: string };

const SEVERITY_RANK: Record<HealthSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

function normalizeSeverity(raw: string): HealthSeverity {
  const s = raw.toLowerCase();
  if (s === 'critical' || s === 'error') return 'critical';
  if (s === 'warning' || s === 'warn') return 'warning';
  return 'info';
}

function pathKey(p: string): string {
  return toWindowsPath(p).replace(/[/\\]+$/, '').toLowerCase();
}

/**
 * Worst health severity per path under the current directory.
 * Powers list-row badges without opening Library Health plugin.
 */
export function useHealthProblemMap(
  currentPath: string,
  currentDirItems: DirEntity[] | undefined,
): Record<string, HealthBadgeEntry> {
  const [map, setMap] = useState<Record<string, HealthBadgeEntry>>({});
  const itemsRef = useRef(currentDirItems);
  itemsRef.current = currentDirItems;
  const currentDirCount = currentDirItems?.length ?? 0;

  useEffect(() => {
    const items = itemsRef.current;
    if (!IPC.isNative || !items?.length || !currentPath || currentPath === '/') {
      setMap({});
      return;
    }

    const rootWin = toWindowsPath(currentPath);
    if (!rootWin || rootWin.startsWith('/bndz')) {
      // Virtual roots: still query with empty prefix when on /bndz/problems
      if (!currentPath.replace(/\\/g, '/').toLowerCase().includes('/bndz/problems')) {
        setMap({});
        return;
      }
    }

    let active = true;
    const prefix =
      currentPath.replace(/\\/g, '/').toLowerCase().includes('/bndz/problems')
        ? undefined
        : rootWin;

    void IPC.healthListProblems(prefix, 400)
      .then((res) => {
        if (!active) return;
        const next: Record<string, HealthBadgeEntry> = {};
        const problems = Array.isArray(res?.problems) ? res.problems : [];
        for (const raw of problems) {
          const r = raw as Record<string, unknown>;
          const path = String(r.path ?? r.Path ?? '');
          if (!path) continue;
          const severity = normalizeSeverity(String(r.severity ?? r.Severity ?? ''));
          const kind = String(r.kind ?? r.Kind ?? 'issue');
          const detail = String(r.detail ?? r.Detail ?? '');
          const key = pathKey(path);
          const title = detail ? `${kind}: ${detail}` : kind;
          const prev = next[key];
          if (!prev || SEVERITY_RANK[severity] > SEVERITY_RANK[prev.severity]) {
            next[key] = { severity, kind, detail, title };
          }
        }

        // Also map children of current dir by joining — covers when problem path equals entity path
        const exact = { ...next };
        for (const e of items) {
          const full = pathKey(joinPanePath(currentPath, e));
          if (exact[full]) {
            next[full] = exact[full];
            continue;
          }
          if (e.type !== 'directory') continue;
          let worst: HealthBadgeEntry | undefined;
          const folderPrefix = full + '\\';
          for (const [k, v] of Object.entries(exact)) {
            if (!k.startsWith(folderPrefix) && k !== full) continue;
            if (!worst || SEVERITY_RANK[v.severity] > SEVERITY_RANK[worst.severity]) worst = v;
          }
          if (worst) next[full] = { ...worst, title: `Contains issues — ${worst.title}` };
        }

        setMap(next);
      })
      .catch(() => {
        if (active) setMap({});
      });

    return () => {
      active = false;
    };
  }, [currentPath, currentDirCount]);

  return map;
}

export const HEALTH_BADGE_COLORS: Record<HealthSeverity, string> = {
  critical: '#f87171',
  warning: '#fbbf24',
  info: '#38bdf8',
};
