/**
 * Startup + navigation timing.
 *
 * Boot marks go to the native host, which appends them to %LocalAppData%\BNDZ\boot.log next to
 * its own marks (shell-launch, webview-env-ready, ui-ready, ...), so one file shows the whole
 * cold start. Navigation samples stay in memory (window.__bndzNavPerf, last 200) and as
 * performance.measure entries -- read them from DevTools or the perf scripts; nothing is written
 * per navigation.
 */

type NavSample = {
  path: string;
  kind: 'fetch' | 'cache';
  entries: number;
  /** Fetch start -> listing data in hand (backend enumerate + IPC + parse). */
  dataMs: number;
  /** Fetch start -> rows painted (two animation frames after the state commit). */
  paintMs: number;
  at: number;
};

const sentBoot = new Set<string>();

function hostPost(msg: unknown): void {
  try {
    (window as any).chrome?.webview?.postMessage?.(msg);
  } catch {
    /* not hosted */
  }
}

/** One-shot startup mark (first call per phase wins). */
export function bootMark(phase: string): void {
  if (typeof window === 'undefined' || sentBoot.has(phase)) return;
  sentBoot.add(phase);
  const t = Math.round(performance.now());
  try { performance.mark(`bndz:${phase}`); } catch { /* ignore */ }
  hostPost({ type: 'BNDZ_PERF_MARK', payload: { phase, t } });
}

function navBuffer(): NavSample[] {
  const w = window as any;
  if (!Array.isArray(w.__bndzNavPerf)) w.__bndzNavPerf = [];
  return w.__bndzNavPerf as NavSample[];
}

function afterPaint(cb: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(cb));
}

/** Start timing a folder load; call the returned function once the entries are cached. */
export function beginNavTiming(path: string, kind: NavSample['kind']): (entries: number) => void {
  if (typeof window === 'undefined') return () => {};
  const start = performance.now();
  return (entries: number) => {
    const dataAt = performance.now();
    afterPaint(() => {
      const end = performance.now();
      const sample: NavSample = {
        path,
        kind,
        entries,
        dataMs: Math.round(dataAt - start),
        paintMs: Math.round(end - start),
        at: Math.round(end),
      };
      const buf = navBuffer();
      buf.push(sample);
      if (buf.length > 200) buf.splice(0, buf.length - 200);
      try { performance.measure(`bndz:nav ${kind} ${entries}`, { start, end }); } catch { /* ignore */ }
      if (!sentBoot.has('first-folder-painted') && kind === 'fetch') bootMark('first-folder-painted');
    });
  };
}
