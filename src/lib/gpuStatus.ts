/**
 * Honest GPU / compositor status for BNDZ Perf HUD.
 * Classifies Chromium ANGLE / WebGL renderer strings and host CDP SystemInfo.
 * Does not strip UI — only reports whether paint is on the user's GPU.
 */

export type GpuCompositing = 'gpu' | 'software' | 'unknown';

export type GpuStatus = {
  hardwareAccelerated: boolean | null;
  compositing: GpuCompositing;
  renderer: string;
  vendor: string;
  adapter: string;
  angleBackend: string;
  featureStatus: Record<string, string>;
  source: 'cdp' | 'webgl' | 'merged' | 'unavailable';
  flagsRequested: string[];
  detail: string;
};

const FLAGS_REQUESTED = [
  '--enable-gpu',
  '--enable-gpu-rasterization',
  '--enable-gpu-compositing',
  '--enable-zero-copy',
  'CanvasOopRasterization',
  '--disable-frame-rate-limit',
  '--ignore-gpu-blocklist',
];

const SOFTWARE_MARKERS = [
  'swiftshader',
  'llvmpipe',
  'softpipe',
  'microsoft basic render driver',
  'gdi generic',
  'cpu rasterizer',
  'software',
];

const ANGLE_BACKENDS = [
  { re: /direct3d12|d3d12/i, name: 'Direct3D12' },
  { re: /direct3d11|d3d11/i, name: 'Direct3D11' },
  { re: /direct3d9|d3d9/i, name: 'Direct3D9' },
  { re: /vulkan/i, name: 'Vulkan' },
  { re: /metal/i, name: 'Metal' },
  { re: /opengl|opengles|gl es/i, name: 'OpenGL' },
  { re: /swiftshader/i, name: 'SwiftShader' },
];

function classifyRenderer(renderer: string, vendor = ''): {
  hardwareAccelerated: boolean | null;
  compositing: GpuCompositing;
  angleBackend: string;
  detail: string;
} {
  const blob = `${vendor} ${renderer}`.toLowerCase();
  if (!blob.trim()) {
    return {
      hardwareAccelerated: null,
      compositing: 'unknown',
      angleBackend: '',
      detail: 'No GPU renderer string available',
    };
  }

  const angleBackend = ANGLE_BACKENDS.find(b => b.re.test(renderer))?.name ?? '';
  const isSoftware = SOFTWARE_MARKERS.some(m => blob.includes(m))
    || angleBackend === 'SwiftShader';

  if (isSoftware) {
    return {
      hardwareAccelerated: false,
      compositing: 'software',
      angleBackend: angleBackend || 'software',
      detail: 'Software rasterizer / Basic Render Driver — not using discrete/iGPU',
    };
  }

  const looksHardware =
    /nvidia|amd|radeon|intel|qualcomm|apple|adreno|geforce|rtx|gtx|arc\b|iris|uhd graphics|radeon/i.test(blob)
    || /direct3d1[12]|d3d1[12]|vulkan|metal/i.test(renderer);

  if (looksHardware) {
    return {
      hardwareAccelerated: true,
      compositing: 'gpu',
      angleBackend: angleBackend || 'GPU',
      detail: angleBackend
        ? `GPU compositing via ANGLE ${angleBackend}`
        : 'GPU adapter detected via WebGL/CDP',
    };
  }

  return {
    hardwareAccelerated: null,
    compositing: 'unknown',
    angleBackend,
    detail: 'Renderer present but hardware/software unclear',
  };
}

function probeWebGlRenderer(): { renderer: string; vendor: string } {
  if (typeof document === 'undefined') return { renderer: '', vendor: '' };
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return { renderer: '', vendor: '' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info') as {
      UNMASKED_RENDERER_WEBGL: number;
      UNMASKED_VENDOR_WEBGL: number;
    } | null;
    if (!ext) {
      return {
        renderer: String(gl.getParameter(gl.RENDERER) || ''),
        vendor: String(gl.getParameter(gl.VENDOR) || ''),
      };
    }
    return {
      renderer: String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || ''),
      vendor: String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) || ''),
    };
  } catch {
    return { renderer: '', vendor: '' };
  }
}

function featureEnabled(status: Record<string, string>, key: string): boolean | null {
  const v = (status[key] || status[key.replace(/_/g, '')] || '').toLowerCase();
  if (!v) return null;
  if (v.includes('disabled') || v.includes('unavailable') || v.includes('software')) return false;
  if (v.includes('enabled') || v === 'hardware_accelerated') return true;
  return null;
}

/** Client-only WebGL classification (works in browser and WebView2). */
export function probeClientGpuStatus(): GpuStatus {
  const { renderer, vendor } = probeWebGlRenderer();
  const classified = classifyRenderer(renderer, vendor);
  return {
    hardwareAccelerated: classified.hardwareAccelerated,
    compositing: classified.compositing,
    renderer,
    vendor,
    adapter: renderer,
    angleBackend: classified.angleBackend,
    featureStatus: {},
    source: renderer ? 'webgl' : 'unavailable',
    flagsRequested: FLAGS_REQUESTED,
    detail: classified.detail,
  };
}

type HostGpuPayload = {
  hardwareAccelerated?: boolean | null;
  compositing?: string;
  renderer?: string;
  vendor?: string;
  adapter?: string;
  angleBackend?: string;
  featureStatus?: Record<string, string>;
  detail?: string;
  ok?: boolean;
  error?: string;
};

/** Merge host CDP SystemInfo with client WebGL for a single honest report. */
export function mergeGpuStatus(host: HostGpuPayload | null | undefined, client = probeClientGpuStatus()): GpuStatus {
  if (!host || host.ok === false) {
    return {
      ...client,
      detail: host?.error
        ? `${client.detail} (host CDP: ${host.error})`
        : client.detail,
    };
  }

  const featureStatus = host.featureStatus && typeof host.featureStatus === 'object'
    ? host.featureStatus
    : {};
  const renderer = (host.renderer || host.adapter || client.renderer || '').trim();
  const vendor = (host.vendor || client.vendor || '').trim();
  const adapter = (host.adapter || renderer || '').trim();
  const fromStrings = classifyRenderer(renderer || client.renderer, vendor || client.vendor);

  const gpuCompositing = featureEnabled(featureStatus, 'gpu_compositing');
  const rasterization = featureEnabled(featureStatus, 'rasterization');
  const webgl = featureEnabled(featureStatus, 'webgl');

  let compositing: GpuCompositing = fromStrings.compositing;
  let hardwareAccelerated = fromStrings.hardwareAccelerated;

  if (gpuCompositing === false || rasterization === false) {
    compositing = 'software';
    hardwareAccelerated = false;
  } else if (gpuCompositing === true || (fromStrings.hardwareAccelerated && webgl !== false)) {
    compositing = 'gpu';
    hardwareAccelerated = true;
  } else if (typeof host.hardwareAccelerated === 'boolean') {
    hardwareAccelerated = host.hardwareAccelerated;
    compositing = host.hardwareAccelerated ? 'gpu' : 'software';
  }

  const angleBackend = host.angleBackend || fromStrings.angleBackend || client.angleBackend;
  const detailParts = [
    host.detail || fromStrings.detail,
    gpuCompositing === true ? 'CDP gpu_compositing=enabled' : null,
    gpuCompositing === false ? 'CDP gpu_compositing disabled' : null,
  ].filter(Boolean);

  return {
    hardwareAccelerated,
    compositing,
    renderer: renderer || client.renderer,
    vendor: vendor || client.vendor,
    adapter,
    angleBackend,
    featureStatus,
    source: renderer && client.renderer ? 'merged' : (renderer ? 'cdp' : client.source),
    flagsRequested: FLAGS_REQUESTED,
    detail: detailParts.join(' · ') || fromStrings.detail,
  };
}

export function formatGpuHudLine(status: GpuStatus): string {
  if (status.compositing === 'gpu' && status.hardwareAccelerated) {
    const backend = status.angleBackend ? ` ${status.angleBackend}` : '';
    return `GPU${backend}`;
  }
  if (status.compositing === 'software' || status.hardwareAccelerated === false) {
    return 'SOFTWARE';
  }
  return 'unknown';
}
