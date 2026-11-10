import { describe, expect, it } from 'vitest';
import { intersectHalfSpaces, PolytopeError, type Plane } from '../src/geometry/halfspace.ts';
import { DIRECTIONS_30 } from '../src/geometry/linear.ts';
import { checkCanonicalOrder, checkClosedAndOriented, checkConvex, checkOutwardWinding, euler } from './mesh-checks.ts';

const cube: Plane[] = [
  { normal: [1, 0, 0], distance: 1, form: 'x' },
  { normal: [-1, 0, 0], distance: 1, form: 'x' },
  { normal: [0, 1, 0], distance: 1, form: 'y' },
  { normal: [0, -1, 0], distance: 1, form: 'y' },
  { normal: [0, 0, 1], distance: 1, form: 'z' },
  { normal: [0, 0, -1], distance: 1, form: 'z' },
];

function prism(directions: readonly number[], distance: number): Plane[] {
  return [
    ...directions.map((k): Plane => {
      const [c, s] = DIRECTIONS_30[k] ?? [1, 0];
      return { normal: [c, s, 0], distance, form: 'prism' };
    }),
    { normal: [0, 0, 1], distance: 1, form: 'pinacoid' },
    { normal: [0, 0, -1], distance: 1, form: 'pinacoid' },
  ];
}

function allChecks(planes: Plane[]) {
  const m = intersectHalfSpaces(planes);
  expect(checkClosedAndOriented(m)).toBeNull();
  expect(checkOutwardWinding(m, planes)).toBeNull();
  expect(checkConvex(m, planes)).toBeNull();
  expect(checkCanonicalOrder(m)).toBeNull();
  expect(euler(m)).toEqual({ triangles: 2, faces: 2 });
  return m;
}

describe('intersectHalfSpaces', () => {
  it('builds a cube: 8 vertices, 12 triangles, 6 faces, quantized to 2^-16', () => {
    const m = allChecks(cube);
    expect(m.positions.length / 3).toBe(8);
    expect(m.indices.length / 3).toBe(12);
    expect(new Set(Array.from(m.faceOfTriangle)).size).toBe(6);
    expect(Array.from(m.positions.slice(0, 3))).toEqual([-65536, -65536, -65536]);
  });

  it('builds a hexagonal prism from exact 60° directions', () => {
    const m = allChecks(prism([0, 2, 4, 6, 8, 10], 1));
    expect(m.positions.length / 3).toBe(12);
    expect(m.indices.length / 3).toBe(6 * 2 + 2 * 4);
  });

  it('ignores a redundant plane and a plane tangent at an edge (faces emerge from size zero)', () => {
    const redundant = allChecks([...cube, { normal: [1, 1, 0], distance: 3, form: 'far' }]);
    expect(redundant.positions.length / 3).toBe(8);
    // Plane x + y ≤ 2 touches the cube only along the edge x = y = 1: no face.
    const tangent = allChecks([...cube, { normal: [1, 1, 0], distance: 2, form: 'touch' }]);
    expect(tangent.indices.length / 3).toBe(12);
    expect(Array.from(tangent.faceOfTriangle)).not.toContain(6);
    // Slightly closer, it cuts a thin bevel: a new face appears with tiny area.
    const bevel = allChecks([...cube, { normal: [1, 1, 0], distance: 1.999, form: 'bevel' }]);
    expect(Array.from(bevel.faceOfTriangle)).toContain(6);
  });

  it('a trigonal prism truncated by a far second trigonal prism stays trigonal until it touches', () => {
    const tri = prism([0, 4, 8], 1);
    const touching = allChecks([...tri, ...prism([2, 6, 10], 2).slice(0, 3)]);
    expect(touching.positions.length / 3).toBe(6);
    const cut = allChecks([...tri, ...prism([2, 6, 10], 1.9).slice(0, 3)]);
    expect(cut.positions.length / 3).toBe(12);
  });

  it('is deterministic and order-canonical regardless of plane order of equal sets', () => {
    const a = intersectHalfSpaces(cube);
    expect(intersectHalfSpaces(cube)).toEqual(a);
    expect(Array.from(intersectHalfSpaces([...cube].reverse()).positions)).toEqual(Array.from(a.positions));
  });

  it('rejects unbounded input with a typed error', () => {
    expect(() => intersectHalfSpaces(cube.slice(0, 4))).toThrow(PolytopeError);
  });
});
