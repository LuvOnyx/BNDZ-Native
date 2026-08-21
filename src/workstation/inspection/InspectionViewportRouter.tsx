import React, { useEffect, useState } from 'react';
import ImageZoomPreview from '../../components/ImageZoomPreview';
import GpuInspectionViewport from './GpuInspectionViewport';

export type InspectionShaderMode = 'passthrough' | 'histogram' | 'loupe';

type Props = {
  src: string;
  alt: string;
  fallbackSrc?: string;
  filePath?: string | null;
  onOpenFloating?: () => void;
  gpuEnabled?: boolean;
  shaderMode?: InspectionShaderMode;
};

/**
 * Standard (passthrough) uses the lightweight 2D ImageZoomPreview.
 * Luma inspect + Loupe use the GPU shader viewport (histogramFrag/loupeFrag),
 * which is the classic inspection path: a true luminance heatmap and a real
 * magnifier lens rendered on a canvas texture. The 2D CSS path is unreliable
 * for inspection because the loupe relies on a CSS background-image from the
 * bndz-stream:// custom scheme, which does not render in WebView2; the GPU path
 * converts the stream to a blob: URL first (resolveTextureSrc) and draws to a
 * texture, so it works where the 2D loupe silently shows nothing.
 *
 * If the WebGL context is unavailable or the texture fails to load, we fall
 * back to the 2D ImageZoomPreview so the panel never goes blank.
 * 3D meshes (.glb, .ydr, …) use GpuModelViewport in the main preview — never here.
 */
export default function InspectionViewportRouter({
  src,
  alt,
  fallbackSrc,
  filePath,
  onOpenFloating,
  gpuEnabled = true,
  shaderMode = 'passthrough',
}: Props) {
  const wantsLens = shaderMode === 'histogram' || shaderMode === 'loupe';
  const [gpuFailed, setGpuFailed] = useState(false);
  useEffect(() => {
    setGpuFailed(false);
  }, [shaderMode, src]);

  const useGpu = wantsLens && gpuEnabled !== false && !gpuFailed;

  return (
    <div className="relative w-full h-full min-h-0 flex-1 flex flex-col">
      {useGpu ? (
        <GpuInspectionViewport
          src={src}
          alt={alt}
          filePath={filePath}
          shaderMode={shaderMode}
          onFailed={() => setGpuFailed(true)}
        />
      ) : (
        <ImageZoomPreview
          src={src}
          alt={alt}
          fallbackSrc={fallbackSrc}
          filePath={filePath}
          onOpenFloating={onOpenFloating}
          inspectionMode={shaderMode}
        />
      )}
      {wantsLens && (
        <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-md bg-black/70 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-cyan-100">
          {shaderMode === 'loupe' ? 'Loupe' : 'Luma inspect'}
        </div>
      )}
    </div>
  );
}
