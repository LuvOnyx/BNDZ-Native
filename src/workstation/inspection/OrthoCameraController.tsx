import { useThree, useFrame } from '@react-three/fiber';
import { useGesture } from '@use-gesture/react';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

type Props = {
  baseZoomRef: React.MutableRefObject<number>;
  onZoomChange?: (zoom: number) => void;
};

export default function OrthoCameraController({ baseZoomRef, onZoomChange }: Props) {
  const { camera, gl, invalidate } = useThree();
  const vel = useRef({ x: 0, y: 0 });
  const pan = useRef({ x: 0, y: 0 });
  const zoomMul = useRef(1);
  const dragOrigin = useRef({ panX: 0, panY: 0 });

  useEffect(() => {
    zoomMul.current = 1;
    pan.current = { x: 0, y: 0 };
    vel.current = { x: 0, y: 0 };
    onZoomChange?.(1);
    invalidate();
  }, [baseZoomRef, onZoomChange, invalidate]);

  useGesture(
    {
      onDragStart: () => {
        dragOrigin.current = { panX: pan.current.x, panY: pan.current.y };
      },
      onDrag: ({ movement: [mx, my], pinching, event }) => {
        if (pinching) return;
        event?.preventDefault();
        pan.current.x = dragOrigin.current.panX + mx * 0.5;
        pan.current.y = dragOrigin.current.panY - my * 0.5;
        vel.current.x = mx * 0.002;
        vel.current.y = -my * 0.002;
        invalidate();
      },
      onWheel: ({ delta: [, dy], event }) => {
        event.preventDefault();
        const factor = dy > 0 ? 0.92 : 1.08;
        zoomMul.current = Math.max(0.15, Math.min(12, zoomMul.current * factor));
        onZoomChange?.(zoomMul.current);
        invalidate();
      },
      onPinch: ({ offset: [s] }) => {
        zoomMul.current = Math.max(0.15, Math.min(12, s));
        onZoomChange?.(zoomMul.current);
        invalidate();
      },
    },
    { target: gl.domElement, eventOptions: { passive: false } },
  );

  useFrame(() => {
    vel.current.x *= 0.88;
    vel.current.y *= 0.88;
    pan.current.x += vel.current.x;
    pan.current.y += vel.current.y;
    if (Math.abs(vel.current.x) < 0.01) vel.current.x = 0;
    if (Math.abs(vel.current.y) < 0.01) vel.current.y = 0;

    const ortho = camera as THREE.OrthographicCamera;
    ortho.position.set(pan.current.x, pan.current.y, 2);
    ortho.zoom = Math.max(0.08, baseZoomRef.current * zoomMul.current);
    ortho.updateProjectionMatrix();
  });

  return null;
}
