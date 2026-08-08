/** Permanent user variables for templates / scripting (XYplorer-style). */

export type PermanentVariableMap = Record<string, string>;

const VAR_NAME_RE = /^[A-Za-z_][\w]*$/;

export function normalizePermanentVariables(raw: unknown): PermanentVariableMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: PermanentVariableMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!VAR_NAME_RE.test(k)) continue;
    if (v == null) continue;
    out[k] = String(v);
  }
  return out;
}

export function setPermanentVariable(
  map: PermanentVariableMap,
  name: string,
  value: string,
): PermanentVariableMap {
  const key = name.trim();
  if (!VAR_NAME_RE.test(key)) return map;
  return { ...map, [key]: value };
}

export function deletePermanentVariable(
  map: PermanentVariableMap,
  name: string,
): PermanentVariableMap {
  const next = { ...map };
  delete next[name];
  return next;
}

/**
 * Expand permanent vars in a template string.
 * Supports `<p:name>`, `<var:name>`, and `$name` (word-bounded).
 */
export function expandPermanentVariables(
  template: string,
  vars: PermanentVariableMap,
): string {
  if (!template) return template;
  let out = template;
  out = out.replace(/<(?:p|var):([^>]+)>/gi, (_, raw: string) => {
    const key = String(raw || '').trim();
    return vars[key] ?? '';
  });
  out = out.replace(/\$([A-Za-z_][\w]*)/g, (full, name: string) => (
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : full
  ));
  return out;
}

/** Apply permanent vars into an already-tokenized template render pipeline. */
export function withPermanentVariables(
  text: string,
  config: { rememberPermanentVariables?: boolean; permanentVariables?: unknown },
): string {
  // Settings → Remember permanent variables (when off, expand from in-memory only if present,
  // but callers should pass empty map when not remembering for disk-backed sessions).
  const map = normalizePermanentVariables(config.permanentVariables);
  if (!Object.keys(map).length) return text;
  return expandPermanentVariables(text, map);
}
