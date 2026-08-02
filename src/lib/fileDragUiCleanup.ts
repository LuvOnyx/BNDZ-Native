import { endFileDragSession } from './fileDragSession';
import { disarmFluidDrag } from '../workstation/drag/fluidDragBridge';

/**
 * Tear down in-app file-drag chrome from any surface (Spatial Canvas, etc.).
 * BNDZUI listens for `bndz-end-file-drag` to clear React ghost state; session + fluid
 * stack are cleared here immediately so overlays cannot freeze after stopPropagation.
 */
export function endInternalFileDragUi(reason = 'drop'): void {
  endFileDragSession();
  disarmFluidDrag();
  try {
    window.dispatchEvent(new CustomEvent('bndz-end-file-drag', { detail: { reason } }));
  } catch { /* ignore */ }
}
