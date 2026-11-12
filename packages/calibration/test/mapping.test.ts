import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DESCRIPTOR_KEYS, isCrystalSeed } from '@voicecrystal/contracts';
import mapping0Json from '../mapping-0-experimental.json' with { type: 'json' };
import {
  CalibrationError,
  MAPPING_0,
  MAPPING_0_VERSION,
  mapToPoint,
  parseMappingTable,
  roundHalfEven,
  seedFromRaw,
  toSeedUnits,
} from '../src/index.ts';

describe('roundHalfEven / toSeedUnits (SPEC §7.5, R12)', () => {
  it('sends ties to the even neighbour', () => {
    expect([0.5, 1.5, 2.5, 3.5, -0.5, 4999.5, 5000.5].map(roundHalfEven)).toEqual([0, 2, 2, 4, 0, 5000, 5000]);
    expect([0.49999999999999994, 0.5000000000000001, 1.4999999999999998].map(roundHalfEven)).toEqual([0, 1, 1]);
  });

  it('gives integers in [0, 10000] for every point in [0, 100]', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 100, noNaN: true }), (p) => {
        const u = toSeedUnits(p);
        return Number.isInteger(u) && u >= 0 && u <= 10000 && !Object.is(u, -0) && Math.abs(u - p * 100) <= 0.5;
      }),
    );
    expect(toSeedUnits(0)).toBe(0);
    expect(toSeedUnits(100)).toBe(10000);
    expect(toSeedUnits(0.005)).toBe(0); // 0.5 units → even neighbour 0
    expect(toSeedUnits(0.015)).toBe(2); // 1.5 units → 2
  });

  it('refuses non-finite and out-of-range points', () => {
    for (const bad of [Number.NaN, Infinity, -0.001, 100.001]) expect(() => toSeedUnits(bad)).toThrow(CalibrationError);
  });
});

describe('mapping-0-experimental (SPEC §7.5)', () => {
  it('is experimental, versioned and uses the provisional anchors', () => {
    expect(MAPPING_0.mappingVersion).toBe(MAPPING_0_VERSION);
    expect(MAPPING_0.experimental).toBe(true);
    const ends = DESCRIPTOR_KEYS.map((k) => [MAPPING_0.parameters[k].percentiles[0], MAPPING_0.parameters[k].percentiles[100]]);
    expect(ends).toEqual([
      [Math.log2(70), Math.log2(320)],
      [0, 8],
      [6, 30],
      [0.05, 0.45],
      [Math.log2(600), Math.log2(2400)],
      [2, 7],
    ]);
  });

  it('maps the anchors to 0 and 100, the midpoint to 50, and saturates outside', () => {
    const p3 = MAPPING_0.parameters.p3_dynamics;
    expect(mapToPoint(p3, 6)).toBe(0);
    expect(mapToPoint(p3, 30)).toBe(100);
    expect(mapToPoint(p3, 18)).toBeCloseTo(50, 12);
    expect(mapToPoint(p3, -1e9)).toBe(0);
    expect(mapToPoint(p3, 1e9)).toBe(100);
    const p1 = MAPPING_0.parameters.p1_pitch;
    // 70·√(320/70) Hz is the geometric midpoint: 50 points in log2.
    expect(mapToPoint(p1, (Math.log2(70) + Math.log2(320)) / 2)).toBeCloseTo(50, 9);
  });

  it('is monotone non-decreasing and bounded (property)', () => {
    for (const key of DESCRIPTOR_KEYS) {
      const t = MAPPING_0.parameters[key];
      const lo = (t.percentiles[0] ?? 0) - 1;
      const hi = (t.percentiles[100] ?? 0) + 1;
      fc.assert(
        fc.property(fc.double({ min: lo, max: hi, noNaN: true }), fc.double({ min: lo, max: hi, noNaN: true }), (a, b) => {
          const [x, y] = a <= b ? [a, b] : [b, a];
          const px = mapToPoint(t, x);
          const py = mapToPoint(t, y);
          return px <= py && px >= 0 && py <= 100;
        }),
      );
    }
  });

  it('refuses malformed tables (fail closed)', () => {
    type Table = { experimental: unknown; parameters: Record<string, { percentiles: number[] }> };
    const clone = (): Table => JSON.parse(JSON.stringify(mapping0Json)) as Table;
    const good = clone();
    const decreasing = clone();
    const p = decreasing.parameters['p2_intonation']?.percentiles;
    if (p) p[50] = -1;
    const short = clone();
    short.parameters['p6_rhythm']?.percentiles.pop();
    for (const bad of [null, [], {}, decreasing, short, { ...good, experimental: 'yes' }]) {
      expect(() => parseMappingTable(bad)).toThrow(CalibrationError);
    }
  });
});

describe('seedFromRaw', () => {
  it('turns six measures into a canonical seed and flags the experimental mapping', () => {
    const r = seedFromRaw([Math.log2(120), 3, 18, 0.25, Math.log2(1200), 4.5]);
    expect(isCrystalSeed(r.seed)).toBe(true);
    expect(r.seed[1]).toBe(3750);
    expect(r.seed[2]).toBe(5000);
    expect(r.seed[3]).toBe(5000);
    expect(r.seed[4]).toBe(5000);
    expect(r.seed[5]).toBe(5000);
    expect(r.mappingVersion).toBe('mapping-0-experimental');
    expect(r.warnings).toEqual(['EXPERIMENTAL_MAPPING']);
  });

  it('never maps a null (R13)', () => {
    expect(() => seedFromRaw([1, 2, 3, null, 5, 6])).toThrow(CalibrationError);
    expect(() => seedFromRaw([1, 2, 3])).toThrow(CalibrationError);
  });

  it('gives a valid seed for any finite measures (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -1e6, max: 1e6, noNaN: true }), { minLength: 6, maxLength: 6 }), (raw) => {
        const r = seedFromRaw(raw);
        return isCrystalSeed(r.seed) && r.points.every((p) => p >= 0 && p <= 100);
      }),
    );
  });

  it('is deterministic bit for bit', () => {
    const raw = [6.9, 2.1, 14.2, 0.31, 10.4, 3.3];
    expect(seedFromRaw(raw)).toEqual(seedFromRaw(raw));
  });
});
