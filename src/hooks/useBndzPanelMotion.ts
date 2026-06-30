import { useEffect, type RefObject } from 'react';
import { motionEnter } from '../lib/bndzMotion';

type Options = {
  effectivePreviewOpen: boolean;
  isDualPane: boolean;
  previewPanelInnerRef: RefObject<HTMLDivElement | null>;
  dualPaneSecondRef: RefObject<HTMLDivElement | null>;
};

/** Resizable panel enter motion for preview/dual-pane (layout handled in BNDZUI). */
export function useBndzPanelMotion({
  effectivePreviewOpen,
  isDualPane,
  previewPanelInnerRef,
  dualPaneSecondRef,
}: Options) {
  useEffect(() => {
    if (!effectivePreviewOpen) return;
    motionEnter(previewPanelInnerRef.current, { x: 12, duration: 260 });
  }, [effectivePreviewOpen, previewPanelInnerRef]);

  useEffect(() => {
    if (!isDualPane) return;
    motionEnter(dualPaneSecondRef.current, { x: 24, duration: 280 });
  }, [isDualPane, dualPaneSecondRef]);
}
