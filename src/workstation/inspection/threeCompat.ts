/**
 * Silence THREE.Clock deprecation until @react-three/fiber migrates to THREE.Timer (three ≥ r183).
 * Import this before any Canvas / R3F usage.
 *
 * Do NOT mutate the `three` ESM namespace — production bundles make exports read-only
 * (`Cannot assign to read only property 'warn'`). Filter via console instead.
 */
const PATCH_KEY = '__bndzThreeClockWarnPatched';
const g = globalThis as typeof globalThis & { [key: string]: boolean | undefined };

if (!g[PATCH_KEY] && typeof console !== 'undefined' && typeof console.warn === 'function') {
  const orig = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === 'string') {
      if (first.includes('Clock: This module has been deprecated')) return;
      if (first.includes('THREE.Clock') && /deprecated/i.test(first)) return;
    }
    orig(...args);
  };
  g[PATCH_KEY] = true;
}
