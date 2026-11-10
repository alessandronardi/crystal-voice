// Convex polytope as an intersection of half-spaces n·x ≤ d (ADR-0005), with
// only + − × ÷ (ADR-0010). Topology first, quantization last:
//  1. every triple of planes is solved by Cramer's rule; points outside any
//     half-space (beyond IN_EPS) are discarded; points within MERGE_EPS are
//     one vertex, which lies on every plane within IN_EPS of it;
//  2. per plane, its vertices are ordered counter-clockwise around the outward
//     normal (diamond pseudo-angle: divisions only). A plane with fewer than
//     3 vertices only touches the solid (an edge or a vertex): no face;
//  3. faces thinner or smaller than MIN_FACE (64 quantization units, about
//     0.001 length units) are removed by dropping their plane and recomputing:
//     the shape moves by less than MIN_FACE and the topology stays that of an
//     exact convex polytope. A face thus "emerges from size zero" (ADR-0005)
//     visibly once it is ~0.001 wide, without slivers;
//  4. short edges are collapsed on the exact topology: vertices closer than
//     WELD_UNITS (on every axis) map to one representative and every ring is
//     mapped through the same map (consistent across faces); then vertices
//     are quantized (unit 2^-16) and those on the same grid point merged too;
//     repeated ring entries vanish;
//  5. canonical order: vertices by (x, y, z); each face is fanned from its
//     lowest index; triangles sorted lexicographically.

import { cross, dot, type Vec3 } from './linear.ts';

export const UNITS = 65536;

/** Tolerance for "inside / on" a half-space, in length units. */
const IN_EPS = 1e-9;
/** Solutions closer than this (on every axis) are the same vertex. */
const MERGE_EPS = 1e-9;
/** Triples whose normals are (nearly) coplanar have no unique intersection. */
const DET_EPS = 1e-12;
/** Faces thinner or smaller than this are removed (64 quantization units). [H] */
const MIN_FACE = 64 / UNITS;
/** Vertices closer than this many units on every axis are collapsed into one. */
const WELD_UNITS = 4;
const MAX_PASSES = 16;

export interface Plane {
  normal: Vec3;
  distance: number;
  form: string;
}

export interface Polytope {
  /** x, y, z per vertex, integer units of 2^-16, sorted by (x, y, z). */
  positions: Int32Array;
  /** CCW (outside view) triangles, canonical order. */
  indices: Uint32Array;
  /** Index of the plane of each triangle. */
  faceOfTriangle: Uint16Array;
}

export class PolytopeError extends Error {
  override readonly name = 'PolytopeError';
  readonly code: 'UNBOUNDED_OR_EMPTY' | 'TOO_MANY_PLANES' | 'COORDINATE_RANGE' | 'NOT_CONVERGED';
  constructor(code: PolytopeError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

/** Diamond pseudo-angle in [0, 4): monotone in the true angle of (a, b). Divisions only. */
function diamondAngle(a: number, b: number): number {
  if (a === 0 && b === 0) return 0;
  if (b >= 0) return a >= 0 ? b / (a + b) : 1 - a / (-a + b);
  return a < 0 ? 2 - b / (-a - b) : 3 + a / (a - b);
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

interface FloatVertex {
  x: Vec3;
  planes: Set<number>;
}

/** Step 1 on the active planes. */
function floatVertices(planes: readonly Plane[], active: readonly number[]): FloatVertex[] {
  const out: FloatVertex[] = [];
  const n = active.length;
  for (let a = 0; a < n; a++) {
    const pi = planes[active[a] ?? 0];
    if (pi === undefined) continue;
    for (let b = a + 1; b < n; b++) {
      const pj = planes[active[b] ?? 0];
      if (pj === undefined) continue;
      const cij = cross(pi.normal, pj.normal);
      for (let c = b + 1; c < n; c++) {
        const pk = planes[active[c] ?? 0];
        if (pk === undefined) continue;
        const det = dot(pk.normal, cij);
        if (det > -DET_EPS && det < DET_EPS) continue;
        const cjk = cross(pj.normal, pk.normal);
        const cki = cross(pk.normal, pi.normal);
        const x: Vec3 = [
          (pi.distance * cjk[0] + pj.distance * cki[0] + pk.distance * cij[0]) / det,
          (pi.distance * cjk[1] + pj.distance * cki[1] + pk.distance * cij[1]) / det,
          (pi.distance * cjk[2] + pj.distance * cki[2] + pk.distance * cij[2]) / det,
        ];
        let inside = true;
        for (const m of active) {
          const pm = planes[m];
          if (pm !== undefined && dot(pm.normal, x) - pm.distance > IN_EPS) {
            inside = false;
            break;
          }
        }
        if (!inside) continue;
        let found = false;
        for (const v of out) {
          if (Math.abs(v.x[0] - x[0]) <= MERGE_EPS && Math.abs(v.x[1] - x[1]) <= MERGE_EPS && Math.abs(v.x[2] - x[2]) <= MERGE_EPS) {
            found = true;
            break;
          }
        }
        if (found) continue;
        const on = new Set<number>();
        for (const m of active) {
          const pm = planes[m];
          if (pm !== undefined && Math.abs(dot(pm.normal, x) - pm.distance) <= IN_EPS) on.add(m);
        }
        out.push({ x, planes: on });
      }
    }
  }
  return out;
}

/** Step 2: vertex indices of plane p, CCW around its outward normal. */
function ringOf(vertices: readonly FloatVertex[], p: number, normal: Vec3): number[] {
  const verts: number[] = [];
  vertices.forEach((v, i) => {
    if (v.planes.has(p)) verts.push(i);
  });
  if (verts.length < 3) return [];
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const i of verts) {
    const x = vertices[i]?.x ?? [0, 0, 0];
    cx += x[0];
    cy += x[1];
    cz += x[2];
  }
  const k = verts.length;
  const centre: Vec3 = [cx / k, cy / k, cz / k];
  let e1: Vec3 = [0, 0, 0];
  for (const i of verts) {
    const w = sub(vertices[i]?.x ?? centre, centre);
    if (w[0] !== 0 || w[1] !== 0 || w[2] !== 0) {
      e1 = w;
      break;
    }
  }
  const e2 = cross(normal, e1);
  const keyed = verts.map((i) => {
    const w = sub(vertices[i]?.x ?? centre, centre);
    return { i, key: diamondAngle(dot(w, e1), dot(w, e2)) };
  });
  keyed.sort((a, b) => a.key - b.key || a.i - b.i);
  return keyed.map((e) => e.i);
}

/** Step 3 test: a face whose diameter or width is below MIN_FACE. */
function isTiny(vertices: readonly FloatVertex[], ring: readonly number[]): boolean {
  let diam2 = 0;
  for (let a = 0; a < ring.length; a++) {
    const pa = vertices[ring[a] ?? 0]?.x ?? [0, 0, 0];
    for (let b = a + 1; b < ring.length; b++) {
      const d = sub(vertices[ring[b] ?? 0]?.x ?? pa, pa);
      diam2 = Math.max(diam2, dot(d, d));
    }
  }
  if (diam2 < MIN_FACE * MIN_FACE) return true;
  const o = vertices[ring[0] ?? 0]?.x ?? [0, 0, 0];
  let ax = 0;
  let ay = 0;
  let az = 0;
  for (let i = 1; i + 1 < ring.length; i++) {
    const n = cross(sub(vertices[ring[i] ?? 0]?.x ?? o, o), sub(vertices[ring[i + 1] ?? 0]?.x ?? o, o));
    ax += n[0];
    ay += n[1];
    az += n[2];
  }
  // width ≈ 2·area / diameter; compare squares: (2·area)² < (MIN_FACE·diameter)²
  return ax * ax + ay * ay + az * az < MIN_FACE * MIN_FACE * diam2;
}

const MAX_COORD = 2147483647;

export function intersectHalfSpaces(planes: readonly Plane[]): Polytope {
  const count = planes.length;
  if (count > 65535) throw new PolytopeError('TOO_MANY_PLANES', `${count} planes`);

  // Steps 1–3, repeated while tiny faces are found.
  let active = planes.map((_, i) => i);
  let vertices: FloatVertex[] = [];
  let rings: number[][] = [];
  let converged = false;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    vertices = floatVertices(planes, active);
    if (vertices.length < 4) throw new PolytopeError('UNBOUNDED_OR_EMPTY', `${vertices.length} vertices`);
    const activeSet = new Set(active);
    rings = planes.map((plane, p) => (activeSet.has(p) ? ringOf(vertices, p, plane.normal) : []));
    const tiny = new Set<number>();
    rings.forEach((ring, p) => {
      if (ring.length >= 3 && isTiny(vertices, ring)) tiny.add(p);
    });
    if (tiny.size === 0) {
      converged = true;
      break;
    }
    active = active.filter((p) => !tiny.has(p));
  }
  if (!converged) throw new PolytopeError('NOT_CONVERGED', 'tiny faces did not settle');

  // Step 4a: collapse short edges on the exact topology (union-find; the
  // representative is the cluster member with the lowest index).
  const parent = vertices.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while ((parent[r] ?? r) !== r) r = parent[r] ?? r;
    return r;
  };
  const weld = WELD_UNITS / UNITS;
  for (let a = 0; a < vertices.length; a++) {
    const xa = vertices[a]?.x ?? [0, 0, 0];
    for (let b = a + 1; b < vertices.length; b++) {
      const xb = vertices[b]?.x ?? [0, 0, 0];
      if (Math.abs(xa[0] - xb[0]) <= weld && Math.abs(xa[1] - xb[1]) <= weld && Math.abs(xa[2] - xb[2]) <= weld) {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
      }
    }
  }

  // Step 4b: quantize representatives; same grid point → same vertex.
  const keyToId = new Map<string, number>();
  const grid: [number, number, number][] = [];
  const idOf = vertices.map((_, i) => {
    const v = vertices[find(i)] ?? { x: [0, 0, 0] as Vec3 };
    const q: [number, number, number] = [Math.round(v.x[0] * UNITS), Math.round(v.x[1] * UNITS), Math.round(v.x[2] * UNITS)];
    for (const c of q) {
      if (c > MAX_COORD || c < -MAX_COORD) throw new PolytopeError('COORDINATE_RANGE', 'vertex outside int32 range');
    }
    const key = `${q[0]},${q[1]},${q[2]}`;
    let id = keyToId.get(key);
    if (id === undefined) {
      id = grid.length;
      keyToId.set(key, id);
      grid.push(q);
    }
    return id;
  });

  // Faces on grid ids: drop consecutive repeats (collapsed edges).
  const faceRings: { p: number; ring: number[] }[] = [];
  rings.forEach((ring, p) => {
    const ids: number[] = [];
    for (const v of ring) {
      const id = idOf[v] ?? 0;
      if (ids[ids.length - 1] !== id) ids.push(id);
    }
    while (ids.length > 1 && ids[0] === ids[ids.length - 1]) ids.pop();
    if (ids.length >= 3) faceRings.push({ p, ring: ids });
  });

  // Step 5: canonical vertex order, keeping only vertices used by a face.
  const used = new Set<number>();
  for (const f of faceRings) for (const id of f.ring) used.add(id);
  const order = Array.from(used).sort((a, b) => {
    const ga = grid[a] ?? [0, 0, 0];
    const gb = grid[b] ?? [0, 0, 0];
    return ga[0] - gb[0] || ga[1] - gb[1] || ga[2] - gb[2];
  });
  if (order.length < 4) throw new PolytopeError('UNBOUNDED_OR_EMPTY', `${order.length} vertices`);
  const canonical = new Map<number, number>();
  order.forEach((id, n) => canonical.set(id, n));
  const positions = new Int32Array(order.length * 3);
  order.forEach((id, n) => {
    const g = grid[id] ?? [0, 0, 0];
    positions[3 * n] = g[0];
    positions[3 * n + 1] = g[1];
    positions[3 * n + 2] = g[2];
  });

  const triangles: [number, number, number, number][] = [];
  for (const { p, ring } of faceRings) {
    const r = ring.map((id) => canonical.get(id) ?? 0);
    let start = 0;
    for (let i = 1; i < r.length; i++) if ((r[i] ?? 0) < (r[start] ?? 0)) start = i;
    const rotated = r.slice(start).concat(r.slice(0, start));
    const root = rotated[0] ?? 0;
    for (let i = 1; i + 1 < rotated.length; i++) triangles.push([root, rotated[i] ?? 0, rotated[i + 1] ?? 0, p]);
  }
  triangles.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
  const indices = new Uint32Array(triangles.length * 3);
  const faceOfTriangle = new Uint16Array(triangles.length);
  triangles.forEach((t, i) => {
    indices[3 * i] = t[0];
    indices[3 * i + 1] = t[1];
    indices[3 * i + 2] = t[2];
    faceOfTriangle[i] = t[3];
  });
  return { positions, indices, faceOfTriangle };
}
