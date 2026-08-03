type RealityCheckListener = () => void;

export type RealityCheckRef = {
  refPath: string;
  resolvedPath: string;
  exists: boolean;
  source: string;
  projectFile: string;
};

export type RealityCheckScan = {
  rootPath: string;
  projectFileCount: number;
  totalRefs: number;
  missingCount: number;
  okCount: number;
  scannedUtc: string;
  references: RealityCheckRef[];
};

type RealityCheckState = {
  active: boolean;
  missingPaths: Set<string>;
  okPaths: Set<string>;
  lastScan: RealityCheckScan | null;
};

const listeners = new Set<RealityCheckListener>();

let state: RealityCheckState = {
  active: false,
  missingPaths: new Set(),
  okPaths: new Set(),
  lastScan: null,
};

function notify() {
  listeners.forEach(fn => fn());
}

function normPath(p: string): string {
  return p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

export function subscribeRealityCheck(listener: RealityCheckListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRealityCheckState(): Readonly<RealityCheckState> {
  return state;
}

export function isRealityCheckActive(): boolean {
  return state.active;
}

export function isRealityCheckMissing(winPath: string): boolean {
  if (!state.active || !winPath) return false;
  return state.missingPaths.has(normPath(winPath));
}

export function isRealityCheckOk(winPath: string): boolean {
  if (!state.active || !winPath) return false;
  return state.okPaths.has(normPath(winPath));
}

function normalizeRef(raw: Record<string, unknown>): RealityCheckRef {
  return {
    refPath: String(raw.refPath ?? raw.RefPath ?? ''),
    resolvedPath: String(raw.resolvedPath ?? raw.ResolvedPath ?? ''),
    exists: !!(raw.exists ?? raw.Exists),
    source: String(raw.source ?? raw.Source ?? ''),
    projectFile: String(raw.projectFile ?? raw.ProjectFile ?? ''),
  };
}

export function applyRealityCheckScan(raw: Record<string, unknown>) {
  const refsRaw = Array.isArray(raw.references) ? raw.references : [];
  const refs = refsRaw.map((r: Record<string, unknown>) => normalizeRef(r));
  const missing = new Set<string>();
  const ok = new Set<string>();
  for (const r of refs) {
    const key = normPath(r.resolvedPath);
    if (!key) continue;
    if (r.exists) ok.add(key);
    else missing.add(key);
  }
  state = {
    ...state,
    active: true,
    missingPaths: missing,
    okPaths: ok,
    lastScan: {
      rootPath: String(raw.rootPath ?? raw.RootPath ?? ''),
      projectFileCount: Number(raw.projectFileCount ?? raw.ProjectFileCount ?? 0),
      totalRefs: Number(raw.totalRefs ?? raw.TotalRefs ?? refs.length),
      missingCount: Number(raw.missingCount ?? raw.MissingCount ?? missing.size),
      okCount: Number(raw.okCount ?? raw.OkCount ?? ok.size),
      scannedUtc: String(raw.scannedUtc ?? raw.ScannedUtc ?? ''),
      references: refs,
    },
  };
  notify();
}

export function setRealityCheckActive(active: boolean) {
  if (!active) {
    state = { active: false, missingPaths: new Set(), okPaths: new Set(), lastScan: state.lastScan };
  } else {
    state = { ...state, active: true };
  }
  notify();
}

export function hydrateRealityCheckFromHost(raw: { active?: boolean; missingPaths?: string[]; lastScan?: Record<string, unknown> }) {
  const missing = new Set((raw.missingPaths || []).map(normPath));
  const ok = new Set<string>();
  const lastScanRaw = raw.lastScan;
  if (lastScanRaw) {
    const refsRaw = Array.isArray(lastScanRaw.references) ? lastScanRaw.references : [];
    const refs = refsRaw.map((r: Record<string, unknown>) => normalizeRef(r));
    for (const r of refs) {
      const key = normPath(r.resolvedPath);
      if (!key) continue;
      if (r.exists) ok.add(key);
    }
    state = {
      active: !!raw.active,
      missingPaths: missing,
      okPaths: ok,
      lastScan: {
        rootPath: String(lastScanRaw.rootPath ?? lastScanRaw.RootPath ?? ''),
        projectFileCount: Number(lastScanRaw.projectFileCount ?? lastScanRaw.ProjectFileCount ?? 0),
        totalRefs: Number(lastScanRaw.totalRefs ?? lastScanRaw.TotalRefs ?? refs.length),
        missingCount: Number(lastScanRaw.missingCount ?? lastScanRaw.MissingCount ?? missing.size),
        okCount: Number(lastScanRaw.okCount ?? lastScanRaw.OkCount ?? ok.size),
        scannedUtc: String(lastScanRaw.scannedUtc ?? lastScanRaw.ScannedUtc ?? ''),
        references: refs,
      },
    };
  } else {
    state = { ...state, active: !!raw.active, missingPaths: missing };
  }
  notify();
}
