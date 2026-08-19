import React from 'react';
import ImageZoomPreview from '../../components/ImageZoomPreview';

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
 * Loupe / Luma / Standard share one ImageZoomPreview (same pan+zoom).
 * 3D meshes (.glb, .ydr, …) use GpuModelViewport in the main preview — never this router.
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
  // GPU shader path retired — 2D ImageZoomPreview owns Standard / Luma / Loupe.
  void gpuEnabled;

  const wantsLens = shaderMode === 'histogram' || shaderMode === 'loupe';

  return (
    <div className="relative w-full h-full min-h-0 flex-1 flex flex-col">
      <ImageZoomPreview
        src={src}
        alt={alt}
        fallbackSrc={fallbackSrc}
        filePath={filePath}
        onOpenFloating={onOpenFloating}
        inspectionMode={shaderMode}
      />
      {wantsLens && (
        <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-md bg-black/70 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-cyan-100">
          {shaderMode === 'loupe' ? 'Loupe' : 'Luma inspect'}
        </div>
      )}
    </div>
  );
}
