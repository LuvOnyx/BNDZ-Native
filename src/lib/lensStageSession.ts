/**
 * Survives RightPreviewPanel remounts (selection key changes).
 * When the user collapses the Lens Stage, it must stay collapsed until they
 * manually expand it — even across file/folder selection changes.
 */
let sessionCollapsed: boolean | null = null;

export function getLensStageCollapsed(fallback: boolean): boolean {
  return sessionCollapsed ?? fallback;
}

export function setLensStageCollapsed(collapsed: boolean): void {
  sessionCollapsed = collapsed;
}
