// Mesh invariants shared by the crystal-core tests (convexity, closure, winding).

export interface MeshLike {
  positions: Int32Array;
  indices: Uint32Array;
  faceOfTriangle: Uint16Array;
}

export interface PlaneLike {
  normal: readonly [number, number, number];
  distance: number;
}

/** Every directed edge appears once and its reverse once: closed, consistently oriented 2-manifold. */
export function checkClosedAndOriented(mesh: MeshLike): string | null {
  const directed = new Map<string, number>();
  const t = mesh.indices;
  for (let i = 0; i < t.length; i += 3) {
    const tri = [t[i] ?? 0, t[i + 1] ?? 0, t[i + 2] ?? 0];
    for (let e = 0; e < 3; e++) {
      const a = tri[e] ?? 0;
      const b = tri[(e + 1) % 3] ?? 0;
      const key = `${a}>${b}`;
      directed.set(key, (directed.get(key) ?? 0) + 1);
    }
  }
  for (const [key, n] of directed) {
    if (n !== 1) return `directed edge ${key} used ${n} times`;
    const [a, b] = key.split('>');
    if (directed.get(`${b}>${a}`) !== 1) return `edge ${key} has no opposite`;
  }
  return null;
}

/** Euler characteristic on triangles and on faces (polygons). */
export function euler(mesh: MeshLike): { triangles: number; faces: number } {
  const v = mesh.positions.length / 3;
  const edges = new Set<string>();
  const faceEdges = new Set<string>();
  const t = mesh.indices;
  const triCount = t.length / 3;
  for (let i = 0; i < t.length; i += 3) {
    const tri = [t[i] ?? 0, t[i + 1] ?? 0, t[i + 2] ?? 0];
    for (let e = 0; e < 3; e++) {
      const a = tri[e] ?? 0;
      const b = tri[(e + 1) % 3] ?? 0;
      edges.add(a < b ? `${a}-${b}` : `${b}-${a}`);
    }
  }
  // Polygon edges: triangle edges between triangles of different faces.
  const faceOfEdge = new Map<string, number[]>();
  for (let i = 0; i < triCount; i++) {
    for (let e = 0; e < 3; e++) {
      const a = t[3 * i + e] ?? 0;
      const b = t[3 * i + ((e + 1) % 3)] ?? 0;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const list = faceOfEdge.get(key) ?? [];
      list.push(mesh.faceOfTriangle[i] ?? 0);
      faceOfEdge.set(key, list);
    }
  }
  for (const [key, faces] of faceOfEdge) if (faces[0] !== faces[1]) faceEdges.add(key);
  const usedVerts = new Set<number>();
  for (const key of faceEdges) for (const x of key.split('-')) usedVerts.add(Number(x));
  const faces = new Set(Array.from(mesh.faceOfTriangle)).size;
  return { triangles: v - edges.size + triCount, faces: usedVerts.size - faceEdges.size + faces };
}

/** Each triangle's normal points along its face plane's outward normal. */
export function checkOutwardWinding(mesh: MeshLike, planes: readonly PlaneLike[]): string | null {
  const p = mesh.positions;
  const t = mesh.indices;
  for (let i = 0; i < t.length / 3; i++) {
    const [a, b, c] = [t[3 * i] ?? 0, t[3 * i + 1] ?? 0, t[3 * i + 2] ?? 0];
    const u = [(p[3 * b] ?? 0) - (p[3 * a] ?? 0), (p[3 * b + 1] ?? 0) - (p[3 * a + 1] ?? 0), (p[3 * b + 2] ?? 0) - (p[3 * a + 2] ?? 0)];
    const w = [(p[3 * c] ?? 0) - (p[3 * a] ?? 0), (p[3 * c + 1] ?? 0) - (p[3 * a + 1] ?? 0), (p[3 * c + 2] ?? 0) - (p[3 * a + 2] ?? 0)];
    const n = [
      (u[1] ?? 0) * (w[2] ?? 0) - (u[2] ?? 0) * (w[1] ?? 0),
      (u[2] ?? 0) * (w[0] ?? 0) - (u[0] ?? 0) * (w[2] ?? 0),
      (u[0] ?? 0) * (w[1] ?? 0) - (u[1] ?? 0) * (w[0] ?? 0),
    ];
    const plane = planes[mesh.faceOfTriangle[i] ?? 0];
    if (plane === undefined) return `triangle ${i}: missing plane`;
    const d = (n[0] ?? 0) * plane.normal[0] + (n[1] ?? 0) * plane.normal[1] + (n[2] ?? 0) * plane.normal[2];
    if (!(d > 0)) return `triangle ${i} faces inward or is degenerate`;
  }
  return null;
}

/**
 * Every vertex satisfies every plane within the quantization error (half a
 * unit per axis) plus the documented removal of faces below 64 units and the
 * collapse of edges below 4 units (halfspace.ts, steps 3–4).
 */
export function checkConvex(mesh: MeshLike, planes: readonly PlaneLike[]): string | null {
  const p = mesh.positions;
  for (let v = 0; v < p.length / 3; v++) {
    const x = [(p[3 * v] ?? 0) / 65536, (p[3 * v + 1] ?? 0) / 65536, (p[3 * v + 2] ?? 0) / 65536];
    for (const pl of planes) {
      const l1 = Math.abs(pl.normal[0]) + Math.abs(pl.normal[1]) + Math.abs(pl.normal[2]);
      const l2 = Math.sqrt(pl.normal[0] ** 2 + pl.normal[1] ** 2 + pl.normal[2] ** 2);
      const tol = (0.5 * l1 + 68 * l2) / 65536;
      const excess = pl.normal[0] * (x[0] ?? 0) + pl.normal[1] * (x[1] ?? 0) + pl.normal[2] * (x[2] ?? 0) - pl.distance;
      if (excess > tol) return `vertex ${v} outside a plane by ${excess}`;
    }
  }
  return null;
}

/**
 * Every vertex of every triangle lies on its face plane (same tolerance as
 * checkConvex): faces are planar polygons of the half-space intersection.
 */
export function checkOnFacePlane(mesh: MeshLike, planes: readonly PlaneLike[]): string | null {
  const p = mesh.positions;
  const t = mesh.indices;
  for (let i = 0; i < t.length / 3; i++) {
    const pl = planes[mesh.faceOfTriangle[i] ?? 0];
    if (pl === undefined) return `triangle ${i}: missing plane`;
    const l1 = Math.abs(pl.normal[0]) + Math.abs(pl.normal[1]) + Math.abs(pl.normal[2]);
    const l2 = Math.sqrt(pl.normal[0] ** 2 + pl.normal[1] ** 2 + pl.normal[2] ** 2);
    const tol = (0.5 * l1 + 68 * l2) / 65536;
    for (let k = 0; k < 3; k++) {
      const v = t[3 * i + k] ?? 0;
      const off = pl.normal[0] * (p[3 * v] ?? 0) / 65536 + pl.normal[1] * (p[3 * v + 1] ?? 0) / 65536 + pl.normal[2] * (p[3 * v + 2] ?? 0) / 65536 - pl.distance;
      if (Math.abs(off) > tol) return `triangle ${i}: vertex ${v} is ${off} off its face plane`;
    }
  }
  return null;
}

export function checkCanonicalOrder(mesh: MeshLike): string | null {
  const p = mesh.positions;
  for (let v = 1; v < p.length / 3; v++) {
    const a = [p[3 * v - 3] ?? 0, p[3 * v - 2] ?? 0, p[3 * v - 1] ?? 0];
    const b = [p[3 * v] ?? 0, p[3 * v + 1] ?? 0, p[3 * v + 2] ?? 0];
    const cmp = (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0) || (a[2] ?? 0) - (b[2] ?? 0);
    if (cmp >= 0) return `vertices ${v - 1}, ${v} not strictly ordered`;
  }
  const t = mesh.indices;
  for (let i = 0; i < t.length; i += 3) {
    if (!((t[i] ?? 0) < (t[i + 1] ?? 0) && (t[i] ?? 0) < (t[i + 2] ?? 0))) return `triangle ${i / 3} does not start at its lowest index`;
    if (i > 0) {
      const cmp = (t[i - 3] ?? 0) - (t[i] ?? 0) || (t[i - 2] ?? 0) - (t[i + 1] ?? 0) || (t[i - 1] ?? 0) - (t[i + 2] ?? 0);
      if (cmp > 0) return `triangles ${i / 3 - 1}, ${i / 3} out of order`;
    }
  }
  return null;
}
