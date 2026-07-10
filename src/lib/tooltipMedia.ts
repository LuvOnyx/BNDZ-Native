/** Media preview resolution for premium floating tooltips. */
import { IPC } from './ipcBridge';
import { toVirtualStreamUrl } from './pathUtils';
import type { TooltipMedia } from '../components/HoverTooltip';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tif', 'tiff', 'heic', 'heif']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma']);

export type TooltipMediaKind = 'image' | 'svg' | 'audio';

export function classifyTooltipMedia(extension?: string): TooltipMediaKind | null {
  const ext = String(extension || '').toLowerCase().replace(/^\./, '');
  if (!ext) return null;
  if (ext === 'svg') return 'svg';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  return null;
}

export function shouldResolveTooltipMedia(
  kind: TooltipMediaKind | null,
  config: Record<string, any>,
): boolean {
  if (!kind) return false;
  if (kind === 'audio') return !!config.playAudioInHoverTooltips;
  return config.showMediaPreviewInTooltips !== false;
}

export async function resolveTooltipMedia(
  winPath: string,
  kind: TooltipMediaKind,
  config: Record<string, any>,
): Promise<TooltipMedia | null> {
  if (!shouldResolveTooltipMedia(kind, config)) return null;

  if (kind === 'image') {
    try {
      const b64 = await IPC.getNativeThumbnailBase64(winPath);
      if (b64) {
        return { kind: 'image', src: `data:image/png;base64,${b64}`, alt: winPath.split(/[/\\]/).pop() };
      }
    } catch { /* fall through to stream */ }
    return { kind: 'image', src: toVirtualStreamUrl(winPath), alt: winPath.split(/[/\\]/).pop() };
  }

  if (kind === 'svg') {
    return { kind: 'svg', src: toVirtualStreamUrl(winPath), alt: winPath.split(/[/\\]/).pop() };
  }

  if (kind === 'audio') {
    return {
      kind: 'audio',
      src: toVirtualStreamUrl(winPath),
      autoplay: false,
      alt: winPath.split(/[/\\]/).pop(),
    };
  }

  return null;
}
