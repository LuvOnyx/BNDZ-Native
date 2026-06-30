/** Inline calculator for BNDZ Launcher (SuperCmd-style) */

export type CalcResult = {
  expression: string;
  value: number;
  formatted: string;
};

const SAFE_CALC = /^[\d\s+\-*/().%^eE]+$/;

export function tryEvaluateCalculator(query: string): CalcResult | null {
  const q = query.trim();
  if (!q || q.length > 120) return null;
  if (!SAFE_CALC.test(q)) return null;
  if (!/[\d)]/.test(q)) return null;
  try {
    const expr = q.replace(/\^/g, '**');
    const value = Function(`"use strict"; return (${expr})`)();
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const formatted = Number.isInteger(value) ? String(value) : String(Math.round(value * 1e10) / 1e10);
    return { expression: q, value, formatted };
  } catch {
    return null;
  }
}
