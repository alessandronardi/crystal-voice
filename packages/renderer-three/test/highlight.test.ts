// I-13b (ADR-0028): which trait a legend row lights up, and only when it exists.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DESCRIPTOR_KEYS, GEOMETRY_VERSIONS, type CrystalSeed } from '@voicecrystal/contracts';
import { generateCrystalGeometry } from '@voicecrystal/crystal-core';
import { highlightAvailable, highlightTargetOf, veilIsVisible } from '../src/pure/index.ts';

const seedArb = fc.tuple(...DESCRIPTOR_KEYS.map(() => fc.integer({ min: 0, max: 10000 }))) as unknown as fc.Arbitrary<CrystalSeed>;

describe('highlight targets', () => {
  it('maps p1–p4 to an element and leaves colour and zoning to the whole body', () => {
    expect(DESCRIPTOR_KEYS.map(highlightTargetOf)).toEqual(['prism', 'termination', 'secondary', 'inclusions', null, null]);
  });

  it('is available exactly when the element exists, as the veil rule says (property)', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const g = generateCrystalGeometry(seed, [1, 1, 1, 1, 1, 1], GEOMETRY_VERSIONS[0]);
        for (const k of DESCRIPTOR_KEYS) {
          const t = highlightTargetOf(k);
          if (t !== null) expect(highlightAvailable(t, g)).toBe(veilIsVisible(k, g));
        }
      }),
      { numRuns: 200 },
    );
  });
});
