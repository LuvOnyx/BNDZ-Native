import React, { useEffect, useRef } from 'react';
import type { PinRelation } from '../../lib/workspace/spatialCanvasUtils';
import type { CanvasItem } from '../../lib/spatialCanvasStore';
import { getMotionBusSnapshot, subscribeMotionPhase } from '../workstationMotionBus';
import { subscribeSpatialVisual } from '../../lib/workspace/spatialVisualBus';

type Props = {
  items: CanvasItem[];
  relations: PinRelation[];
  cardW: number;
  cardH: number;
  getItemPosition: (id: string) => { x: number; y: number };
};

export default function BezierWireLayer({ items, relations, cardW, cardH, getItemPosition }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const getItemPositionRef = useRef(getItemPosition);
  getItemPositionRef.current = getItemPosition;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !relations.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const strokeFor = (reason: PinRelation['reason']) => {
      if (reason === 'lineage') return { stroke: 'rgba(168, 130, 255, 0.78)', glow: 'rgba(139, 92, 246, 0.35)' };
      if (reason === 'tag') return { stroke: 'rgba(120, 210, 255, 0.72)', glow: 'rgba(56, 189, 248, 0.35)' };
      if (reason === 'folder') return { stroke: 'rgba(255, 210, 120, 0.65)', glow: 'rgba(251, 191, 36, 0.28)' };
      return { stroke: 'rgba(190, 195, 220, 0.5)', glow: 'rgba(148, 163, 184, 0.2)' };
    };

    const draw = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, w, h);
      const tension = getMotionBusSnapshot().snapTension;
      const pos = getItemPositionRef.current;

      relations.forEach((rel, i) => {
        const a = items.find(it => it.id === rel.fromId);
        const b = items.find(it => it.id === rel.toId);
        if (!a || !b) return;
        const pa = pos(a.id);
        const pb = pos(b.id);
        const x1 = pa.x + cardW / 2;
        const y1 = pa.y + cardH / 2;
        const x2 = pb.x + cardW / 2;
        const y2 = pb.y + cardH / 2;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.hypot(dx, dy) || 1;
        const bend = Math.min(120, dist * 0.35) + tension * 18 * Math.sin(i * 0.7);
        const cx = (x1 + x2) / 2 - (dy / dist) * bend * 0.15;
        const cy = (y1 + y2) / 2 + (dx / dist) * bend * 0.15;
        const { stroke, glow } = strokeFor(rel.reason);

        ctx.save();
        ctx.strokeStyle = glow;
        ctx.lineWidth = 4;
        ctx.shadowBlur = 8;
        ctx.shadowColor = glow;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(cx, cy, x2, y2);
        ctx.stroke();
        ctx.restore();

        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(cx, cy, x2, y2);
        ctx.stroke();
      });
    };

    draw();
    const unsubMotion = subscribeMotionPhase(draw);
    const unsubSpatial = subscribeSpatialVisual(draw);
    return () => {
      unsubMotion();
      unsubSpatial();
    };
  }, [items, relations, cardW, cardH]);

  if (!relations.length) return null;

  return (
    <canvas
      ref={canvasRef}
      className="bndz-spatial-wire-canvas absolute inset-0 pointer-events-none"
      aria-hidden
    />
  );
}
