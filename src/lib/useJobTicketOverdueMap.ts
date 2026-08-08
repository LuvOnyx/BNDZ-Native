import { useEffect, useRef, useState } from 'react';
import { IPC } from './ipcBridge';
import { joinPanePath, toWindowsPath } from './pathUtils';

type OverdueEntry = { count: number; title?: string };
type DirEntity = { type?: string; name: string; path?: string; id?: string };

/**
 * Folder job-ticket overdue badges for the current directory listing.
 * Kept outside BNDZUI.tsx so the useState binding cannot be dropped from the huge UI bundle.
 */
export function useJobTicketOverdueMap(
  currentPath: string,
  currentDirItems: DirEntity[] | undefined,
): Record<string, OverdueEntry> {
  const [overdueMap, setOverdueMap] = useState<Record<string, OverdueEntry>>({});
  const currentDirCount = currentDirItems?.length ?? 0;
  const itemsRef = useRef(currentDirItems);
  itemsRef.current = currentDirItems;

  useEffect(() => {
    const items = itemsRef.current;
    if (!IPC.isNative || !items?.length) {
      setOverdueMap({});
      return;
    }
    const folderPaths = items
      .filter((e) => e.type === 'directory')
      .map((e) => toWindowsPath(joinPanePath(currentPath, e)))
      .filter(Boolean);
    if (!folderPaths.length) {
      setOverdueMap({});
      return;
    }
    let active = true;
    const apply = (raw: Record<string, { count: number; title?: string }> | undefined) => {
      const map: Record<string, OverdueEntry> = {};
      for (const [k, v] of Object.entries(raw || {})) {
        map[k.toLowerCase()] = { count: v.count, title: v.title };
        map[toWindowsPath(k).toLowerCase()] = { count: v.count, title: v.title };
      }
      setOverdueMap(map);
    };
    void IPC.jobTicketListOverdue(folderPaths).then((res) => {
      if (!active || !res.ok) return;
      apply(res.overdueMap);
    }).catch(() => { /* host busy / timeout — badge is optional */ });
    const onChanged = () => {
      void IPC.jobTicketListOverdue(folderPaths).then((res) => {
        if (!active || !res.ok) return;
        apply(res.overdueMap);
      }).catch(() => { /* optional */ });
    };
    window.addEventListener('bndz-job-ticket-changed', onChanged);
    return () => {
      active = false;
      window.removeEventListener('bndz-job-ticket-changed', onChanged);
    };
  }, [currentPath, currentDirCount]);

  return overdueMap;
}
