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
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico', 'tif', 'tiff', 'avif', 'heic', 'heif',
  'psd', 'xcf', 'raw', 'cr2', 'nef', 'dng', 'exr', 'hdr', 'apng', 'jfif',
]);

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
