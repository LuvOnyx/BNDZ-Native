import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import type { CanvasItem } from '../../lib/spatialCanvasStore';

const CARD_W = 228;
const CARD_H = 176;

export type ConstellationMinimapHandle = {
  setViewport: (panX: number, panY: number, zoom: number) => void;
};

type Props = {
  items: CanvasItem[];
  boardW: number;
  boardH: number;
  onJump: (panX: number, panY: number) => void;
};

const ConstellationMinimap = forwardRef<ConstellationMinimapHandle, Props>(function ConstellationMinimap({
  items, boardW, boardH, onJump,
}, ref) {
  const viewportRef = useRef<SVGRectElement>(null);
  const lastViewport = useRef({ panX: 0, panY: 0, zoom: 1 });

  const bounds = useMemo(() => {
    if (!items.length) return { minX: 0, minY: 0, maxX: 400, maxY: 300 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    items.forEach(it => {
      minX = Math.min(minX, it.x);
      minY = Math.min(minY, it.y);
      maxX = Math.max(maxX, it.x + CARD_W);
      maxY = Math.max(maxY, it.y + CARD_H);
    });
    const pad = 48;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }, [items]);

  const mapW = 140;
  const mapH = 90;
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min(mapW / bw, mapH / bh);

  const toMap = (wx: number, wy: number) => ({
    x: (wx - bounds.minX) * scale,
    y: (wy - bounds.minY) * scale,
  });

  const applyViewport = (panX: number, panY: number, zoom: number) => {
    lastViewport.current = { panX, panY, zoom };
    const el = viewportRef.current;
    if (!el) return;
    const vp = {
      x: (-panX / zoom - bounds.minX) * scale,
      y: (-panY / zoom - bounds.minY) * scale,
      w: (boardW / zoom) * scale,
      h: (boardH / zoom) * scale,
    };
    el.setAttribute('x', String(vp.x));
    el.setAttribute('y', String(vp.y));
    el.setAttribute('width', String(Math.max(4, vp.w)));
    el.setAttribute('height', String(Math.max(4, vp.h)));
  };

  useImperativeHandle(ref, () => ({
    setViewport: applyViewport,
  }), [bounds.minX, bounds.minY, scale, boardW, boardH]);

  const handleClick = (e: React.MouseEvent<SVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const wx = bounds.minX + mx / scale;
    const wy = bounds.minY + my / scale;
    const { zoom } = lastViewport.current;
    const nextPanX = boardW / 2 - wx * zoom;
    const nextPanY = boardH / 2 - wy * zoom;
    onJump(nextPanX, nextPanY);
  };

  return (
    <div className="bndz-constellation-minimap" aria-label="Board minimap">
      <svg
        width={mapW}
        height={mapH}
        viewBox={`0 0 ${mapW} ${mapH}`}
        className="bndz-constellation-minimap-svg"
        onClick={handleClick}
        role="img"
      >
        <rect x={0} y={0} width={mapW} height={mapH} className="bndz-minimap-bg" />
        {items.map(it => {
          const p = toMap(it.x, it.y);
          return (
            <rect
              key={it.id}
              x={p.x}
              y={p.y}
              width={Math.max(2, CARD_W * scale)}
              height={Math.max(2, CARD_H * scale)}
              className="bndz-minimap-pin"
            />
          );
        })}
        <rect
          ref={viewportRef}
          x={0}
          y={0}
          width={4}
          height={4}
          className="bndz-minimap-viewport"
        />
      </svg>
    </div>
  );
});

export default ConstellationMinimap;
