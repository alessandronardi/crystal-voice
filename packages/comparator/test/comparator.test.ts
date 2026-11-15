import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DESCRIPTOR_KEYS, SEED_UNITS_MAX, type CrystalSeed } from '@voicecrystal/contracts';
import comparator0Json from '../comparator-0.json' with { type: 'json' };
import {
  COMPARATOR_0,
  COMPARATOR_0_VERSION,
  ComparatorError,
  EQUAL_WEIGHTS,
  compareSeeds,
  compareSpecimens,
  computeParameterContributions,
  euclideanAffinity,
  evaluateDistanceCdf,
  parseComparatorTable,
  weightedEuclideanDistance,
  type ComparableSpecimen,
} from '../src/index.ts';

const seedUnitArb = fc.integer({ min: 0, max: SEED_UNITS_MAX });
const crystalSeedArb: fc.Arbitrary<CrystalSeed> = fc.tuple(
  seedUnitArb,
  seedUnitArb,
  seedUnitArb,
  seedUnitArb,
  seedUnitArb,
  seedUnitArb,
);

function makeSpecimen(
  seed: CrystalSeed,
  overrides: Partial<ComparableSpecimen> = {},
): ComparableSpecimen {
  return {
    seed,
    extractorVersion: 'extractor-0',
    mappingVersion: 'mapping-0',
    geometryVersion: 'habit-1',
    source: { kind: 'file' },
    quality: {
      warnings: [],
      confidence: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9],
    },
    ...overrides,
  };
}

describe('COMPARATOR_0 reference table (SPEC §11, ADR-0007, ADR-0030)', () => {
  it('loads comparator-0 with validated monotonic quantiles', () => {
    expect(COMPARATOR_0.comparatorVersion).toBe(COMPARATOR_0_VERSION);
    expect(COMPARATOR_0.experimental).toBe(false);
    expect(COMPARATOR_0.weights).toEqual(EQUAL_WEIGHTS);
    expect(COMPARATOR_0.distanceQuantiles).toHaveLength(101);
    expect(COMPARATOR_0.distanceQuantiles[0]).toBe(0);
    expect(COMPARATOR_0.distanceQuantiles[100]).toBe(1);
    expect(evaluateDistanceCdf(0)).toBe(0);
    expect(evaluateDistanceCdf(1)).toBe(1);
  });

  it('rejects malformed comparator tables cleanly', () => {
    expect(() => parseComparatorTable(null)).toThrow(ComparatorError);
    expect(() =>
      parseComparatorTable({ ...comparator0Json, weights: [0.5, 0.5, 0, 0, 0, 0.5] }),
    ).toThrow(ComparatorError);
    const badQuantiles = [...comparator0Json.distanceQuantiles];
    badQuantiles[10] = badQuantiles[9] ?? 0;
    expect(() =>
      parseComparatorTable({ ...comparator0Json, distanceQuantiles: badQuantiles }),
    ).toThrow(ComparatorError);
    expect(() =>
      parseComparatorTable({
        ...comparator0Json,
        distanceQuantiles: [0.01, ...comparator0Json.distanceQuantiles.slice(1)],
      }),
    ).toThrow(ComparatorError);
  });

  it('has median nearness percentile in [45, 55] over independent uniform seed pairs (ADR-0007)', () => {
    let state = 0x12345678;
    const nextInt = (): number => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return Math.floor((state / 4294967296) * (SEED_UNITS_MAX + 1));
    };
    const nextSeed = (): CrystalSeed => [
      nextInt(),
      nextInt(),
      nextInt(),
      nextInt(),
      nextInt(),
      nextInt(),
    ];
    const samples: number[] = [];
    for (let i = 0; i < 2000; i++) {
      samples.push(compareSeeds(nextSeed(), nextSeed()).nearnessPercentile);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)] ?? 0;
    expect(median).toBeGreaterThanOrEqual(45);
    expect(median).toBeLessThanOrEqual(55);
  });
});

describe('Comparator mathematical properties (fast-check, SPEC §11)', () => {
  it('identity: D(A,A) = 0, Affinity(A,A) = 100, nearnessPercentile(A,A) = 100', () => {
    fc.assert(
      fc.property(crystalSeedArb, (a) => {
        const res = compareSeeds(a, a);
        expect(res.distance).toBe(0);
        expect(res.affinity).toBe(100);
        expect(res.nearnessExact).toBe(100);
        expect(res.nearnessPercentile).toBe(100);
        for (const c of res.contributions) {
          expect(c.deltaPoints).toBe(0);
          expect(c.weightedSquaredContribution).toBe(0);
        }
      }),
    );
  });

  it('symmetry: all metrics match between (A, B) and (B, A)', () => {
    fc.assert(
      fc.property(crystalSeedArb, crystalSeedArb, (a, b) => {
        const ab = compareSeeds(a, b);
        const ba = compareSeeds(b, a);
        expect(ab.distance).toBe(ba.distance);
        expect(ab.affinity).toBe(ba.affinity);
        expect(ab.cdfValue).toBe(ba.cdfValue);
        expect(ab.nearnessExact).toBe(ba.nearnessExact);
        expect(ab.nearnessPercentile).toBe(ba.nearnessPercentile);
        for (let i = 0; i < 6; i++) {
          expect(ab.contributions[i]?.deltaPoints).toBe(ba.contributions[i]?.deltaPoints);
          expect(ab.contributions[i]?.weightedSquaredContribution).toBe(
            ba.contributions[i]?.weightedSquaredContribution,
          );
        }
      }),
    );
  });

  it('bounds: D in [0,1], Affinity in [0,100], nearnessPercentile integer in [0,100]', () => {
    fc.assert(
      fc.property(crystalSeedArb, crystalSeedArb, (a, b) => {
        const res = compareSeeds(a, b);
        expect(Number.isFinite(res.distance)).toBe(true);
        expect(res.distance).toBeGreaterThanOrEqual(0);
        expect(res.distance).toBeLessThanOrEqual(1);
        expect(Number.isFinite(res.affinity)).toBe(true);
        expect(res.affinity).toBeGreaterThanOrEqual(0);
        expect(res.affinity).toBeLessThanOrEqual(100);
        expect(Number.isInteger(res.nearnessPercentile)).toBe(true);
        expect(res.nearnessPercentile).toBeGreaterThanOrEqual(0);
        expect(res.nearnessPercentile).toBeLessThanOrEqual(100);
      }),
    );
  });

  it('opposite extremes [0..0] vs [10000..10000] yield D = 1, Affinity = 0, nearness = 0', () => {
    const low: CrystalSeed = [0, 0, 0, 0, 0, 0];
    const high: CrystalSeed = [10000, 10000, 10000, 10000, 10000, 10000];
    const res = compareSeeds(low, high);
    expect(res.distance).toBe(1);
    expect(res.affinity).toBe(0);
    expect(res.nearnessExact).toBe(0);
    expect(res.nearnessPercentile).toBe(0);
    for (const c of res.contributions) {
      expect(c.deltaPoints).toBe(100);
      expect(c.weightedSquaredContribution).toBeCloseTo(1 / 6, 12);
    }
  });

  it('monotonicity: increasing |A_i - B_i| on one axis decreases Affinity and does not increase nearness', () => {
    fc.assert(
      fc.property(
        crystalSeedArb,
        crystalSeedArb,
        fc.integer({ min: 0, max: 5 }),
        seedUnitArb,
        seedUnitArb,
        (a, baseB, idx, v1, v2) => {
          const d1 = Math.abs((a[idx] ?? 0) - v1);
          const d2 = Math.abs((a[idx] ?? 0) - v2);
          fc.pre(d1 !== d2);
          const closerVal = d1 < d2 ? v1 : v2;
          const fartherVal = d1 < d2 ? v2 : v1;
          const closerB = baseB.map((v, i) => (i === idx ? closerVal : v)) as unknown as CrystalSeed;
          const fartherB = baseB.map((v, i) => (i === idx ? fartherVal : v)) as unknown as CrystalSeed;

          const resClose = compareSeeds(a, closerB);
          const resFar = compareSeeds(a, fartherB);

          expect(resClose.contributions[idx]?.weightedSquaredContribution).toBeLessThan(
            resFar.contributions[idx]?.weightedSquaredContribution ?? 0,
          );
          expect(resClose.distance).toBeLessThan(resFar.distance);
          expect(resClose.affinity).toBeGreaterThan(resFar.affinity);
          expect(resClose.nearnessExact).toBeGreaterThanOrEqual(resFar.nearnessExact);
          expect(resClose.nearnessPercentile).toBeGreaterThanOrEqual(resFar.nearnessPercentile);
        },
      ),
    );
  });

  it('rejects invalid seeds and weights cleanly', () => {
    const valid: CrystalSeed = [5000, 5000, 5000, 5000, 5000, 5000];
    expect(() =>
      weightedEuclideanDistance([5000.5, 0, 0, 0, 0, 0] as unknown as CrystalSeed, valid),
    ).toThrow(ComparatorError);
    expect(() =>
      euclideanAffinity(valid, [-1, 0, 0, 0, 0, 0] as unknown as CrystalSeed),
    ).toThrow(ComparatorError);
    expect(() =>
      computeParameterContributions(valid, valid, [1, 1, 1, 1, 1, 1]),
    ).toThrow(ComparatorError);
  });
});

describe('Specimen compatibility checks & context warnings (SPEC §11)', () => {
  it('blocks comparison when mappingVersion differs', () => {
    const a = makeSpecimen([1000, 2000, 3000, 4000, 5000, 6000], {
      mappingVersion: 'mapping-0',
    });
    const b = makeSpecimen([1000, 2000, 3000, 4000, 5000, 6000], {
      mappingVersion: 'mapping-1',
    });
    const outcome = compareSpecimens(a, b);
    expect(outcome).toEqual({
      status: 'blocked',
      reason: 'INCOMPATIBLE_MAPPING_VERSION',
      mappingVersionA: 'mapping-0',
      mappingVersionB: 'mapping-1',
      extractorVersionA: 'extractor-0',
      extractorVersionB: 'extractor-0',
    });
  });

  it('blocks comparison when extractorVersion differs', () => {
    const a = makeSpecimen([1000, 2000, 3000, 4000, 5000, 6000], {
      extractorVersion: 'extractor-0',
    });
    const b = makeSpecimen([1000, 2000, 3000, 4000, 5000, 6000], {
      extractorVersion: 'extractor-2',
    });
    const outcome = compareSpecimens(a, b);
    expect(outcome).toEqual({
      status: 'blocked',
      reason: 'INCOMPATIBLE_EXTRACTOR_VERSION',
      mappingVersionA: 'mapping-0',
      mappingVersionB: 'mapping-0',
      extractorVersionA: 'extractor-0',
      extractorVersionB: 'extractor-2',
    });
  });

  it('allows comparison when geometryVersion differs and reports context warnings without experimental flag', () => {
    const a = makeSpecimen([3000, 4000, 5000, 6000, 7000, 8000], {
      geometryVersion: 'habit-1',
      source: { kind: 'tab' },
      quality: {
        warnings: ['MIXED_AUDIO_UNCERTAIN', 'LOW_CONFIDENCE_PARAMETER'],
        confidence: [0.9, 0.4, 0.9, 0.9, 0.9, 0.9],
      },
    });
    const b = makeSpecimen([3500, 4200, 4800, 6100, 7200, 7900], {
      geometryVersion: 'habit-2',
      source: { kind: 'mic' },
    });
    const outcome = compareSpecimens(a, b);
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.experimental).toBe(false);
      expect(outcome.geometryVersionDiffers).toBe(true);
      expect(outcome.contributions).toHaveLength(6);
      expect(outcome.contributions.map((c) => c.parameter)).toEqual([...DESCRIPTOR_KEYS]);
      expect(outcome.contextWarnings).not.toContain('EXPERIMENTAL_COMPARATOR');
      expect(outcome.contextWarnings).toContain('DIFFERENT_SOURCE_KIND');
      expect(outcome.contextWarnings).toContain('LOW_CONFIDENCE_TRAITS');
      expect(outcome.contextWarnings).toContain('QUALITY_WARNINGS_PRESENT');
      expect(outcome.contextWarnings).toContain('DIFFERENT_GEOMETRY_VERSION');
    }
  });
});
