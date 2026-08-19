import { isImageExt } from './mediaTypes';
import { toVirtualStreamUrl, toWindowsPath } from './pathUtils';

const STUDIO_IMAGE_EXT = /\.(png|apng|jpe?g|webp|gif|svg|svgz|avif|bmp|ico|jfif)$/i;

export type StudioDropImage = { dataUrl: string; name: string };

export function isStudioImagePath(path: string): boolean {
  const base = (path.split(/[/\\]/).pop() || path).split('?')[0];
  if (STUDIO_IMAGE_EXT.test(base)) return true;
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : '';
  return isImageExt(ext);
}

/** Fetch a local path (via bndz-stream) as a data URL for iframe engines. */
export async function pathToStudioDropImage(path: string): Promise<StudioDropImage | null> {
  const win = toWindowsPath(path);
  if (!win || !isStudioImagePath(win)) return null;
  const url = toVirtualStreamUrl(win);
  if (!url) return null;
  const name = win.split(/[/\\]/).pop() || 'image.png';
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('read failed'));
      reader.readAsDataURL(blob);
    });
    if (!dataUrl) return null;
    return { dataUrl, name };
  } catch {
    return null;
  }
}

export async function pathsToStudioDropImages(paths: string[], limit = 8): Promise<StudioDropImage[]> {
  const out: StudioDropImage[] = [];
  for (const p of paths) {
    if (out.length >= limit) break;
    const img = await pathToStudioDropImage(p);
    if (img) out.push(img);
  }
  return out;
}

export async function filesToStudioDropImages(files: File[], limit = 8): Promise<StudioDropImage[]> {
  const images = files.filter(
    (f) => STUDIO_IMAGE_EXT.test(f.name) || String(f.type || '').startsWith('image/'),
  );
  const out: StudioDropImage[] = [];
  for (const file of images.slice(0, limit)) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('read failed'));
      reader.readAsDataURL(file);
    });
    if (dataUrl) out.push({ dataUrl, name: file.name || 'drop.png' });
  }
  return out;
}

export function hitIsStudioSurface(clientX: number, clientY: number, roots: string[]): boolean {
  const hit = document.elementFromPoint(clientX, clientY);
  if (!hit) return false;
  return roots.some((sel) => !!hit.closest(sel));
}
