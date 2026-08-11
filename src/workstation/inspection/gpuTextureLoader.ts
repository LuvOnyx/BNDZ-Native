import * as THREE from 'three';

const pool = new Map<string, THREE.Texture>();
const order: string[] = [];
const MAX = 12;

function touch(key: string, tex: THREE.Texture) {
  const idx = order.indexOf(key);
  if (idx >= 0) order.splice(idx, 1);
  order.push(key);
  pool.set(key, tex);
  while (order.length > MAX) {
    const evict = order.shift();
    if (!evict) break;
    const old = pool.get(evict);
    old?.dispose();
    pool.delete(evict);
  }
}

export function textureKeyFromUrl(url: string): string {
  return url.slice(0, 256);
}

export async function loadGpuTexture(url: string, key = textureKeyFromUrl(url)): Promise<THREE.Texture> {
  const cached = pool.get(key);
  if (cached) {
    touch(key, cached);
    return cached;
  }
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    // Empty crossOrigin — 'anonymous' breaks bndz-stream:// custom-scheme loads.
    loader.setCrossOrigin('');
    loader.load(
      url,
      tex => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        touch(key, tex);
        resolve(tex);
      },
      undefined,
      err => reject(err),
    );
  });
}

export function releaseGpuTexture(key: string) {
  const tex = pool.get(key);
  if (tex) {
    tex.dispose();
    pool.delete(key);
    const idx = order.indexOf(key);
    if (idx >= 0) order.splice(idx, 1);
  }
}
