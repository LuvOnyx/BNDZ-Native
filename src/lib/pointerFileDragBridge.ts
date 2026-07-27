/** Cross-surface pointer file-drag events (archive preview → main chrome tab hover / drop). */

export const POINTER_FILE_DRAG_MOVE = 'bndz-pointer-file-drag-move';
export const POINTER_FILE_DRAG_END = 'bndz-pointer-file-drag-end';
export const POINTER_FILE_DRAG_ACTIVE = 'bndz-pointer-file-drag-active';

export type PointerFileDragMoveDetail = {
  clientX: number;
  clientY: number;
};

export type PointerFileDragEndDetail = {
  clientX: number;
  clientY: number;
  paths: string[];
  op?: 'copy' | 'move';
};

export function dispatchPointerFileDragMove(clientX: number, clientY: number) {
  window.dispatchEvent(new CustomEvent(POINTER_FILE_DRAG_MOVE, {
    detail: { clientX, clientY } satisfies PointerFileDragMoveDetail,
  }));
}

export function dispatchPointerFileDragEnd(detail: PointerFileDragEndDetail) {
  window.dispatchEvent(new CustomEvent(POINTER_FILE_DRAG_END, { detail }));
}

export function dispatchPointerFileDragActive(active: boolean) {
  window.dispatchEvent(new CustomEvent(POINTER_FILE_DRAG_ACTIVE, { detail: { active } }));
}
