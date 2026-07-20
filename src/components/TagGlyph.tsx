import React, { useEffect, useState } from 'react';
import { launcherIconUrl } from '../lib/toolbarLauncherIcons';

type Props = {
  color?: string;
  size?: number;
  className?: string;
  title?: string;
};

/** Module cache — build a white-on-transparent mask once from the tag PNG. */
let maskUrlPromise: Promise<string> | null = null;

function getTagMaskUrl(): Promise<string> {
  if (!maskUrlPromise) {
    const src = launcherIconUrl('tag_manager') || '/launcher-icons/tag_manager.png';
    maskUrlPromise = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('canvas'));
            return;
          }
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const d = imageData.data;
          for (let i = 0; i < d.length; i += 4) {
            const r = d[i];
            const g = d[i + 1];
            const b = d[i + 2];
            const a = d[i + 3];
            // Treat near-black as transparent background; keep shape via luminance × alpha.
            const lum = (r + g + b) / 3;
            const isBg = a < 12 || lum < 18;
            const alpha = isBg ? 0 : Math.min(255, Math.round(Math.max(a, lum * 1.15)));
            d[i] = 255;
            d[i + 1] = 255;
            d[i + 2] = 255;
            d[i + 3] = alpha;
          }
          ctx.putImageData(imageData, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('tag mask load failed'));
      img.src = src;
    });
  }
  return maskUrlPromise;
}

/**
 * Tintable tag glyph — recolors tag_manager.png per tag color via a cached alpha mask.
 */
export function TagGlyph({ color = '#FACC15', size = 14, className = '', title }: Props) {
  const [maskUrl, setMaskUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getTagMaskUrl()
      .then((url) => {
        if (active) setMaskUrl(url);
      })
      .catch(() => {
        if (active) setMaskUrl(launcherIconUrl('tag_manager') || '/launcher-icons/tag_manager.png');
      });
    return () => { active = false; };
  }, []);

  const src = maskUrl || launcherIconUrl('tag_manager') || '/launcher-icons/tag_manager.png';

  return (
    <span
      className={`inline-block shrink-0 ${className}`}
      title={title}
      role={title ? 'img' : undefined}
      aria-hidden={!title}
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        WebkitMaskImage: `url(${src})`,
        WebkitMaskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskImage: `url(${src})`,
        maskSize: 'contain',
        maskRepeat: 'no-repeat',
        maskPosition: 'center',
      }}
    />
  );
}

export default TagGlyph;
