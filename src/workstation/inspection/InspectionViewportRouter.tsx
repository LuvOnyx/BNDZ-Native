import React, { useState } from 'react';
import ImageZoomPreview from '../../components/ImageZoomPreview';
import GpuInspectionViewport from './GpuInspectionViewport';
import { probeWebGL } from '../webglProbe';

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

export default function InspectionViewportRouter({
  src,
  alt,
  fallbackSrc,
  filePath,
  onOpenFloating,
  gpuEnabled = true,
  shaderMode = 'passthrough',
}: Props) {
  const [gpuFailed, setGpuFailed] = useState(false);
  const wantsGpuShader = shaderMode === 'histogram' || shaderMode === 'loupe';
  const useGpu = !gpuFailed
    && gpuEnabled !== false
    && probeWebGL()
    && !!src
    && wantsGpuShader;

  if (!useGpu) {
    return (
      <div className="relative w-full h-full min-h-0 flex flex-col">
        <ImageZoomPreview
          src={src}
          alt={alt}
          fallbackSrc={fallbackSrc}
          filePath={filePath}
          onOpenFloating={onOpenFloating}
        />
      </div>
    );
  }

  return (
    <div className="relative w-full h-full flex flex-col min-h-0">
      <GpuInspectionViewport
        src={src}
        alt={alt}
        shaderMode={shaderMode}
        onFailed={() => setGpuFailed(true)}
      />
      {onOpenFloating && (
        <button
          type="button"
          className="absolute top-2 right-2 z-10 text-[10px] px-2 py-1 rounded bg-black/50 text-white/80 hover:bg-black/70"
          onClick={onOpenFloating}
        >
          Quick Look
        </button>
      )}
    </div>
  );
}
