// Silhouette IoU for the continuity property (SPEC §10): 1 − IoU of the
// orthographic front (x, z) and top (x, y) projections. Test code only: plain
// floating point is fine here, nothing is hashed.
//
// Each body is convex, so its projection is the convex hull of its projected
// vertices. A shape is the union of its bodies' hulls. Areas are integrated
// with horizontal scanlines: on each row every hull gives one interval, the
// union of intervals is exact per row, and rows are ROWS across the joint
// extent of the two shapes.

import type { CrystalGeometry } from '@voicecrystal/contracts';

type Pt = [number, number];
const ROWS = 512;

function hull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const crossZ = (o: Pt, a: Pt, b: Pt): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && crossZ(lower[lower.length - 2] as Pt, lower[lower.length - 1] as Pt, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i] as Pt;
    while (upper.length >= 2 && crossZ(upper[upper.length - 2] as Pt, upper[upper.length - 1] as Pt, q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export type View = 'front' | 'top';

export function projections(g: CrystalGeometry, view: View): Pt[][] {
  return g.bodies.map((b) => {
    const pts: Pt[] = [];
    for (let i = 0; i < b.positions.length; i += 3) {
      const x = (b.positions[i] ?? 0) / 65536;
      const y = (b.positions[i + 1] ?? 0) / 65536;
      const z = (b.positions[i + 2] ?? 0) / 65536;
      pts.push(view === 'front' ? [x, z] : [x, y]);
    }
    return hull(pts);
  });
}

function intervalAt(poly: Pt[], y: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Pt;
    const b = poly[(i + 1) % poly.length] as Pt;
    if ((a[1] <= y && b[1] >= y) || (b[1] <= y && a[1] >= y)) {
      const x = a[1] === b[1] ? Math.min(a[0], b[0]) : a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
      const x2 = a[1] === b[1] ? Math.max(a[0], b[0]) : x;
      lo = Math.min(lo, x, x2);
      hi = Math.max(hi, x, x2);
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

function unionIntervals(list: [number, number][]): [number, number][] {
  const s = [...list].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const iv of s) {
    const last = out[out.length - 1];
    if (last !== undefined && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}

const length = (ivs: [number, number][]): number => ivs.reduce((n, [a, b]) => n + (b - a), 0);

function intersectLength(a: [number, number][], b: [number, number][]): number {
  let i = 0;
  let j = 0;
  let total = 0;
  while (i < a.length && j < b.length) {
    const x = a[i] as [number, number];
    const y = b[j] as [number, number];
    const lo = Math.max(x[0], y[0]);
    const hi = Math.min(x[1], y[1]);
    if (hi > lo) total += hi - lo;
    if (x[1] < y[1]) i++;
    else j++;
  }
  return total;
}

/** 1 − IoU of two unions of convex polygons. */
export function silhouetteDistance(a: Pt[][], b: Pt[][]): number {
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const poly of [...a, ...b]) for (const p of poly) {
    yMin = Math.min(yMin, p[1]);
    yMax = Math.max(yMax, p[1]);
  }
  const dy = (yMax - yMin) / ROWS;
  let inter = 0;
  let union = 0;
  for (let r = 0; r < ROWS; r++) {
    const y = yMin + (r + 0.5) * dy;
    const ia = unionIntervals(a.map((p) => intervalAt(p, y)).filter((v): v is [number, number] => v !== null));
    const ib = unionIntervals(b.map((p) => intervalAt(p, y)).filter((v): v is [number, number] => v !== null));
    const i = intersectLength(ia, ib);
    inter += i;
    union += length(ia) + length(ib) - i;
  }
  return union > 0 ? 1 - inter / union : 0;
}

/** Max of the front and top silhouette distances. */
export function geometryDistance(a: CrystalGeometry, b: CrystalGeometry): number {
  return Math.max(
    silhouetteDistance(projections(a, 'front'), projections(b, 'front')),
    silhouetteDistance(projections(a, 'top'), projections(b, 'top')),
  );
}
