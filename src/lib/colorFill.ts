/** Solid hex or multi-stop linear gradient fills for Colors settings. */

export type GradientStop = { color: string; pos: number };

export type ColorFill =
  | { mode: 'solid'; color: string }
  | { mode: 'gradient'; angle: number; stops: GradientStop[] };

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && HEX_RE.test(v.trim());
}

export function normalizeHex(v: string, fallback = '#111111'): string {
  const t = v.trim();
  if (t.toLowerCase() === 'transparent') return '#00000000';
  if (!HEX_RE.test(t)) return fallback;
  if (t.length === 4) {
    const r = t[1], g = t[2], b = t[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (t.length === 5) {
    // #RGBA → #RRGGBBAA
    const r = t[1], g = t[2], b = t[3], a = t[4];
    return `#${r}${r}${g}${g}${b}${b}${a}${a}`.toLowerCase();
  }
  return t.toLowerCase();
}

/** CSS color token from stored hex (supports #RRGGBBAA → rgba()). */
export function hexToCssColor(hex: string): string {
  const h = normalizeHex(hex).replace('#', '');
  if (h.length === 8) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = parseInt(h.slice(6, 8), 16) / 255;
    if (a >= 0.999) return `#${h.slice(0, 6)}`;
    return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
  }
  return `#${h}`;
}

export function defaultGradientFromSolid(color: string, angle = 180): ColorFill {
  const c = normalizeHex(color);
  return {
    mode: 'gradient',
    angle,
    stops: [
      { color: c, pos: 0 },
      { color: c, pos: 50 },
      { color: c, pos: 100 },
    ],
  };
}

export function pluginHeroDefaultFill(): ColorFill {
  return {
    mode: 'gradient',
    angle: 90,
    stops: [
      { color: '#0c1220f7', pos: 0 },
      { color: '#080a1094', pos: 52 },
      { color: '#38bdf812', pos: 100 },
    ],
  };
}

export function parseColorFill(raw: unknown, fallback = '#111111'): ColorFill {
  if (raw == null || raw === false || raw === true) {
    return { mode: 'solid', color: normalizeHex(fallback) };
  }
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (isHexColor(t)) return { mode: 'solid', color: normalizeHex(t) };
    if (t.startsWith('{')) {
      try {
        return parseColorFill(JSON.parse(t), fallback);
      } catch {
        return { mode: 'solid', color: normalizeHex(fallback) };
      }
    }
    // Legacy / pasted CSS gradient — keep as opaque gradient via fake stops if we can't parse.
    if (t.toLowerCase().includes('gradient(')) {
      const colors = [...t.matchAll(/#(?:[0-9a-fA-F]{3,8})\b/g)].map(m => normalizeHex(m[0]));
      if (colors.length >= 2) {
        const stops = colors.map((color, i) => ({
          color,
          pos: colors.length === 1 ? 0 : Math.round((i / (colors.length - 1)) * 100),
        }));
        return { mode: 'gradient', angle: 180, stops };
      }
    }
    return { mode: 'solid', color: normalizeHex(fallback) };
  }
  if (typeof raw === 'object' && raw !== null) {
    const o = raw as Record<string, unknown>;
    if (o.mode === 'gradient' && Array.isArray(o.stops)) {
      const stops = (o.stops as unknown[])
        .map((s, i, arr) => {
          const stop = s as Record<string, unknown>;
          const color = normalizeHex(String(stop.color ?? fallback));
          const pos = typeof stop.pos === 'number' ? stop.pos : Math.round((i / Math.max(1, arr.length - 1)) * 100);
          return { color, pos };
        })
        .filter(s => !!s.color);
      if (stops.length >= 2) {
        return {
          mode: 'gradient',
          angle: typeof o.angle === 'number' ? o.angle : 180,
          stops,
        };
      }
    }
    if (o.mode === 'solid' && typeof o.color === 'string') {
      return { mode: 'solid', color: normalizeHex(o.color, fallback) };
    }
  }
  return { mode: 'solid', color: normalizeHex(fallback) };
}

/** Persist fill: hex for solid, JSON for gradient (keeps stops editable). */
export function serializeColorFill(fill: ColorFill): string {
  if (fill.mode === 'solid') return normalizeHex(fill.color);
  return JSON.stringify({
    mode: 'gradient',
    angle: fill.angle,
    stops: fill.stops.map(s => ({ color: normalizeHex(s.color), pos: s.pos })),
  });
}

export function fillToSolid(raw: unknown, fallback = '#111111'): string {
  const fill = parseColorFill(raw, fallback);
  const color = fill.mode === 'solid' ? fill.color : fill.stops[0]?.color || normalizeHex(fallback);
  // Prefer opaque 6-digit for `color:` / neon alpha suffixes
  const h = normalizeHex(color, fallback);
  if (h.length === 9) return h.slice(0, 7);
  return h;
}

/** CSS value for `background` / `background-image` capable properties. */
export function fillToBackground(raw: unknown, fallback = '#111111'): string {
  const fill = parseColorFill(raw, fallback);
  if (fill.mode === 'solid') return hexToCssColor(fill.color);
  const sorted = [...fill.stops].sort((a, b) => a.pos - b.pos);
  const parts = sorted.map(
    s => `${hexToCssColor(s.color)} ${Math.max(0, Math.min(100, s.pos))}%`,
  );
  return `linear-gradient(${fill.angle}deg, ${parts.join(', ')})`;
}

export function isGradientFill(raw: unknown): boolean {
  return parseColorFill(raw).mode === 'gradient';
}

/** Migrate legacy hero top/mid/edge hexes into one gradient fill. */
export function migratePluginHeroFill(
  heroOrTop: unknown,
  mid?: unknown,
  edge?: unknown,
): string {
  const parsed = parseColorFill(heroOrTop, '#0c1220');
  if (parsed.mode === 'gradient') return serializeColorFill(parsed);
  if (isHexColor(String(heroOrTop ?? '')) && (isHexColor(String(mid ?? '')) || isHexColor(String(edge ?? '')))) {
    const a = normalizeHex(String(heroOrTop), '#0c1220');
    const b = isHexColor(String(mid ?? '')) ? normalizeHex(String(mid), '#080a10') : a;
    // Fade out like the original CSS (transparent at 100%); keep edge accent as soft last tint if provided.
    const edgeHex = isHexColor(String(edge ?? '')) ? normalizeHex(String(edge), '#38bdf8') : '#00000000';
    const edgeFade = edgeHex.length === 9 ? edgeHex : `${edgeHex.slice(0, 7)}14`;
    return serializeColorFill({
      mode: 'gradient',
      angle: 90,
      stops: [
        { color: a.length === 7 ? `${a}f2` : a, pos: 0 },
        { color: b.length === 7 ? `${b}8c` : b, pos: 60 },
        { color: edgeFade, pos: 100 },
      ],
    });
  }
  if (parsed.mode === 'solid') {
    // Legacy single solid (or mid/edge cleared) — restore classic visible 3-step hero, not a flat wash.
    const base = normalizeHex(parsed.color);
    const six = base.length === 9 ? base.slice(0, 7) : base;
    return serializeColorFill({
      mode: 'gradient',
      angle: 90,
      stops: [
        { color: `${six}f2`, pos: 0 },
        { color: '#080a108c', pos: 60 },
        { color: '#38bdf814', pos: 100 },
      ],
    });
  }
  return serializeColorFill(pluginHeroDefaultFill());
}

export function fillPreviewLabelColor(raw: unknown, previewText?: string): string {
  if (previewText && isHexColor(previewText)) return previewText;
  const solid = fillToSolid(raw);
  const c = solid.replace('#', '');
  if (c.length < 6) return '#ffffff';
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? '#000000' : '#ffffff';
}
