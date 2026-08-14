/** Shared audio/video extension detection and MIME mapping for preview + media player */

export const AUDIO_EXTENSIONS = new Set([
  'mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'wma', 'opus', 'aiff', 'aif', 'mid', 'midi',
  'ape', 'wv', 'mpc', 'ra', 'rm', 'ac3', 'dts', 'caf', 'mka',
]);

export const VIDEO_EXTENSIONS = new Set([
  'mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'm4v', 'mpg', 'mpeg', '3gp', 'ts', 'm2ts',
  'flv', 'f4v', 'vob', 'ogv', 'divx', 'asf', 'rm', 'rmvb', 'mts',
]);

export const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'svgz', 'webp', 'ico', 'icon', 'cur', 'ani',
  'tif', 'tiff', 'avif', 'heic', 'heif', 'jfif', 'jxl', 'jxr', 'wdp',
  'psd', 'psb', 'xcf', 'raw', 'arw', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'dng', 'orf', 'raf',
  'rw2', 'pef', 'srw', 'x3f', 'exr', 'hdr', 'apng', 'dds', 'tga', 'pcx', 'pbm', 'pgm', 'ppm', 'pnm',
  'jp2', 'j2k', 'jpf', 'jpx', 'emf', 'wmf', 'qoi', 'icns',
]);

/** 3D mesh / scene formats — previewed via WebGL (GLB/GLTF primary). */
export const MODEL_EXTENSIONS = new Set([
  'glb', 'gltf', 'obj', 'stl', 'fbx', 'dae', 'ply', 'usdz', '3ds', 'blend',
  // Rockstar RAGE / GTA V · FiveM loose assets (host converts → OBJ for WebGL)
  'ydr', 'ybn', 'ydd', 'yft', 'ycd', 'ytd', 'ymap', 'ytyp',
]);

/** Formats that Three.js can load directly from a URL. */
export const GPU_NATIVE_MODEL_EXTENSIONS = new Set([
  'glb', 'gltf', 'obj', 'stl', 'fbx', 'dae', 'ply',
]);

/** RAGE assets that need host-side mesh extraction before WebGL. */
export const RAGE_CONVERT_MODEL_EXTENSIONS = new Set([
  'ydr', 'ybn', 'ydd', 'yft',
]);

export function isModelExt(ext: string): boolean {
  return MODEL_EXTENSIONS.has(ext.toLowerCase().replace(/^\./, ''));
}

export function isGpuNativeModelExt(ext: string): boolean {
  return GPU_NATIVE_MODEL_EXTENSIONS.has(ext.toLowerCase().replace(/^\./, ''));
}

export function isRageConvertModelExt(ext: string): boolean {
  return RAGE_CONVERT_MODEL_EXTENSIONS.has(ext.toLowerCase().replace(/^\./, ''));
}

/** Executables / installers — ShellExecute only; never Quick Look or heavy metadata. */
export const SHELL_ACTIVATE_EXTENSIONS = new Set([
  'exe', 'msi', 'msp', 'com', 'scr', 'bat', 'cmd', 'ps1', 'cpl', 'msc',
  'application', 'gadget', 'hta', 'dll', 'sys', 'drv', 'ocx',
]);

export function isShellActivateExt(ext: string): boolean {
  return SHELL_ACTIVATE_EXTENSIONS.has(ext.toLowerCase().replace(/^\./, ''));
}

export function isAudioExt(ext: string): boolean {
  return AUDIO_EXTENSIONS.has(ext.toLowerCase().replace(/^\./, ''));
}

export function isVideoExt(ext: string): boolean {
  return VIDEO_EXTENSIONS.has(ext.toLowerCase().replace(/^\./, ''));
}

export function isImageExt(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext.toLowerCase().replace(/^\./, ''));
}

export function getMimeType(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, '');
  const map: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    wma: 'audio/x-ms-wma',
    opus: 'audio/opus',
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
    mov: 'video/quicktime',
    wmv: 'video/x-ms-wmv',
    mpg: 'video/mpeg',
    mpeg: 'video/mpeg',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    pdf: 'application/pdf',
  };
  return map[e] || 'application/octet-stream';
}
