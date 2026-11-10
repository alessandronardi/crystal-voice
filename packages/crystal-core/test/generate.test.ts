import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CrystalSeed, SeedConfidence } from '@voicecrystal/contracts';
import { generateCrystalGeometry, GeometryInputError, MAX_TRIANGLES } from '../src/index.ts';
import { checkCanonicalOrder, checkClosedAndOriented, checkConvex, checkOnFacePlane, checkOutwardWinding, euler } from './mesh-checks.ts';

const FULL: SeedConfidence = [1, 1, 1, 1, 1, 1];
const units = fc.integer({ min: 0, max: 10000 });
const seedArb = fc.tuple(units, units, units, units, units, units) as fc.Arbitrary<CrystalSeed>;
// Edges of the mapping segments, where faces start to emerge.
const edgeUnits = fc.constantFrom(0, 1, 2500, 3000, 3001, 3500, 4000, 5000, 5100, 9000, 9999, 10000);
const edgeSeedArb = fc.tuple(edgeUnits, edgeUnits, edgeUnits, edgeUnits, units, units) as fc.Arbitrary<CrystalSeed>;

function checkGeometry(seed: CrystalSeed): void {
  const g = generateCrystalGeometry(seed, FULL, 'habit-1');
  expect(g.bodies[0]?.kind).toBe('primary');
  let triangles = 0;
  for (const body of g.bodies) {
    expect(checkClosedAndOriented(body), 'closed').toBeNull();
    expect(checkOutwardWinding(body, body.planes), 'winding').toBeNull();
    expect(checkConvex(body, body.planes), 'convex').toBeNull();
    expect(checkOnFacePlane(body, body.planes), 'planar faces').toBeNull();
    expect(checkCanonicalOrder(body), 'canonical').toBeNull();
    expect(euler(body), 'Euler V − E + F').toEqual({ triangles: 2, faces: 2 });
    for (const v of body.positions) expect(Number.isInteger(v)).toBe(true);
    triangles += body.faceOfTriangle.length;
  }
  expect(triangles).toBeLessThanOrEqual(MAX_TRIANGLES);
  const primary = g.bodies[0];
  for (const inc of g.inclusions) {
    expect(inc.transform).toHaveLength(16);
    for (const v of inc.transform) expect(Number.isInteger(v)).toBe(true);
    if (inc.kind !== 'needle' || primary === undefined) continue;
    // Contract: needle axis z ∈ [−½, ½] in local units; both ends inside the primary.
    const m = inc.transform.map((v) => v / 65536);
    for (const z of [-0.5, 0.5]) {
      const end = [(m[2] ?? 0) * z + (m[3] ?? 0), (m[6] ?? 0) * z + (m[7] ?? 0), (m[10] ?? 0) * z + (m[11] ?? 0)];
      for (const pl of primary.planes) {
        const out = pl.normal[0] * (end[0] ?? 0) + pl.normal[1] * (end[1] ?? 0) + pl.normal[2] * (end[2] ?? 0) - pl.distance;
        expect(out, 'needle end inside the primary').toBeLessThanOrEqual(1e-4);
      }
    }
  }
  expect(g.geometryHash).toMatch(/^[0-9a-f]{64}$/);
}

describe('generateCrystalGeometry habit-1: mesh properties', () => {
  it('convex, closed, outward-wound, canonical, finite, within budget (random seeds)', () => {
    fc.assert(
      fc.property(seedArb, (s) => {
        checkGeometry(s);
      }),
      { numRuns: 400 },
    );
  }, 30_000); // the 5 s default timed out once (5.2 s) under parallel load

  it('same properties on the edges of the mapping segments (faces of size ~0)', () => {
    fc.assert(
      fc.property(edgeSeedArb, (s) => {
        checkGeometry(s);
      }),
      { numRuns: 400 },
    );
  }, 30_000); // the 5 s default timed out once (5.2 s) under parallel load

  it('regression: welded sliver on a tilted secondary (seed found by fast-check)', () => {
    checkGeometry([1, 5100, 4000, 9000, 0, 0]);
  });
});

describe('secondaries are born near size 0 (SPEC §10, review I-10 H1)', () => {
  it('when a secondary first appears along p3 (step 1), it is at most 300 quantization units wide', () => {
    const extentOf = (positions: Int32Array): number => {
      let extent = 0;
      for (let axis = 0; axis < 3; axis++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let k = axis; k < positions.length; k += 3) {
          lo = Math.min(lo, positions[k] ?? 0);
          hi = Math.max(hi, positions[k] ?? 0);
        }
        extent = Math.max(extent, hi - lo);
      }
      return extent;
    };
    for (const base of [[5000, 5000, 5000], [1000, 8000, 2000], [9000, 3000, 7000], [2500, 6000, 9500]]) {
      const at = (p3: number) => generateCrystalGeometry([base[0] ?? 0, base[1] ?? 0, p3, base[2] ?? 0, 0, 0], FULL, 'habit-1');
      let births = 0;
      // Coarse scan, then step 1 inside each interval where a body appears.
      for (let lo = 0; lo < 10000; lo += 50) {
        if (at(Math.min(10000, lo + 50)).bodies.length <= at(lo).bodies.length) continue;
        let previous = at(lo).bodies.length;
        for (let p3 = lo + 1; p3 <= Math.min(10000, lo + 50); p3++) {
          const g = at(p3);
          if (g.bodies.length > previous) {
            // The newborn is the smallest secondary (bodies are listed by slot, not by age).
            const smallest = Math.min(...g.bodies.filter((b) => b.kind === 'secondary').map((b) => extentOf(b.positions)));
            expect(smallest).toBeLessThanOrEqual(300);
            births++;
          }
          previous = g.bodies.length;
        }
      }
      expect(births).toBeGreaterThan(0);
    }
  }, 60_000);
});

describe('determinism and versioning', () => {
  it('two calls give bit-identical output', () => {
    const s: CrystalSeed = [1234, 5678, 9012, 3456, 7890, 1234];
    expect(generateCrystalGeometry(s, FULL, 'habit-1')).toEqual(generateCrystalGeometry(s, FULL, 'habit-1'));
  });

  it('p5 and p6 change only the appearance, never the geometry or its hash', () => {
    fc.assert(
      fc.property(seedArb, units, units, (s, p5, p6) => {
        const a = generateCrystalGeometry(s, FULL, 'habit-1');
        const b = generateCrystalGeometry([s[0], s[1], s[2], s[3], p5, p6], FULL, 'habit-1');
        expect(b.geometryHash).toBe(a.geometryHash);
        expect(b.bodies).toEqual(a.bodies);
      }),
      { numRuns: 20 },
    );
  });

  it('each geometric parameter changes the hash', () => {
    const base: CrystalSeed = [3000, 3000, 6000, 6000, 0, 0];
    const h = generateCrystalGeometry(base, FULL, 'habit-1').geometryHash;
    for (let k = 0; k < 4; k++) {
      const s = [...base] as [number, number, number, number, number, number];
      s[k] = (s[k] ?? 0) + 500;
      expect(generateCrystalGeometry(s, FULL, 'habit-1').geometryHash).not.toBe(h);
    }
  });

  it('veils traits with confidence < 0.5 and keeps appearance values in range', () => {
    const g = generateCrystalGeometry([0, 0, 0, 0, 10000, 10000], [0.9, 0.49, 0.5, 0.1, 1, 0], 'habit-1');
    expect(g.appearance.veiledTraits).toEqual(['p2_intonation', 'p4_roughness', 'p6_rhythm']);
    expect(g.appearance.zoningBands).toBe(8);
    expect(g.appearance.colorOklch).toEqual([0.52, 0.16, 265]);
  });

  it('names the habit along the p1 and p2 paths', () => {
    const name = (p1: number, p2: number) => generateCrystalGeometry([p1, p2, 5000, 0, 0, 0], FULL, 'habit-1').habitName;
    expect(name(0, 0)).toBe('prisma trigonale con pinacoide');
    expect(name(2000, 0)).toBe('prisma trigonale smussato con pinacoide');
    expect(name(4500, 4000)).toBe('prisma esagonale con romboedro');
    expect(name(7000, 4000)).toBe('prisma esagonale smussato con romboedro');
    expect(name(10000, 10000)).toBe('prisma esagonale doppio con bipiramide esagonale');
  });

  it('rejects invalid input with typed errors', () => {
    expect(() => generateCrystalGeometry([1, 2, 3, 4, 5, 6.5] as unknown as CrystalSeed, FULL, 'habit-1')).toThrow(GeometryInputError);
    expect(() => generateCrystalGeometry([1, 2, 3, 4, 5, 6], [2, 0, 0, 0, 0, 0], 'habit-1')).toThrow(GeometryInputError);
    expect(() => generateCrystalGeometry([1, 2, 3, 4, 5, 6], FULL, 'habit-2')).toThrow(GeometryInputError);
    expect(() => generateCrystalGeometry([1, 2, 3, 4, 5, 6], FULL, 'toString')).toThrow(GeometryInputError);
  });
});
