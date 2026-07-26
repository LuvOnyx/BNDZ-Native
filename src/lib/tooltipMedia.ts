/** Media preview resolution for premium floating tooltips. */
import { IPC } from './ipcBridge';
import { toVirtualStreamUrl } from './pathUtils';
import { resolveSvgInlineThumb } from './svgInlineThumb';
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
    } catch { /* no CAS — skip stream fallback (missing files 404 spam) */ }
    return null;
  }

  if (kind === 'svg') {
    try {
      const b64 = await IPC.getNativeThumbnailBase64(winPath);
      if (b64) {
        return { kind: 'image', src: `data:image/png;base64,${b64}`, alt: winPath.split(/[/\\]/).pop() };
      }
    } catch { /* fall through to inline */ }
    const inline = await resolveSvgInlineThumb(winPath);
    if (inline) {
      return { kind: 'svg', src: inline, alt: winPath.split(/[/\\]/).pop() };
    }
    return null;
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
