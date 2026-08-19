/**
 * BNDZ freehand path math — densify, Chaikin, true Ramer–Douglas–Peucker, Catmull-Rom→cubic.
 * No CDN. Used by OpenShop + Design Board.
 */
(function (global) {
  'use strict';

  function dist(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  /** Perpendicular distance from point P to segment A→B. */
  function perpDist(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) return dist(p, a);
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
    const proj = { x: a.x + t * dx, y: a.y + t * dy };
    return dist(p, proj);
  }

  /**
   * True Ramer–Douglas–Peucker: recursively keep the point farthest from the chord.
   * @param {{x:number,y:number}[]} pts
   * @param {number} epsilon
   */
  function ramerDouglasPeucker(pts, epsilon) {
    if (!pts || pts.length < 3) return pts ? pts.slice() : [];
    const eps = Math.max(1e-6, +epsilon || 1);
    const keep = new Array(pts.length).fill(false);
    keep[0] = true;
    keep[pts.length - 1] = true;

    function simplify(i0, i1) {
      if (i1 <= i0 + 1) return;
      let maxD = -1;
      let maxI = i0;
      const a = pts[i0];
      const b = pts[i1];
      for (let i = i0 + 1; i < i1; i++) {
        const d = perpDist(pts[i], a, b);
        if (d > maxD) {
          maxD = d;
          maxI = i;
        }
      }
      if (maxD > eps) {
        keep[maxI] = true;
        simplify(i0, maxI);
        simplify(maxI, i1);
      }
    }

    simplify(0, pts.length - 1);
    const out = [];
    for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
    return out.length >= 2 ? out : [pts[0], pts[pts.length - 1]];
  }

  function densify(pts, maxGap) {
    if (!pts || pts.length < 2) return pts ? pts.slice() : [];
    const gap = Math.max(0.5, +maxGap || 4);
    const densified = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = densified[densified.length - 1];
      const b = pts[i];
      const d = dist(a, b);
      const steps = Math.max(1, Math.ceil(d / gap));
      for (let s = 1; s <= steps; s++) {
        densified.push({
          x: a.x + (b.x - a.x) * (s / steps),
          y: a.y + (b.y - a.y) * (s / steps),
        });
      }
    }
    return densified;
  }

  function chaikin(pts, iterations) {
    if (!pts || pts.length < 2) return pts ? pts.slice() : [];
    const n = Math.max(0, Math.min(4, Math.round(+iterations || 1)));
    let cur = pts;
    for (let k = 0; k < n; k++) {
      const next = [cur[0]];
      for (let i = 0; i < cur.length - 1; i++) {
        const a = cur[i];
        const b = cur[i + 1];
        next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
        next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
      }
      next.push(cur[cur.length - 1]);
      cur = next;
    }
    return cur;
  }

  /** Catmull-Rom spline → SVG cubic path string (absolute). */
  function catmullToCubicSvg(pts) {
    if (!pts || pts.length < 2) return '';
    if (pts.length === 2) {
      return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
    }
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
    }
    return d;
  }

  function extractPointsFromFabricPath(pathCmds) {
    const pts = [];
    if (!Array.isArray(pathCmds)) return pts;
    pathCmds.forEach((cmd) => {
      if (!cmd || !cmd.length) return;
      const op = cmd[0];
      if (op === 'M' || op === 'L') pts.push({ x: +cmd[1], y: +cmd[2] });
      else if (op === 'Q') pts.push({ x: +cmd[3], y: +cmd[4] });
      else if (op === 'C') pts.push({ x: +cmd[5], y: +cmd[6] });
    });
    return pts;
  }

  /**
   * Full freehand pipeline.
   * @param {{x:number,y:number}[]} pts
   * @param {number} amount 0..1 (callers should floor UI 0 → 0.08)
   * @returns {{ points: {x:number,y:number}[], svg: string, cubicCount: number }}
   */
  function smoothPolyline(pts, amount) {
    const a = Math.max(0.08, Math.min(1, +amount || 0.08));
    if (!pts || pts.length < 3) {
      return { points: pts ? pts.slice() : [], svg: pts && pts.length ? catmullToCubicSvg(pts) : '', cubicCount: 0 };
    }
    const maxGap = Math.max(1.2, 6.5 - a * 4.5);
    const densified = densify(pts, maxGap);
    const iterations = Math.max(1, Math.min(3, Math.round(a * 3)));
    const rounded = chaikin(densified, iterations);
    // Higher smoothing → slightly looser RDP (fewer vertices), still true RDP.
    const epsilon = Math.max(0.35, 2.2 - a * 1.6);
    const keep = ramerDouglasPeucker(rounded, epsilon);
    const svg = catmullToCubicSvg(keep);
    const cubicCount = (svg.match(/\sC\s/g) || []).length;
    return { points: keep, svg, cubicCount };
  }

  /**
   * Apply pipeline to a Fabric path object (mutates path.path).
   * @param {object} path Fabric Path
   * @param {number} amount
   * @param {object} fabricLib global fabric
   * @param {{ fill?: string }} [opts]
   */
  function smoothFabricPath(path, amount, fabricLib, opts) {
    if (!path || !Array.isArray(path.path) || !fabricLib?.util?.parsePath) return path;
    const pts = extractPointsFromFabricPath(path.path);
    if (pts.length < 3) return path;
    const result = smoothPolyline(pts, amount);
    if (!result.svg) return path;
    try {
      const fill = opts && 'fill' in opts ? opts.fill : 'transparent';
      path.set({ path: fabricLib.util.parsePath(result.svg), fill });
      path.setCoords?.();
    } catch {
      /* leave original */
    }
    return path;
  }

  /** Suggested PencilBrush.decimate for a smoothing amount (0.08–1). */
  function suggestedDecimate(amount) {
    const a = Math.max(0.08, Math.min(1, +amount || 0.08));
    return Math.max(0.05, 0.22 - a * 0.14);
  }

  global.BndzFreehandMath = {
    densify,
    chaikin,
    ramerDouglasPeucker,
    catmullToCubicSvg,
    extractPointsFromFabricPath,
    smoothPolyline,
    smoothFabricPath,
    suggestedDecimate,
    perpDist,
  };
})(typeof window !== 'undefined' ? window : globalThis);
