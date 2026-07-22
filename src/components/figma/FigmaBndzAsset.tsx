import React from 'react';
import { FIGMA_BNDZ_ASSET_BY_ID, type FigmaBndzAssetId } from '../../assets/figma-bndz';

type Props = {
  id: FigmaBndzAssetId;
  className?: string;
  alt?: string;
  /** When true, sizes to the asset's design width/height */
  intrinsic?: boolean;
};

/**
 * Reference renderer for staged Figma BNDZ assets.
 * Not used in production chrome yet — import when wiring a surface.
 */
export function FigmaBndzAsset({ id, className, alt, intrinsic }: Props) {
  const asset = FIGMA_BNDZ_ASSET_BY_ID[id];
  if (!asset) return null;
  return (
    <img
      src={asset.url}
      alt={alt ?? asset.label}
      className={className}
      width={intrinsic ? asset.width : undefined}
      height={intrinsic ? asset.height : undefined}
      draggable={false}
      style={intrinsic ? undefined : { width: '100%', height: 'auto', display: 'block' }}
    />
  );
}

export default FigmaBndzAsset;
