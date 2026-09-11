import React, { useEffect, useRef } from 'react';
import type { InspectionShaderMode } from './InspectionViewportRouter';

type Props = {
  mode: InspectionShaderMode;
  stageRef: React.RefObject<HTMLElement | null>;
  imgRef: React.RefObject<HTMLImageElement | null>;
  /** Live pan/zoom scale — so zoom does not cause unnecessary re-renders. */
  displayScale: number;
};

const LOUPE_PX = 176;

/**
 * CSS magnifier — no canvas (bndz-stream:// never taints).
 * pointer-events: none so pan/zoom on the stage keep working.
 */
export default function InspectionLens2D({
  mode,
  stageRef,
  imgRef,
  displayScale,
}: Props) {
  const glassRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    const glass = glassRef.current;
    const inner = innerRef.current;
    if (!stage || !glass || !inner || mode !== 'loupe') return;

    const readScale = () => displayScale ?? 1;

    const paint = (clientX: number, clientY: number) => {
      const live = imgRef.current;
      if (!live) {
        inner.style.backgroundImage = '';
        return;
      }

      const stageBox = stage.getBoundingClientRect();
      if (stageBox.width < 8 || stageBox.height < 8) return;

      const cx = clientX - stageBox.left;
      const cy = clientY - stageBox.top;
      glass.style.left = `${cx - LOUPE_PX / 2}px`;
      glass.style.top = `${cy - LOUPE_PX / 2}px`;
      glass.style.opacity = live.complete && live.naturalWidth ? '1' : '0';

      if (!live.complete || !live.naturalWidth) {
        inner.style.backgroundImage = '';
        return;
      }
      const imgBox = live.getBoundingClientRect();
      if (imgBox.width < 2 || imgBox.height < 2) return;

      const scale = Math.max(0.25, readScale());
      const mag = Math.max(2.4, Math.min(5.2, 2.6 + Math.log2(scale) * 0.55));
      const ix = clientX - imgBox.left;
      const iy = clientY - imgBox.top;
      inner.style.backgroundImage = `url(${JSON.stringify(live.currentSrc || live.src)})`;
      inner.style.backgroundSize = `${imgBox.width * mag}px ${imgBox.height * mag}px`;
      inner.style.backgroundPosition = `${LOUPE_PX / 2 - ix * mag}px ${LOUPE_PX / 2 - iy * mag}px`;
    };

    const onMove = (e: PointerEvent) => paint(e.clientX, e.clientY);
    const seed = () => {
      const box = stage.getBoundingClientRect();
      paint(box.left + box.width / 2, box.top + box.height / 2);
    };

    stage.addEventListener('pointermove', onMove);
    const img = imgRef.current;
    const onLoad = () => seed();
    const onError = () => {
      inner.style.backgroundImage = '';
    };
    img?.addEventListener('load', onLoad);
    img?.addEventListener('error', onError);

    // Initial seed call - but only if we have a valid image to avoid early mispositioning
    if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
      seed();
    }

    let roRaf = 0;
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          cancelAnimationFrame(roRaf);
          roRaf = requestAnimationFrame(seed);
        })
      : null;
    ro?.observe(stage);

    return () => {
      stage.removeEventListener('pointermove', onMove);
      img?.removeEventListener('load', onLoad);
      img?.removeEventListener('error', onError);
      cancelAnimationFrame(roRaf);
      ro?.disconnect();
    };
  }, [displayScale, imgRef, mode, stageRef]);

  if (mode !== 'loupe') return null;

  return (
    <div
      ref={glassRef}
      className="bndz-loupe-glass"
      aria-hidden
      data-inspect-mode={mode}
    >
      <div ref={innerRef} className="bndz-loupe-glass-inner" />
    </div>
  );
}
