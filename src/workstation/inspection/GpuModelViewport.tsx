import React, { Suspense, useEffect, useMemo, useState } from 'react';
import './threeCompat';
import { Canvas, useLoader } from '@react-three/fiber';
import { Center, Environment, Html, OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { getDisplayDpr } from '../../lib/displayDpr';

type ModelSceneProps = { url: string; kind: 'gltf' | 'obj' | 'stl' };

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

function GltfScene({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  useEffect(() => { prepareMaterials(scene); }, [scene]);
  return (
    <Center>
      <primitive object={scene} />
    </Center>
  );
}

function ObjScene({ url }: { url: string }) {
  const obj = useLoader(OBJLoader, url);
  useEffect(() => {
    obj.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (!mesh.material || (mesh.material as THREE.Material).type === 'MeshBasicMaterial') {
        mesh.material = new THREE.MeshStandardMaterial({ color: '#c8ccd4', metalness: 0.15, roughness: 0.55 });
      }
    });
    prepareMaterials(obj);
  }, [obj]);
  return (
    <Center>
      <primitive object={obj} />
    </Center>
  );
}

function StlScene({ url }: { url: string }) {
  const geometry = useLoader(STLLoader, url);
  useEffect(() => {
    geometry.computeVertexNormals();
  }, [geometry]);
  return (
    <Center>
      <mesh geometry={geometry}>
        <meshStandardMaterial color="#9aa3b2" metalness={0.2} roughness={0.45} side={THREE.DoubleSide} />
      </mesh>
    </Center>
  );
}

function ModelScene({ url, kind }: ModelSceneProps) {
  if (kind === 'obj') return <ObjScene url={url} />;
  if (kind === 'stl') return <StlScene url={url} />;
  return <GltfScene url={url} />;
}

function detectKind(src: string): ModelSceneProps['kind'] {
  const path = src.split('?')[0].toLowerCase();
  if (path.endsWith('.obj') || path.includes('.obj')) return 'obj';
  if (path.endsWith('.stl') || path.includes('.stl')) return 'stl';
  return 'gltf';
}

type GpuModelViewportProps = {
  src: string;
  title?: string;
};

export default function GpuModelViewport({ src, title }: GpuModelViewportProps) {
  const [failed, setFailed] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const kind = useMemo(() => detectKind(src), [src]);

  if (!src || failed) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-xs text-gray-500 p-4 text-center">
        <span>3D preview unavailable</span>
        {title ? <span className="text-[10px] text-gray-600 truncate max-w-full">{title}</span> : null}
      </div>
    );
  }

  return (
    <div className="bndz-gpu-viewport bndz-model-viewport group relative w-full h-full min-h-0">
      <Canvas
        key={`${canvasKey}:${kind}:${src}`}
        dpr={getDisplayDpr()}
        camera={{ position: [2.4, 1.8, 3.2], fov: 42, near: 0.01, far: 2000 }}
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
        <Suspense fallback={<Html center><span className="text-xs text-gray-400 animate-pulse">Loading model…</span></Html>}>
          <ModelScene url={src} kind={kind} />
        </Suspense>
        <Environment preset="studio" environmentIntensity={0.45} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.06} minDistance={0.05} maxDistance={200} />
      </Canvas>
      <div className="absolute left-2 bottom-2 text-[10px] text-white/45 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
        Drag to orbit · scroll to zoom · {kind.toUpperCase()}
      </div>
      {title ? <span className="sr-only">{title}</span> : null}
    </div>
  );
}
