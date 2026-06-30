import { useEffect, type RefObject } from 'react';
import type { PanelImperativeHandle } from '../components/ui/resizable';
import { motionEnter } from '../lib/bndzMotion';

type PanelRef = RefObject<PanelImperativeHandle | null>;

type Options = {
  effectivePreviewOpen: boolean;
  isDualPane: boolean;
  previewPanelRef: PanelRef;
  previewPanelInnerRef: RefObject<HTMLDivElement | null>;
  dualPaneSecondRef: RefObject<HTMLDivElement | null>;
};

/** Resizable panel expand/collapse + preview/dual-pane enter motion. */
export function useBndzPanelMotion({
  effectivePreviewOpen,
  isDualPane,
  previewPanelRef,
  previewPanelInnerRef,
  dualPaneSecondRef,
}: Options) {
  useEffect(() => {
    const panel = previewPanelRef.current;
    if (!panel) return;
    if (effectivePreviewOpen) panel.expand();
    else panel.collapse();
  }, [effectivePreviewOpen, previewPanelRef]);

  useEffect(() => {
    if (!effectivePreviewOpen) return;
    motionEnter(previewPanelInnerRef.current, { x: 12, duration: 260 });
  }, [effectivePreviewOpen, previewPanelInnerRef]);

  useEffect(() => {
    if (!isDualPane) return;
    motionEnter(dualPaneSecondRef.current, { x: 24, duration: 280 });
  }, [isDualPane, dualPaneSecondRef]);
}
