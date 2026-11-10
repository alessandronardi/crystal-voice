import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DESCRIPTOR_KEYS, POSITION_UNITS_PER_LENGTH, type CrystalBody, type CrystalSeed, type DescriptorKey } from '@voicecrystal/contracts';
import { generateCrystalGeometry, MAX_TRIANGLES } from '@voicecrystal/crystal-core';
import {
  bodyToMeshArrays,
  checkBudget,
  boundingRadius,
  FRAMING_RADIUS,
  needleMatrices,
  oklabToLinearSrgb,
  oklchToLinearSrgb,
  paletteFor,
  phantomMatrices,
  RenderInputError,
  roughnessFor,
  ROUGHNESS_FROSTED,
  ROUGHNESS_POLISHED,
  turntableAngle,
  TURNTABLE_PERIOD_MS,
  veilFromTraits,
  veilIsVisible,
  NEEDLE_RADIUS_FACTOR_VEILED,
  zoningTexels,
  zoningUvs,
  zRange,
} from '../src/pure/index.ts';

const FULL = [1, 1, 1, 1, 1, 1] as const;

function at<T>(a: ArrayLike<T>, i: number): T {
  const v = a[i];
  if (v === undefined) throw new RangeError(`index ${i} out of range`);
  return v;
}
const seedArb = fc.tuple(...Array.from({ length: 6 }, () => fc.integer({ min: 0, max: 10000 }))) as unknown as fc.Arbitrary<CrystalSeed>;
const gen = (seed: CrystalSeed) => generateCrystalGeometry(seed, FULL, 'habit-1');

/** Unit normal of a triangle from its (unquantized) vertices; independent from the code under test. */
function triangleNormal(p: Float32Array, t: number): [number, number, number] {
  const o = t * 9;
  const u = [at(p, o + 3) - at(p, o), at(p, o + 4) - at(p, o + 1), at(p, o + 5) - at(p, o + 2)];
  const v = [at(p, o + 6) - at(p, o), at(p, o + 7) - at(p, o + 1), at(p, o + 8) - at(p, o + 2)];
  const n = [at(u, 1) * at(v, 2) - at(u, 2) * at(v, 1), at(u, 2) * at(v, 0) - at(u, 0) * at(v, 2), at(u, 0) * at(v, 1) - at(u, 1) * at(v, 0)];
  const len = Math.hypot(at(n, 0), at(n, 1), at(n, 2));
  return [at(n, 0) / len, at(n, 1) / len, at(n, 2) / len];
}

describe('bodyToMeshArrays', () => {
  it('uses the face plane normal for all three vertices of every triangle (400 seeds)', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const g = gen(seed);
        for (const body of g.bodies) {
          const arrays = bodyToMeshArrays(body);
          expect(arrays.triangleCount).toBe(body.faceOfTriangle.length);
          expect(arrays.positions.length).toBe(body.faceOfTriangle.length * 9);
          expect(arrays.positions.every(Number.isFinite)).toBe(true);
          expect(arrays.normals.every(Number.isFinite)).toBe(true);
          // Rebuild the triangle → face map from the groups to compare with planes.
          const faces: number[] = [];
          const byClass = (cls: string) => [...body.faceOfTriangle].filter((f) => (at(body.planes, f).form.startsWith('prism') ? 'prism' : 'termination') === cls);
          for (const group of arrays.groups) faces.push(...byClass(group.faceClass));
          let maxDeviation = 0;
          faces.forEach((face, t) => {
            const [x, y, z] = at(body.planes, face).normal;
            const len = Math.hypot(x, y, z);
            for (let k = 0; k < 3; k++) {
              const o = (t * 3 + k) * 3;
              maxDeviation = Math.max(
                maxDeviation,
                Math.abs(at(arrays.normals, o) - x / len),
                Math.abs(at(arrays.normals, o + 1) - y / len),
                Math.abs(at(arrays.normals, o + 2) - z / len),
              );
            }
          });
          // Float32 storage of a unit vector: ~6e-8.
          expect(maxDeviation).toBeLessThan(1e-6);
        }
      }),
      { numRuns: 400, seed: 0x11e1 },
    );
  }, 60_000);

  it('keeps triangle winding outward: geometric normal agrees in sign with the plane normal', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        // Every body: secondaries are drawn FrontSide too.
        let minDot = 1;
        for (const body of gen(seed).bodies) {
          const arrays = bodyToMeshArrays(body);
          for (let t = 0; t < arrays.triangleCount; t++) {
            const n = triangleNormal(arrays.positions, t);
            const o = t * 9;
            minDot = Math.min(minDot, n[0] * at(arrays.normals, o) + n[1] * at(arrays.normals, o + 1) + n[2] * at(arrays.normals, o + 2));
          }
        }
        // Thin fan triangles can deviate (review I-10, ~17°), never flip.
        expect(minDot).toBeGreaterThan(0.5);
      }),
      { numRuns: 200, seed: 0x11e2 },
    );
  }, 60_000);

  it('dequantizes positions at 2^-16 and groups prism faces before terminations', () => {
    const body = at(gen([5000, 5000, 5000, 5000, 5000, 5000]).bodies, 0);
    const arrays = bodyToMeshArrays(body);
    expect(arrays.groups.map((g) => g.faceClass)).toEqual(['prism', 'termination']);
    expect(arrays.groups.map((g) => g.materialIndex)).toEqual([0, 1]);
    expect(arrays.groups.reduce((s, g) => s + g.count, 0)).toBe(arrays.triangleCount * 3);
    const all = new Set<string>();
    for (let i = 0; i < body.positions.length; i += 3) {
      all.add([0, 1, 2].map((c) => (at(body.positions, i + c) / POSITION_UNITS_PER_LENGTH).toFixed(5)).join());
    }
    for (let i = 0; i < arrays.positions.length; i += 3) {
      expect(all.has([0, 1, 2].map((c) => at(arrays.positions, i + c).toFixed(5)).join())).toBe(true);
    }
  });

  it('rejects malformed bodies with typed errors', () => {
    const body = at(gen([5000, 5000, 5000, 5000, 5000, 5000]).bodies, 0);
    const code = (b: CrystalBody) => {
      try {
        bodyToMeshArrays(b);
      } catch (e) {
        return e instanceof RenderInputError ? e.code : 'untyped';
      }
      return 'none';
    };
    const badFace = Uint16Array.from(body.faceOfTriangle);
    badFace[0] = body.planes.length;
    expect(code({ ...body, faceOfTriangle: badFace })).toBe('FACE_INDEX_OUT_OF_RANGE');
    const badIndex = Uint32Array.from(body.indices);
    badIndex[0] = body.positions.length;
    expect(code({ ...body, indices: badIndex })).toBe('VERTEX_INDEX_OUT_OF_RANGE');
    expect(code({ ...body, indices: body.indices.subarray(3) })).toBe('MALFORMED_BODY');
    const zero = body.planes.map((p, i) => (i === 0 ? { ...p, normal: [0, 0, 0] as const } : p));
    expect(code({ ...body, planes: zero })).toBe('ZERO_FACE_NORMAL');
    const nan = body.planes.map((p, i) => (i === 0 ? { ...p, normal: [Number.NaN, 0, 0] as const } : p));
    expect(code({ ...body, planes: nan })).toBe('NON_FINITE');
  });
});

describe('framing', () => {
  it('every body of 2000 seeds fits in FRAMING_RADIUS', () => {
    let max = 0;
    fc.assert(
      fc.property(seedArb, (seed) => {
        for (const body of gen(seed).bodies) max = Math.max(max, boundingRadius(body));
      }),
      { numRuns: 2000, seed: 0x11e3 },
    );
    expect(max).toBeGreaterThan(1);
    expect(max).toBeLessThan(FRAMING_RADIUS);
  }, 60_000);

  it('zoning coordinates span [0, 1] along c', () => {
    const body = at(gen([2000, 7000, 9000, 3000, 5000, 9000]).bodies, 0);
    const arrays = bodyToMeshArrays(body);
    const uv = zoningUvs(arrays, zRange(body));
    const us = [...uv].filter((_, i) => i % 2 === 0);
    expect(Math.min(...us)).toBeCloseTo(0, 6);
    expect(Math.max(...us)).toBeCloseTo(1, 6);
  });
});

describe('inclusions', () => {
  it('needle matrices are column-major copies of the row-major transforms, widened only in x and y', () => {
    const g = gen([5000, 5000, 5000, 9000, 5000, 5000]);
    const needles = g.inclusions.filter((i) => i.kind === 'needle');
    expect(needles.length).toBeGreaterThan(0);
    const plain = needleMatrices(g.inclusions, 1);
    const wide = needleMatrices(g.inclusions, 2);
    needles.forEach((needle, n) => {
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
          const expected = at(needle.transform, row * 4 + col) / POSITION_UNITS_PER_LENGTH;
          expect(plain[n * 16 + col * 4 + row]).toBeCloseTo(expected, 6);
          const factor = row < 3 && col < 2 ? 2 : 1;
          expect(wide[n * 16 + col * 4 + row]).toBeCloseTo(expected * factor, 6);
        }
      }
    });
  });

  it('phantoms keep their transform and malformed transforms throw typed errors', () => {
    const g = gen([5000, 5000, 5000, 10000, 5000, 5000]);
    expect(phantomMatrices(g.inclusions).length).toBe(g.inclusions.filter((i) => i.kind === 'phantom').length);
    expect(() => needleMatrices([{ kind: 'needle', transform: [1, 2, 3] }], 1)).toThrow(RenderInputError);
    expect(() => needleMatrices([{ kind: 'needle', transform: Array.from({ length: 16 }, () => Number.NaN) }], 1)).toThrow(RenderInputError);
  });
});

describe('colour', () => {
  it('OKLab white and black map to sRGB white and black', () => {
    const w = oklabToLinearSrgb(1, 0, 0);
    const k = oklabToLinearSrgb(0, 0, 0);
    w.forEach((v) => {
      expect(v).toBeCloseTo(1, 4);
    });
    k.forEach((v) => {
      expect(v).toBeCloseTo(0, 6);
    });
  });

  it('always returns an in-gamut colour, and desaturation lowers chroma', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 0.4, noNaN: true }), fc.double({ min: 0, max: 360, noNaN: true }), (l, c, h) => {
        const rgb = oklchToLinearSrgb(l, c, h);
        rgb.forEach((v) => {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        });
        const spread = (x: readonly number[]) => Math.max(...x) - Math.min(...x);
        expect(spread(oklchToLinearSrgb(l, c, h, 0.25))).toBeLessThanOrEqual(spread(rgb) + 1e-9);
      }),
      { numRuns: 500, seed: 0x11e4 },
    );
  });
});

describe('veiled traits (ADR-0014)', () => {
  const ALL = DESCRIPTOR_KEYS;

  /** Everything the scene reads from the look for this geometry; elements that do not exist do not count. */
  function sceneInputs(geometry: ReturnType<typeof gen>, traits: readonly DescriptorKey[]): string {
    const veil = veilFromTraits(traits);
    const palette = paletteFor(geometry.appearance, veil);
    const hasSecondary = geometry.bodies.some((b) => b.kind === 'secondary');
    const inputs: unknown[] = [roughnessFor('prism', false, veil), roughnessFor('termination', false, veil), palette.body];
    if (hasSecondary) inputs.push(roughnessFor('prism', true, veil), roughnessFor('termination', true, veil), veil.secondaryFrosted);
    if (geometry.inclusions.length > 0) {
      inputs.push(palette.inclusion, palette.phantom, [...needleMatrices(geometry.inclusions, veil.inclusionsBlurred ? NEEDLE_RADIUS_FACTOR_VEILED : 1)]);
    }
    if (geometry.appearance.zoningBands > 1) inputs.push([...zoningTexels(geometry.appearance.zoningBands, veil)]);
    return JSON.stringify(inputs);
  }

  it('a veil changes the scene exactly when its element exists (600 random seeds)', () => {
    const invisible: Record<string, number> = {};
    fc.assert(
      fc.property(seedArb, (seed) => {
        const g = gen(seed);
        const plain = sceneInputs(g, []);
        for (const trait of ALL) {
          const changed = sceneInputs(g, [trait]) !== plain;
          expect(changed, `${trait} on ${JSON.stringify(seed)}`).toBe(veilIsVisible(trait, g));
          if (!changed) invisible[trait] = (invisible[trait] ?? 0) + 1;
        }
      }),
      { numRuns: 600, seed: 0x11e5 },
    );
    // The documented case exists: without secondaries, inclusions or bands only the label can say it.
    expect(Object.keys(invisible).sort()).toEqual(['p3_dynamics', 'p4_roughness', 'p6_rhythm']);
  }, 60_000);

  it('maps each descriptor to exactly one effect', () => {
    const effects = ALL.map((k) => Object.entries(veilFromTraits([k])).filter(([, v]) => v).map(([e]) => e));
    effects.forEach((e) => {
      expect(e).toHaveLength(1);
    });
    expect(new Set(effects.flat()).size).toBe(6);
    expect(Object.values(veilFromTraits([])).every((v) => !v)).toBe(true);
  });

  it('frosts the right faces and leaves the others polished', () => {
    const p1 = veilFromTraits(['p1_pitch']);
    expect(roughnessFor('prism', false, p1)).toBe(ROUGHNESS_FROSTED);
    expect(roughnessFor('termination', false, p1)).toBe(ROUGHNESS_POLISHED);
    const p2 = veilFromTraits(['p2_intonation']);
    expect(roughnessFor('prism', false, p2)).toBe(ROUGHNESS_POLISHED);
    expect(roughnessFor('termination', false, p2)).toBe(ROUGHNESS_FROSTED);
    const p3 = veilFromTraits(['p3_dynamics']);
    expect(roughnessFor('prism', false, p3)).toBe(ROUGHNESS_POLISHED);
    expect(roughnessFor('prism', true, p3)).toBe(ROUGHNESS_FROSTED);
  });

  it('desaturates the colour (p5) and fades the inclusions (p4)', () => {
    const appearance = gen([5000, 5000, 5000, 5000, 1000, 5000]).appearance;
    const plain = paletteFor(appearance, veilFromTraits([]));
    const p5 = paletteFor(appearance, veilFromTraits(['p5_brightness']));
    const spread = (x: readonly number[]) => Math.max(...x) - Math.min(...x);
    expect(spread(p5.body)).toBeLessThan(spread(plain.body) * 0.5);
    const p4 = paletteFor(appearance, veilFromTraits(['p4_roughness']));
    const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((v, i) => v - at(b, i)));
    expect(dist(p4.inclusion, plain.body)).toBeLessThan(dist(plain.inclusion, plain.body));
  });

  it('lowers the zoning contrast (p6) and draws 2·bands − 1 stripes', () => {
    const contrast = (t: Uint8Array) => 255 - Math.min(...t.filter((_, i) => i % 4 === 0));
    const plain = zoningTexels(5, veilFromTraits([]));
    const veiled = zoningTexels(5, veilFromTraits(['p6_rhythm']));
    expect(plain.length).toBe(9 * 4);
    expect(contrast(veiled)).toBeLessThan(contrast(plain) / 2);
    expect(contrast(veiled)).toBeGreaterThan(0);
  });

  it('ignores order and duplicates', () => {
    const traits: DescriptorKey[] = ['p6_rhythm', 'p1_pitch'];
    expect(veilFromTraits(traits)).toEqual(veilFromTraits(['p1_pitch', 'p6_rhythm', 'p1_pitch']));
  });
});

describe('turntable', () => {
  it('turns once per period, monotone within it', () => {
    expect(turntableAngle(0)).toBe(0);
    expect(turntableAngle(TURNTABLE_PERIOD_MS / 4)).toBeCloseTo(Math.PI / 2, 9);
    expect(turntableAngle(TURNTABLE_PERIOD_MS)).toBe(0);
    expect(turntableAngle(TURNTABLE_PERIOD_MS / 2)).toBeGreaterThan(turntableAngle(TURNTABLE_PERIOD_MS / 3));
  });
});

describe('budget (SPEC §10, untrusted imported geometry)', () => {
  const g = gen([5000, 5000, 9000, 9000, 5000, 5000]);
  const code = (geometry: typeof g) => {
    try {
      checkBudget(geometry);
    } catch (e) {
      return e instanceof RenderInputError ? e.code : 'untyped';
    }
    return 'ok';
  };

  it('accepts every generated geometry (300 random seeds)', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        expect(code(gen(seed))).toBe('ok');
      }),
      { numRuns: 300, seed: 0x11e6 },
    );
  }, 60_000);

  it('rejects too many triangles, bodies or inclusions', () => {
    const primary = at(g.bodies, 0);
    const big = { ...primary, faceOfTriangle: new Uint16Array(MAX_TRIANGLES + 1), indices: new Uint32Array(3 * (MAX_TRIANGLES + 1)) };
    expect(code({ ...g, bodies: [big] })).toBe('BUDGET_EXCEEDED');
    expect(code({ ...g, bodies: [] })).toBe('BUDGET_EXCEEDED');
    expect(code({ ...g, bodies: [{ ...primary, kind: 'secondary' }] })).toBe('BUDGET_EXCEEDED');
    expect(code({ ...g, bodies: [primary, primary] })).toBe('BUDGET_EXCEEDED');
    const secondary = { ...primary, kind: 'secondary' as const };
    expect(code({ ...g, bodies: [primary, secondary, secondary, secondary, secondary] })).toBe('BUDGET_EXCEEDED');
    const needle = { kind: 'needle' as const, transform: Array.from({ length: 16 }, () => 0) };
    expect(code({ ...g, inclusions: Array.from({ length: 11 }, () => needle) })).toBe('BUDGET_EXCEEDED');
    const phantom = { kind: 'phantom' as const, transform: Array.from({ length: 16 }, () => 0) };
    expect(code({ ...g, inclusions: [phantom, phantom] })).toBe('BUDGET_EXCEEDED');
  });
});
