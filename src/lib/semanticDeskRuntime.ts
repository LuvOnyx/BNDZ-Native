/** Runtime state for Semantic Desk list overlay grouping. */

export type SemanticClusterAssignment = {
  clusterId: string;
  label: string;
};

let active = false;
const pathMap = new Map<string, SemanticClusterAssignment>();

function normPath(p: string): string {
  return p.replace(/\//g, '\\').toLowerCase();
}

export function isSemanticDeskActive(): boolean {
  return active;
}

export function clearSemanticDesk(): void {
  active = false;
  pathMap.clear();
}

export function setSemanticDeskClusters(
  clusters: Array<{ id: string; label: string; paths?: string[] }>,
): void {
  pathMap.clear();
  for (const c of clusters) {
    const assignment = { clusterId: c.id, label: c.label };
    for (const raw of c.paths ?? []) {
      pathMap.set(normPath(raw), assignment);
    }
  }
  active = pathMap.size > 0;
}

export function semanticClusterLabelForPath(winPath: string): string | null {
  const hit = pathMap.get(normPath(winPath));
  return hit?.label ?? null;
}

export function semanticClusterLabelForEntity(
  entity: Record<string, unknown>,
  panePath: string,
): string {
  const name = String(entity.name ?? '');
  const pane = panePath.replace(/\//g, '\\').replace(/\\+$/, '');
  const full = /^[A-Za-z]:\\/.test(name) || name.startsWith('\\\\')
    ? name
    : pane ? `${pane}\\${name}` : name;
  return semanticClusterLabelForPath(full) ?? 'Unclustered';
}
