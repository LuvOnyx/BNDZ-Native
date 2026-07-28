import React, {
  createContext, useContext, useEffect, useMemo, useRef,
} from 'react';
import { WorkspaceInteractionEngine } from '../../lib/workspace/WorkspaceInteractionEngine';

type ViewportCtx = {
  engine: WorkspaceInteractionEngine;
  boardRef: React.RefObject<HTMLDivElement | null>;
};

const WorkspaceViewportContext = createContext<ViewportCtx | null>(null);

export function useWorkspaceViewport(): ViewportCtx {
  const ctx = useContext(WorkspaceViewportContext);
  if (!ctx) throw new Error('useWorkspaceViewport must be used within WorkspaceViewport');
  return ctx;
}

type Props = {
  children: React.ReactNode;
  minZoom?: number;
  maxZoom?: number;
  wheelZoom?: boolean;
  onZoomDisplay?: (zoom: number) => void;
  onTransformCommit?: (panX: number, panY: number, zoom: number) => void;
  className?: string;
  surfaceProps?: React.HTMLAttributes<HTMLDivElement>;
};

export default function WorkspaceViewport({
  children,
  minZoom,
  maxZoom,
  wheelZoom = true,
  onZoomDisplay,
  onTransformCommit,
  className,
  surfaceProps,
}: Props) {
  const boardRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<WorkspaceInteractionEngine | null>(null);
  const wheelCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const engine = useMemo(() => {
    engineRef.current?.destroy();
    const e = new WorkspaceInteractionEngine({ minZoom, maxZoom });
    engineRef.current = e;
    return e;
  }, [minZoom, maxZoom]);

  const scheduleCommit = () => {
    if (!onTransformCommit) return;
    if (wheelCommitTimer.current) clearTimeout(wheelCommitTimer.current);
    wheelCommitTimer.current = setTimeout(() => {
      wheelCommitTimer.current = null;
      const t = engine.getTransform();
      onTransformCommit(t.panX, t.panY, t.zoom);
    }, 120);
  };

  useEffect(() => () => {
    engine.destroy();
    if (wheelCommitTimer.current) clearTimeout(wheelCommitTimer.current);
  }, [engine]);

  useEffect(() => {
    if (!onZoomDisplay) return;
    return engine.subscribeDisplay(onZoomDisplay);
  }, [engine, onZoomDisplay]);

  const ctx = useMemo(() => ({ engine, boardRef }), [engine]);

  const { onWheel: surfaceOnWheel, ...restSurface } = surfaceProps ?? {};

  return (
    <WorkspaceViewportContext.Provider value={ctx}>
      <div
        {...restSurface}
        className={className}
        data-bndz-workspace-viewport
        onWheel={e => {
          surfaceOnWheel?.(e);
          if (!wheelZoom || e.defaultPrevented) return;
          const board = boardRef.current;
          if (!board) return;
          const rect = board.getBoundingClientRect();
          const inBoard =
            e.clientX >= rect.left && e.clientX <= rect.right
            && e.clientY >= rect.top && e.clientY <= rect.bottom;
          if (!inBoard) return;
          e.preventDefault();
          e.stopPropagation();
          if (e.ctrlKey || e.metaKey) {
            const delta = e.deltaY > 0 ? 0.9 : 1.11;
            engine.zoomAtCursor(e.clientX, e.clientY, rect, delta);
          } else {
            const dx = e.shiftKey ? -e.deltaY : 0;
            const dy = e.shiftKey ? 0 : -e.deltaY;
            engine.panBy(dx, dy);
          }
          scheduleCommit();
        }}
      >
        {children}
      </div>
    </WorkspaceViewportContext.Provider>
  );
}
