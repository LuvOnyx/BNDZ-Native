import { useThree, useFrame } from '@react-three/fiber';
import { useGesture } from '@use-gesture/react';
import { useRef } from 'react';
import * as THREE from 'three';

type Props = {
  baseZoomRef: React.MutableRefObject<number>;
  /** Half-extents of the image plane in world units. */
  planeHalfRef: React.MutableRefObject<{ x: number; y: number }>;
  onZoomChange?: (zoomMul: number) => void;
};

/**
 * Pan/zoom for R3F orthographic (pixel frustum ±size/2).
 * Screen pixels → world: delta / ortho.zoom.
 * Clamp so the plane cannot be thrown out of view.
 * Does not reset on resize — FitCamera owns base zoom.
 */
export default function OrthoCameraController({ baseZoomRef, planeHalfRef, onZoomChange }: Props) {
  const { camera, gl, invalidate, size } = useThree();
  const pan = useRef({ x: 0, y: 0 });
  const zoomMul = useRef(1);
  const dragOrigin = useRef({ panX: 0, panY: 0 });
  const syncedFit = useRef(0);

  const clampPan = () => {
    const z = Math.max(1, baseZoomRef.current * zoomMul.current);
    const half = planeHalfRef.current;
    const viewW = size.width / z;
    const viewH = size.height / z;
    // Always keep a little slack on both axes (letterboxed / pillarboxed), so vertical
    // pan is not locked to 0 just because fit is width-limited.
    const slackX = viewW * 0.1;
    const slackY = viewH * 0.1;
    const maxX = Math.max(slackX, half.x - viewW / 2 + viewW * 0.04);
    const maxY = Math.max(slackY, half.y - viewH / 2 + viewH * 0.04);
    pan.current.x = Math.max(-maxX, Math.min(maxX, pan.current.x));
    pan.current.y = Math.max(-maxY, Math.min(maxY, pan.current.y));
  };

  useGesture(
    {
      onDragStart: () => {
        dragOrigin.current = { panX: pan.current.x, panY: pan.current.y };
      },
      onDrag: ({ movement: [mx, my], pinching, dragging, event }) => {
        if (pinching || !dragging) return;
        if (baseZoomRef.current < 1) return;
        event?.preventDefault();
        const z = Math.max(1, baseZoomRef.current * zoomMul.current);
        // 1 screen pixel = 1/zoom world units in R3F pixel frustum.
        pan.current.x = dragOrigin.current.panX - mx / z;
        pan.current.y = dragOrigin.current.panY + my / z;
        clampPan();
        invalidate();
      },
      onWheel: ({ delta: [, dy], event }) => {
        if (baseZoomRef.current < 1) return;
        event.preventDefault();
        const factor = dy > 0 ? 0.9 : 1.1;
        zoomMul.current = Math.max(0.25, Math.min(16, zoomMul.current * factor));
        clampPan();
        onZoomChange?.(zoomMul.current);
        invalidate();
      },
      onPinch: ({ offset: [s] }) => {
        if (baseZoomRef.current < 1) return;
        zoomMul.current = Math.max(0.25, Math.min(16, s));
        clampPan();
        onZoomChange?.(zoomMul.current);
        invalidate();
      },
    },
    { target: gl.domElement, eventOptions: { passive: false } },
  );

  useFrame(() => {
    const fit = baseZoomRef.current;
    if (fit < 1) return;

    // Sync once when FitCamera publishes a real fit zoom (not on every resize).
    if (syncedFit.current !== fit && Math.abs(syncedFit.current - fit) > 0.5) {
      const first = syncedFit.current < 1;
      syncedFit.current = fit;
      if (first) {
        zoomMul.current = 1;
        pan.current = { x: 0, y: 0 };
        onZoomChange?.(1);
      }
    }

    clampPan();
    const ortho = camera as THREE.OrthographicCamera;
    ortho.position.set(pan.current.x, pan.current.y, 2);
    ortho.zoom = fit * zoomMul.current;
    ortho.updateProjectionMatrix();
  });

  return null;
}
