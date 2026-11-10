// CrystalBody → flat-shaded, non-indexed vertex arrays for WebGL.
// Pure: no Three.js, no DOM, so it is fully tested in Node.
//
// Face normals come from planes[faceOfTriangle[t]].normal, never from the
// triangles (contract CrystalBody, review I-10: thin fan triangles can deviate
// by ~17° after quantization). The three vertices of a triangle share the
// normal of its face plane, so every face renders as one flat facet.

import { POSITION_UNITS_PER_LENGTH, type CrystalBody } from '@voicecrystal/contracts';
import { RenderInputError } from './errors.ts';

/** Prism faces vs everything else (terminations and pinacoid), for veiling p1 and p2 separately. */
export type FaceClass = 'prism' | 'termination';

export const FACE_CLASSES: readonly FaceClass[] = ['prism', 'termination'];

export const faceClassOf = (form: string): FaceClass => (form.startsWith('prism') ? 'prism' : 'termination');

export interface MeshGroup {
  /** First vertex (not triangle) of the group, as BufferGeometry.addGroup expects. */
  start: number;
  /** Number of vertices. */
  count: number;
  /** Index into the material array: 0 = prism, 1 = termination. */
  materialIndex: number;
  faceClass: FaceClass;
}

export interface MeshArrays {
  /** xyz per vertex, length units (positions / 2^16). */
  positions: Float32Array;
  /** Unit face normal per vertex. */
  normals: Float32Array;
  /** Triangles grouped by face class (prism first), canonical order kept inside each group. */
  groups: readonly MeshGroup[];
  triangleCount: number;
}

/** Unit normals of every plane; throws on a zero or non-finite normal. */
export function unitPlaneNormals(body: CrystalBody): Float64Array {
  const out = new Float64Array(body.planes.length * 3);
  body.planes.forEach((plane, i) => {
    const [x, y, z] = plane.normal;
    const len = Math.hypot(x, y, z);
    if (!Number.isFinite(len)) throw new RenderInputError('NON_FINITE', `plane ${i} has a non-finite normal`);
    if (len === 0) throw new RenderInputError('ZERO_FACE_NORMAL', `plane ${i} has a zero normal`);
    out[3 * i] = x / len;
    out[3 * i + 1] = y / len;
    out[3 * i + 2] = z / len;
  });
  return out;
}

export function bodyToMeshArrays(body: CrystalBody): MeshArrays {
  const triangleCount = body.faceOfTriangle.length;
  if (body.indices.length !== 3 * triangleCount || body.positions.length % 3 !== 0) {
    throw new RenderInputError('MALFORMED_BODY', 'indices, faceOfTriangle and positions have inconsistent lengths');
  }
  const vertexCount = body.positions.length / 3;
  const normals = unitPlaneNormals(body);

  // Stable partition: prism triangles first, then terminations.
  const order: number[][] = FACE_CLASSES.map(() => []);
  for (let t = 0; t < triangleCount; t++) {
    const face = body.faceOfTriangle[t] ?? -1;
    const plane = body.planes[face];
    if (plane === undefined) {
      throw new RenderInputError('FACE_INDEX_OUT_OF_RANGE', `triangle ${t} refers to plane ${face} of ${body.planes.length}`);
    }
    order[FACE_CLASSES.indexOf(faceClassOf(plane.form))]?.push(t);
  }

  const positions = new Float32Array(triangleCount * 9);
  const outNormals = new Float32Array(triangleCount * 9);
  const groups: MeshGroup[] = [];
  let written = 0;
  FACE_CLASSES.forEach((faceClass, materialIndex) => {
    const triangles = order[materialIndex] ?? [];
    if (triangles.length > 0) groups.push({ start: written * 3, count: triangles.length * 3, materialIndex, faceClass });
    for (const t of triangles) {
      const face = body.faceOfTriangle[t] ?? 0;
      for (let k = 0; k < 3; k++) {
        const v = body.indices[3 * t + k] ?? -1;
        if (v < 0 || v >= vertexCount) {
          throw new RenderInputError('VERTEX_INDEX_OUT_OF_RANGE', `triangle ${t} refers to vertex ${v} of ${vertexCount}`);
        }
        const o = (written * 3 + k) * 3;
        for (let c = 0; c < 3; c++) {
          const p = (body.positions[3 * v + c] ?? 0) / POSITION_UNITS_PER_LENGTH;
          positions[o + c] = p;
          outNormals[o + c] = normals[3 * face + c] ?? 0;
        }
      }
      written++;
    }
  });
  return { positions, normals: outNormals, groups, triangleCount };
}

/** Largest distance from the origin of any vertex, in length units. */
export function boundingRadius(body: CrystalBody): number {
  let max = 0;
  for (let i = 0; i < body.positions.length; i += 3) {
    const r = Math.hypot(body.positions[i] ?? 0, body.positions[i + 1] ?? 0, body.positions[i + 2] ?? 0);
    if (r > max) max = r;
  }
  return max / POSITION_UNITS_PER_LENGTH;
}

/** Height range along the c axis (z), in length units, used by the zoning bands. */
export function zRange(body: CrystalBody): readonly [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 2; i < body.positions.length; i += 3) {
    const z = body.positions[i] ?? 0;
    if (z < lo) lo = z;
    if (z > hi) hi = z;
  }
  if (lo > hi) return [0, 0];
  return [lo / POSITION_UNITS_PER_LENGTH, hi / POSITION_UNITS_PER_LENGTH];
}

/** Per-vertex texture coordinate u = normalized height along c, v = 0.5 (1-D zoning texture). */
export function zoningUvs(arrays: MeshArrays, range: readonly [number, number]): Float32Array {
  const n = arrays.positions.length / 3;
  const uv = new Float32Array(n * 2);
  const span = range[1] - range[0];
  for (let i = 0; i < n; i++) {
    const z = arrays.positions[3 * i + 2] ?? 0;
    uv[2 * i] = span > 0 ? Math.min(1, Math.max(0, (z - range[0]) / span)) : 0.5;
    uv[2 * i + 1] = 0.5;
  }
  return uv;
}
