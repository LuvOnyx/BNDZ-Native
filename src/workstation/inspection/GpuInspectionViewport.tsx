import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import OrthoCameraController from './OrthoCameraController';
import { histogramFrag, loupeFrag, passthroughFrag, passthroughVert } from './shaders/inspectionShaders';
import type { InspectionShaderMode } from './InspectionViewportRouter';

type SceneProps = {
  src: string;
  shaderMode: InspectionShaderMode;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  baseZoomRef: React.MutableRefObject<number>;
  onZoomChange: (z: number) => void;
};

function FitCamera({
  texture,
  baseZoomRef,
}: {
  texture: THREE.Texture;
  baseZoomRef: React.MutableRefObject<number>;
}) {
  const { camera, size, invalidate } = useThree();
  useEffect(() => {
    const img = texture.image as { width?: number; height?: number } | undefined;
    const iw = img?.width || 1;
    const ih = img?.height || 1;
    const maxDim = Math.max(iw, ih);
    const planeW = (iw / maxDim) * 2;
    const planeH = (ih / maxDim) * 2;
    const fitZoom = Math.min(size.width / planeW, size.height / planeH) * 0.46;
    baseZoomRef.current = Math.max(0.12, fitZoom);
    const ortho = camera as THREE.OrthographicCamera;
    ortho.zoom = baseZoomRef.current;
    ortho.position.set(0, 0, 2);
    ortho.updateProjectionMatrix();
    invalidate();
  }, [texture, size.width, size.height, camera, invalidate, baseZoomRef]);
  return null;
}

function InspectionPlane({ src, shaderMode, viewportRef, baseZoomRef, onZoomChange }: SceneProps) {
  const texture = useLoader(THREE.TextureLoader, src);
  const { size, invalidate } = useThree();
  const mouse = useMemo(() => new THREE.Vector2(0.5, 0.5), []);

  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
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
    });
  }, [texture, shaderMode, mouse]);

  useEffect(() => {
    material.uniforms.uResolution.value.set(size.width, size.height);
    invalidate();
  }, [material, size.width, size.height, invalidate]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      mouse.x = (e.clientX - r.left) / r.width;
      mouse.y = 1 - (e.clientY - r.top) / r.height;
      material.uniforms.uMouse.value = mouse;
      invalidate();
    };
    el.addEventListener('mousemove', onMove);
    return () => el.removeEventListener('mousemove', onMove);
  }, [material, mouse, viewportRef, invalidate]);

  const img = texture.image as { width?: number; height?: number } | undefined;
  const iw = img?.width || 1;
  const ih = img?.height || 1;
  const maxDim = Math.max(iw, ih);
  const planeW = (iw / maxDim) * 2;
  const planeH = (ih / maxDim) * 2;

  return (
    <>
      <FitCamera texture={texture} baseZoomRef={baseZoomRef} />
      <OrthoCameraController baseZoomRef={baseZoomRef} onZoomChange={onZoomChange} />
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
  const [zoom, setZoom] = useState(1);
  const [failed, setFailed] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const baseZoomRef = useRef(1);

  useEffect(() => {
    if (failed) onFailed?.();
  }, [failed, onFailed]);

  useEffect(() => {
    setFailed(false);
    baseZoomRef.current = 1;
    setZoom(1);
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
        orthographic
        camera={{ position: [0, 0, 2], zoom: 1, near: 0.1, far: 10 }}
        dpr={[1, 1.5]}
        gl={{
          powerPreference: 'high-performance',
          antialias: false,
          stencil: false,
          depth: false,
        }}
        onCreated={({ gl, invalidate }) => {
          const canvas = gl.domElement;
          const onLost = (e: Event) => {
            e.preventDefault();
            setFailed(true);
          };
          canvas.addEventListener('webglcontextlost', onLost, false);
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
            onZoomChange={setZoom}
          />
        </React.Suspense>
      </Canvas>
      <div className="absolute left-2 bottom-2 text-[10px] text-white/40 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
        {(zoom * 100).toFixed(0)}%
      </div>
    </div>
  );
}
