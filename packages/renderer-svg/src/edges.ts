// Feature edges of a body: mesh edges whose two triangles belong to different
// face planes. Edges between two triangles of the same face are fan diagonals
// and are not drawn. The mesh is closed (I-10), so every edge has exactly two
// triangles.

import type { CrystalBody } from '@voicecrystal/contracts';
import { PlateViewError } from './errors.ts';

export interface FeatureEdge {
  /** Vertex indices, a < b. */
  a: number;
  b: number;
  /** The two face planes (indices into `planes`) that meet at the edge. */
  f1: number;
  f2: number;
}

/** Feature edges in canonical order: by a, then by b. */
export function featureEdges(body: CrystalBody): FeatureEdge[] {
  const vertexCount = body.positions.length / 3;
  const faces = new Map<number, number[]>();
  const triangles = body.faceOfTriangle.length;
  for (let t = 0; t < triangles; t++) {
    const face = body.faceOfTriangle[t] ?? 0;
    for (let k = 0; k < 3; k++) {
      const p = body.indices[3 * t + k] ?? 0;
      const q = body.indices[3 * t + ((k + 1) % 3)] ?? 0;
      const key = p < q ? p * vertexCount + q : q * vertexCount + p;
      const list = faces.get(key);
      if (list === undefined) faces.set(key, [face]);
      else list.push(face);
    }
  }
  const edges: FeatureEdge[] = [];
  for (const [key, list] of faces) {
    if (list.length !== 2) throw new PlateViewError('OPEN_MESH', `edge with ${list.length} triangles: the body is not closed`);
    const [f1 = 0, f2 = 0] = list;
    if (f1 === f2) continue;
    const a = Math.floor(key / vertexCount);
    edges.push({ a, b: key - a * vertexCount, f1, f2 });
  }
  return edges.sort((p, q) => p.a - q.a || p.b - q.b);
}
