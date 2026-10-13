import React, { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './threeCompat';
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { Html, OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import BndzErrorBoundary from '../../components/BndzErrorBoundary';
import {
  computeModelFraming,
  MAX_POLAR_ANGLE,
  MIN_POLAR_ANGLE,
  type ModelFraming,
} from '../../lib/modelViewportFraming';

type ModelKind = 'gltf' | 'obj' | 'stl' | 'fbx' | 'dae' | 'ply';
type ModelSceneProps = { url: string; kind: ModelKind };

/** Minimal surface of drei/three-stdlib OrbitControls we drive for framing + reset. */
type OrbitLike = THREE.EventDispatcher<{ start: object; change: object; end: object }> & {
  target: THREE.Vector3;
  object: THREE.Camera;
  minDistance: number;
  maxDistance: number;
  enableDamping: boolean;
  update: () => boolean;
};

const FOV = 42;

function prepareMaterials(root: THREE.Object3D) {
  root.traverse(obj => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      mat.side = THREE.DoubleSide;
      if ('envMapIntensity' in mat) (mat as THREE.MeshStandardMaterial).envMapIntensity = 0.85;
    }
  });
}

function ensureStandardMaterials(root: THREE.Object3D, color = '#c8ccd4') {
  root.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.material || (mesh.material as THREE.Material).type === 'MeshBasicMaterial') {
      mesh.material = new THREE.MeshStandardMaterial({ color, metalness: 0.15, roughness: 0.55 });
    }
  });
  prepareMaterials(root);
}

function GltfScene({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  useEffect(() => { prepareMaterials(scene); }, [scene]);
  // Blob URLs are one-shot -- drop the parsed scene from the loader cache when the preview moves on.
  useEffect(() => () => { useGLTF.clear(url); }, [url]);
  return <primitive object={scene} />;
}

function ObjScene({ url }: { url: string }) {
  const obj = useLoader(OBJLoader, url);
  useEffect(() => { ensureStandardMaterials(obj); }, [obj]);
  useEffect(() => () => { useLoader.clear(OBJLoader, url); }, [url]);
  return <primitive object={obj} />;
}

function StlScene({ url }: { url: string }) {
  const geometry = useLoader(STLLoader, url);
  useMemo(() => { geometry.computeVertexNormals(); }, [geometry]);
  useEffect(() => () => { useLoader.clear(STLLoader, url); }, [url]);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#9aa3b2" metalness={0.2} roughness={0.45} side={THREE.DoubleSide} />
    </mesh>
  );
}

function FbxScene({ url }: { url: string }) {
  const fbx = useLoader(FBXLoader, url);
  useEffect(() => { ensureStandardMaterials(fbx, '#b7c0cc'); }, [fbx]);
  useEffect(() => () => { useLoader.clear(FBXLoader, url); }, [url]);
  return <primitive object={fbx} />;
}

function DaeScene({ url }: { url: string }) {
  const collada = useLoader(ColladaLoader, url);
  useEffect(() => { ensureStandardMaterials(collada.scene, '#b7c0cc'); }, [collada]);
  useEffect(() => () => { useLoader.clear(ColladaLoader, url); }, [url]);
  return <primitive object={collada.scene} />;
}

function PlyScene({ url }: { url: string }) {
  const geometry = useLoader(PLYLoader, url);
  useMemo(() => { geometry.computeVertexNormals(); }, [geometry]);
  useEffect(() => () => { useLoader.clear(PLYLoader, url); }, [url]);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#9aa3b2" metalness={0.18} roughness={0.5} side={THREE.DoubleSide} />
    </mesh>
  );
}

function ModelScene({ url, kind }: ModelSceneProps) {
  if (kind === 'obj') return <ObjScene url={url} />;
  if (kind === 'stl') return <StlScene url={url} />;
  if (kind === 'fbx') return <FbxScene url={url} />;
  if (kind === 'dae') return <DaeScene url={url} />;
  if (kind === 'ply') return <PlyScene url={url} />;
  return <GltfScene url={url} />;
}

function detectKind(src: string): ModelKind {
  // Prefer the path basename so cached RAGE GLBs (.../hash_name.glb) never fall through wrongly.
  const path = (src.split('?')[0] || '').toLowerCase();
  const base = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path.includes('\\') ? path.slice(path.lastIndexOf('\\') + 1) : path;
  if (base.endsWith('.glb') || base.endsWith('.gltf')) return 'gltf';
  if (base.endsWith('.obj')) return 'obj';
  if (base.endsWith('.stl')) return 'stl';
  if (base.endsWith('.fbx')) return 'fbx';
  if (base.endsWith('.dae')) return 'dae';
  if (base.endsWith('.ply')) return 'ply';
  // Encoded stream URLs may keep the extension mid-path
  if (path.includes('.glb') || path.includes('.gltf')) return 'gltf';
  if (path.includes('.obj')) return 'obj';
  if (path.includes('.stl')) return 'stl';
  if (path.includes('.fbx')) return 'fbx';
  if (path.includes('.dae')) return 'dae';
  if (path.includes('.ply')) return 'ply';
  return 'gltf';
}

/** Document interface scale is CSS `zoom` on <html> (settingsRuntime) -- devicePixelRatio ignores it. */
function documentZoom(): number {
  if (typeof document === 'undefined') return 1;
  const z = parseFloat(document.documentElement.style.zoom || '1');
  return Number.isFinite(z) && z > 0 ? z : 1;
}

function effectiveDpr(): number {
  if (typeof window === 'undefined') return 1;
  return Math.min(2, Math.max(1, (window.devicePixelRatio || 1) * documentZoom()));
}

/**
 * Keep the drawing buffer crisp when the window moves to another monitor or the interface
 * scale changes. Drives the Canvas `dpr` prop: R3F re-applies that prop on every resize, so a
 * one-off setDpr() from inside the scene would be reset to the mount-time value.
 */
function useEffectiveDpr(): number {
  const [dpr, setDpr] = useState(effectiveDpr);
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    const apply = () => {
      setDpr(effectiveDpr());
      mq?.removeEventListener('change', apply);
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      mq.addEventListener('change', apply);
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => {
      mq?.removeEventListener('change', apply);
      mo.disconnect();
    };
  }, []);
  return dpr;
}

/**
 * Neutral studio reflections generated on the GPU from three's RoomEnvironment.
 * Replaces drei `<Environment preset="studio">`, which fetched an HDR from raw.githack.com at
 * runtime: offline it failed the whole viewport, and while it downloaded it suspended the
 * Canvas root (OrbitControls included), so the orbit gimbal did not respond.
 */
function StudioEnvironment({ intensity = 0.45 }: { intensity?: number }) {
  const gl = useThree(s => s.gl);
  const scene = useThree(s => s.scene);
  const invalidate = useThree(s => s.invalidate);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    room.dispose();
    scene.environment = target.texture;
    scene.environmentIntensity = intensity;
    invalidate();
    return () => {
      if (scene.environment === target.texture) scene.environment = null;
      target.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, intensity, invalidate]);
  return null;
}

type FrameHandle = { reset: () => void };

/**
 * Centres the loaded model on the orbit pivot and frames it to its bounds.
 * - pivot = bounding-box centre (OrbitControls.target), not the file's origin
 * - distance / near / far / zoom limits scale with the model (props to 400 m map collision)
 * - panel resize re-frames until the user touches the gimbal; afterwards their view is kept
 */
function FramedModel({ children, handleRef }: { children: React.ReactNode; handleRef: React.MutableRefObject<FrameHandle | null> }) {
  const group = useRef<THREE.Group>(null);
  const camera = useThree(s => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree(s => s.controls) as unknown as OrbitLike | null;
  const width = useThree(s => s.size.width);
  const height = useThree(s => s.size.height);
  const invalidate = useThree(s => s.invalidate);
  const [box, setBox] = useState<THREE.Box3 | null>(null);
  const userMovedRef = useRef(false);

  // Measure after the model's geometry is in the scene graph; recentre to the origin.
  useLayoutEffect(() => {
    const g = group.current;
    if (!g) return;
    g.position.set(0, 0, 0);
    g.updateWorldMatrix(true, true);
    const b = new THREE.Box3().setFromObject(g, true);
    if (b.isEmpty()) {
      setBox(new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5)));
      return;
    }
    const center = b.getCenter(new THREE.Vector3());
    g.position.copy(center).negate();
    g.updateWorldMatrix(true, true);
    b.translate(center.negate());
    setBox(b);
  }, [children]);

  const apply = useCallback((f: ModelFraming) => {
    camera.fov = FOV;
    camera.near = f.near;
    camera.far = f.far;
    camera.updateProjectionMatrix();
    if (controls) {
      // Kill residual damping momentum so a reset lands exactly on the home view.
      const damping = controls.enableDamping;
      controls.enableDamping = false;
      controls.update();
      camera.position.set(...f.position);
      controls.target.set(...f.target);
      controls.minDistance = f.minDistance;
      controls.maxDistance = f.maxDistance;
      controls.update();
      controls.enableDamping = damping;
    } else {
      camera.position.set(...f.position);
      camera.lookAt(...f.target);
    }
    invalidate();
  }, [camera, controls, invalidate]);

  const frame = useCallback(() => {
    if (!box) return;
    const aspect = height > 0 ? width / height : 1;
    apply(computeModelFraming(box.min.toArray() as [number, number, number], box.max.toArray() as [number, number, number], FOV, aspect));
  }, [box, width, height, apply]);

  // First frame + resize-follow until the user grabs the gimbal.
  useEffect(() => {
    if (!box || userMovedRef.current) return;
    frame();
  }, [box, controls, width, height, frame]);

  // Test-harness probe (scripts/test-model-viewport-render.mjs). Inert unless the flag is set.
  useEffect(() => {
    const w = window as Window & { __BNDZ_MODEL_DEBUG__?: boolean; __bndzModelViewportProbe?: () => unknown };
    if (!w.__BNDZ_MODEL_DEBUG__ || !box) return;
    w.__bndzModelViewportProbe = () => {
      const t = controls?.target ?? new THREE.Vector3();
      const offset = camera.position.clone().sub(t);
      return {
        framed: true,
        target: t.toArray(),
        position: camera.position.toArray(),
        up: camera.up.toArray(),
        distance: offset.length(),
        polar: Math.acos(Math.min(1, Math.max(-1, offset.y / Math.max(offset.length(), 1e-12)))),
        azimuth: Math.atan2(offset.x, offset.z),
        near: camera.near,
        far: camera.far,
        box: { min: box.min.toArray(), max: box.max.toArray() },
        size: { width, height },
      };
    };
    return () => { delete w.__bndzModelViewportProbe; };
  }, [box, camera, controls, width, height]);

  useEffect(() => {
    if (!controls) return;
    const onStart = () => { userMovedRef.current = true; };
    controls.addEventListener('start', onStart);
    return () => controls.removeEventListener('start', onStart);
  }, [controls]);

  useEffect(() => {
    handleRef.current = {
      reset: () => {
        userMovedRef.current = false;
        frame();
      },
    };
    return () => { handleRef.current = null; };
  }, [frame, handleRef]);

  return <group ref={group}>{children}</group>;
}

type GpuModelViewportProps = {
  src: string;
  title?: string;
  badge?: string;
};

export default function GpuModelViewport({ src, title, badge }: GpuModelViewportProps) {
  const [failed, setFailed] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const kind = useMemo(() => detectKind(src), [src]);
  const frameHandle = useRef<FrameHandle | null>(null);
  const dpr = useEffectiveDpr();

  useEffect(() => { setFailed(false); }, [src]);

  if (!src || failed) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-xs text-gray-500 p-4 text-center">
        <span>3D preview unavailable</span>
        {title ? <span className="text-[10px] text-gray-600 truncate max-w-full">{title}</span> : null}
      </div>
    );
  }

  return (
    <div
      className="bndz-gpu-viewport bndz-model-viewport group relative w-full h-full min-h-0"
      onDoubleClick={e => {
        // Reset the gimbal to the framed home view; never bubble to the preview's open-file handler.
        e.stopPropagation();
        frameHandle.current?.reset();
      }}
    >
      <BndzErrorBoundary
        isolate
        label="3D preview"
        resetKey={src}
        onError={() => setFailed(true)}
        fallback={
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-xs text-gray-500 p-4 text-center">
            <span>3D preview unavailable</span>
            {title ? <span className="text-[10px] text-gray-600 truncate max-w-full">{title}</span> : null}
          </div>
        }
      >
        <Canvas
          key={`${canvasKey}:${kind}:${src}`}
          dpr={dpr}
          frameloop="demand"
          // offsetSize: layout size, not getBoundingClientRect -- the document's interface-scale
          // CSS zoom otherwise oversizes the canvas and pushes the orbit pivot off-centre.
          resize={{ offsetSize: true, scroll: false, debounce: { scroll: 0, resize: 0 } }}
          camera={{ position: [2.4, 1.8, 3.2], fov: FOV, near: 0.01, far: 2000 }}
          gl={{
            antialias: true,
            powerPreference: 'high-performance',
            alpha: false,
            stencil: false,
            failIfMajorPerformanceCaveat: false,
          }}
          onCreated={({ gl, invalidate }) => {
            const canvas = gl.domElement;
            const onLost = (e: Event) => { e.preventDefault(); };
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
          <ambientLight intensity={0.55} />
          <directionalLight position={[6, 10, 4]} intensity={1.15} castShadow={false} />
          <directionalLight position={[-4, 2, -6]} intensity={0.35} />
          <StudioEnvironment intensity={0.45} />
          <Suspense fallback={<Html center><span className="text-xs text-gray-400 animate-pulse">Loading model...</span></Html>}>
            <FramedModel handleRef={frameHandle}>
              <ModelScene url={src} kind={kind} />
            </FramedModel>
          </Suspense>
          <OrbitControls
            makeDefault
            enableDamping
            dampingFactor={0.08}
            rotateSpeed={0.85}
            zoomSpeed={0.9}
            panSpeed={0.9}
            screenSpacePanning
            minPolarAngle={MIN_POLAR_ANGLE}
            maxPolarAngle={MAX_POLAR_ANGLE}
          />
        </Canvas>
      </BndzErrorBoundary>
      <div className="absolute left-2 right-2 bottom-2 truncate text-[10px] text-white/45 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
        Drag to orbit | scroll to zoom | double-click to reset | {(badge || kind).toUpperCase()}
      </div>
      {title ? <span className="sr-only">{title}</span> : null}
    </div>
  );
}
