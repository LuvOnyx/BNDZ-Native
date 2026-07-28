import { useCallback, useEffect, useState, type RefObject } from 'react';

export type WorkspaceMenuState = {
  x: number;
  y: number;
  kind: 'spatial-card' | 'spatial-board' | 'automation-node' | 'automation-canvas' | 'automation-edge';
  targetId?: string;
} | null;

export function useWorkspaceContextMenu(surfaceRef?: RefObject<HTMLElement | null>) {
  const [menu, setMenu] = useState<WorkspaceMenuState>(null);

  const openMenu = useCallback((next: Exclude<WorkspaceMenuState, null>) => {
    setMenu(next);
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-bndz-workspace-menu]')) return;
      closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [menu, closeMenu]);

  const onContextMenu = useCallback((
    e: React.MouseEvent,
    kind: Exclude<WorkspaceMenuState, null>['kind'],
    targetId?: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (surfaceRef?.current && !surfaceRef.current.contains(e.currentTarget as Node)) return;
    openMenu({ x: e.clientX, y: e.clientY, kind, targetId });
  }, [openMenu, surfaceRef]);

  return { menu, openMenu, closeMenu, onContextMenu };
}
