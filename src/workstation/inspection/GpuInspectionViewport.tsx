import React, { useEffect, useMemo, useRef, useState } from 'react';
import './threeCompat';
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import OrthoCameraController from './OrthoCameraController';
import { histogramFrag, loupeFrag, passthroughFrag, passthroughVert } from './shaders/inspectionShaders';
import { getDisplayDpr } from '../../lib/displayDpr';
import type { InspectionShaderMode } from './InspectionViewportRouter';

type SceneProps = {
  src: string;
  shaderMode: InspectionShaderMode;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  baseZoomRef: React.MutableRefObject<number>;
  planeHalfRef: React.MutableRefObject<{ x: number; y: number }>;
  onZoomChange: (z: number) => void;
};

/**
 * R3F orthographic camera: left/right = ±width/2 (pixel units).
 * Visible world width = size.width / zoom → fit zoom = size.width / planeW.
 * NEVER floor to a tiny constant — that makes the plane a speck and pan flies away.
 */
function FitCamera({
  texture,
  baseZoomRef,
  planeHalfRef,
}: {
  texture: THREE.Texture;
  baseZoomRef: React.MutableRefObject<number>;
  planeHalfRef: React.MutableRefObject<{ x: number; y: number }>;
}) {
  const { camera, size, invalidate } = useThree();

  useEffect(() => {
    const img = texture.image as { width?: number; height?: number } | undefined;
    const iw = Math.max(1, img?.width || 1);
    const ih = Math.max(1, img?.height || 1);
    const maxDim = Math.max(iw, ih);
    const planeW = (iw / maxDim) * 2;
    const planeH = (ih / maxDim) * 2;
    planeHalfRef.current = { x: planeW / 2, y: planeH / 2 };

    // Wait for a real viewport — fitting at 0×0 stamps zoom≈0.2 and shrinks to a dot.
    if (size.width < 16 || size.height < 16) return;

    const fitZoom = Math.min(size.width / planeW, size.height / planeH) * 0.92;
    if (!Number.isFinite(fitZoom) || fitZoom < 1) return;

    baseZoomRef.current = fitZoom;
    const ortho = camera as THREE.OrthographicCamera;
    ortho.position.set(0, 0, 2);
    ortho.zoom = fitZoom;
    ortho.updateProjectionMatrix();
    invalidate();
  }, [texture, size.width, size.height, camera, invalidate, baseZoomRef, planeHalfRef]);

  return null;
}

function InspectionPlane({
  src,
  shaderMode,
  viewportRef,
  baseZoomRef,
  planeHalfRef,
  onZoomChange,
}: SceneProps) {
  const texture = useLoader(THREE.TextureLoader, src);
  const { size, invalidate, camera } = useThree();
  const mouse = useMemo(() => new THREE.Vector2(0.5, 0.5), []);

  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    invalidate();
  }, [texture, invalidate]);

  const material = useMemo(() => {
    const frag = shaderMode === 'histogram' ? histogramFrag : shaderMode === 'loupe' ? loupeFrag : passthroughFrag;
    return new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uResolution: { value: new THREE.Vector2(size.width, size.height) },
        uMouse: { value: mouse },
        uZoom: { value: 3.0 },
      },
      vertexShader: passthroughVert,
      fragmentShader: frag,
      toneMapped: false,
    });
  }, [texture, shaderMode, mouse]);

  useEffect(() => {
    material.uniforms.uMap.value = texture;
    material.uniforms.uResolution.value.set(size.width, size.height);
    invalidate();
  }, [material, texture, size.width, size.height, invalidate]);

  const img = texture.image as { width?: number; height?: number } | undefined;
  const iw = Math.max(1, img?.width || 1);
  const ih = Math.max(1, img?.height || 1);
  const maxDim = Math.max(iw, ih);
  const planeW = (iw / maxDim) * 2;
  const planeH = (ih / maxDim) * 2;

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      // Map viewport CSS → plane UV through ortho pan/zoom (not raw screen UV).
      const ortho = camera as THREE.OrthographicCamera;
      const z = ortho.zoom > 0 ? ortho.zoom : Math.max(1, baseZoomRef.current);
      const worldX = ortho.position.x + (e.clientX - r.left - r.width / 2) / z;
      const worldY = ortho.position.y - (e.clientY - r.top - r.height / 2) / z;
      mouse.x = worldX / planeW + 0.5;
      mouse.y = worldY / planeH + 0.5;
      material.uniforms.uMouse.value = mouse;
      invalidate();
    };
    el.addEventListener('mousemove', onMove);
    return () => el.removeEventListener('mousemove', onMove);
  }, [material, mouse, viewportRef, invalidate, planeW, planeH, baseZoomRef, camera]);

  return (
    <>
      <FitCamera texture={texture} baseZoomRef={baseZoomRef} planeHalfRef={planeHalfRef} />
      <OrthoCameraController
        baseZoomRef={baseZoomRef}
        planeHalfRef={planeHalfRef}
        onZoomChange={onZoomChange}
      />
      <mesh>
        <planeGeometry args={[planeW, planeH]} />
        <primitive object={material} attach="material" />
      </mesh>
    </>
  );
}

type Props = {
  src: string;
  alt?: string;
  shaderMode?: InspectionShaderMode;
  onFailed?: () => void;
};

export default function GpuInspectionViewport({ src, alt, shaderMode = 'passthrough', onFailed }: Props) {
  const [zoomPct, setZoomPct] = useState(100);
  const [failed, setFailed] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const baseZoomRef = useRef(1);
  const planeHalfRef = useRef({ x: 1, y: 1 });
  const fitZoomAtStart = useRef(1);

  useEffect(() => {
    if (failed) onFailed?.();
  }, [failed, onFailed]);

  useEffect(() => {
    setFailed(false);
    baseZoomRef.current = 1;
    fitZoomAtStart.current = 1;
    setZoomPct(100);
    setCanvasKey(k => k + 1);
  }, [src, shaderMode]);

  if (!src || failed) {
    return (
      <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
        GPU preview unavailable
      </div>
    );
  }

  return (
    <div ref={viewportRef} className="bndz-gpu-viewport group relative w-full h-full min-h-0">
      <Canvas
        key={canvasKey}
        orthographic
        frameloop="demand"
        camera={{ position: [0, 0, 2], zoom: 1, near: 0.1, far: 10 }}
        dpr={getDisplayDpr()}
        gl={{
          powerPreference: 'high-performance',
          antialias: false,
          stencil: false,
          depth: false,
          failIfMajorPerformanceCaveat: false,
          preserveDrawingBuffer: false,
        }}
        onCreated={({ gl, invalidate }) => {
          const canvas = gl.domElement;
          const onLost = (e: Event) => {
            // Do NOT dispose — that leaves a dead black/empty canvas and blocks restore.
            e.preventDefault();
          };
          const onRestored = () => {
            setFailed(false);
            setCanvasKey(k => k + 1);
            invalidate();
          };
          canvas.addEventListener('webglcontextlost', onLost, false);
          canvas.addEventListener('webglcontextrestored', onRestored, false);
          invalidate();
        }}
        onError={() => setFailed(true)}
      >
        <color attach="background" args={['#0a0a0c']} />
        <React.Suspense fallback={null}>
          <InspectionPlane
            src={src}
            shaderMode={shaderMode}
            viewportRef={viewportRef}
            baseZoomRef={baseZoomRef}
            planeHalfRef={planeHalfRef}
            onZoomChange={mul => {
              if (fitZoomAtStart.current <= 1 && baseZoomRef.current > 1) {
                fitZoomAtStart.current = baseZoomRef.current;
              }
              const base = fitZoomAtStart.current > 1 ? fitZoomAtStart.current : baseZoomRef.current;
              const pct = base > 0 ? Math.round((baseZoomRef.current * mul) / base * 100) : Math.round(mul * 100);
              setZoomPct(pct);
            }}
          />
        </React.Suspense>
      </Canvas>
      <div className="absolute left-2 bottom-2 text-[10px] text-white/50 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
        {zoomPct}%
      </div>
      {alt ? <span className="sr-only">{alt}</span> : null}
    </div>
  );
}
