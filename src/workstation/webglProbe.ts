let cached: boolean | null = null;

export function probeWebGL(): boolean {
  if (cached !== null) return cached;
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    cached = !!gl;
  } catch {
    cached = false;
  }
  return cached;
}

export function resetWebGLProbe() {
  cached = null;
}
