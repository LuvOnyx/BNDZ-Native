export type WorkspaceClipboardEntry =
  | { kind: 'spatial-pins'; paths: string[] }
  | { kind: 'automation-node'; nodeType: string; fields: Record<string, string> };

let clipboard: WorkspaceClipboardEntry | null = null;

export function setWorkspaceClipboard(entry: WorkspaceClipboardEntry): void {
  clipboard = entry;
}

export function getWorkspaceClipboard(): WorkspaceClipboardEntry | null {
  return clipboard;
}

export function clearWorkspaceClipboard(): void {
  clipboard = null;
}
