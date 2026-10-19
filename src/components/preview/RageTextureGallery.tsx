import React, { useEffect, useState } from 'react';
import { IPC } from '../../lib/ipcBridge';
import { toVirtualStreamUrl, toWindowsPath } from '../../lib/pathUtils';
import { Icons8Icon } from '../Icons8Icon';

type RageTexture = { name: string; width: number; height: number; format: string; path: string };

/**
 * Gallery for a RAGE texture dictionary (.ytd): the host extracts each
 * texture to a PNG (CodeWalker DDS decode), this shows one large texture
 * over a checkerboard (so transparency reads honestly) with a thumb strip
 * of the rest. Used by Quick Preview and the preview pane.
 */
export function RageTextureGallery({ path, title }: { path: string; title?: string }) {
  const [textures, setTextures] = useState<RageTexture[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTextures([]);
    setSelected(0);
    IPC.getRageTextures(toWindowsPath(path))
      .then(r => {
        if (cancelled) return;
        if (r.error) setError(r.error);
        else {
          setTextures(r.textures || []);
          setSkipped(r.skipped || 0);
        }
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-gray-500">
        <Icons8Icon id="loading" size={20} spin />
        <span className="text-[12px]">Reading textures…</span>
      </div>
    );
  }
  if (error || textures.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8 text-[#9ca3af]">
        <Icons8Icon id="image" size={40} />
        <span className="text-[12px]">{error || 'No readable textures in this file'}</span>
      </div>
    );
  }

  const active = textures[Math.min(selected, textures.length - 1)];
  return (
    <div className="rage-tex-gallery">
      <div className="rage-tex-stage">
        <img src={toVirtualStreamUrl(active.path)} alt={active.name} draggable={false} />
      </div>
      <div className="rage-tex-caption">
        <span className="rage-tex-name">{active.name}</span>
        <span>{active.width} × {active.height}</span>
        <span>{active.format}</span>
        <span>{selected + 1} of {textures.length}</span>
        {skipped > 0 && <span>{skipped} could not be decoded</span>}
      </div>
      <div className="rage-tex-strip" role="listbox" aria-label={title || 'Textures'}>
        {textures.map((t, i) => (
          <button
            key={t.path}
            type="button"
            role="option"
            aria-selected={i === selected}
            className={`rage-tex-thumb${i === selected ? ' is-active' : ''}`}
            onClick={() => setSelected(i)}
            title={`${t.name} — ${t.width} × ${t.height}`}
          >
            <img src={toVirtualStreamUrl(t.path)} alt="" draggable={false} loading="lazy" />
            <span>{t.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
