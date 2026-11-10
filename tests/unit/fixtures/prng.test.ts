import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createPrng } from '../../../scripts/fixtures/prng.ts';

describe('fixture PRNG (mulberry32)', () => {
  // Reference values cross-checked with an independent Python implementation (2026-11-10).
  it('reproduces pinned reference sequences', () => {
    const a = createPrng(42);
    expect([1, 2, 3, 4, 5].map(() => a.nextUint32())).toEqual([2581720956, 1925393290, 3661312704, 2876485805, 750819978]);
    const b = createPrng(0);
    expect([1, 2, 3].map(() => b.nextUint32())).toEqual([1144304738, 1416247, 958946056]);
  });

  it('rejects seeds that are not uint32', () => {
    for (const bad of [-1, 1.5, 2 ** 32, Number.NaN]) expect(() => createPrng(bad)).toThrow(RangeError);
  });

  it('next() stays in [0, 1) and range() in [min, max)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), fc.double({ min: -10, max: 10, noNaN: true }), (seed, min) => {
        const p = createPrng(seed);
        for (let i = 0; i < 50; i++) {
          const x = p.next();
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThan(1);
          const y = p.range(min, min + 2);
          expect(y).toBeGreaterThanOrEqual(min);
          expect(y).toBeLessThanOrEqual(min + 2);
        }
      }),
    );
  });

  it('same seed → same sequence; different seeds → different sequences', () => {
    const seq = (s: number): number[] => {
      const p = createPrng(s);
      return Array.from({ length: 8 }, () => p.nextUint32());
    };
    expect(seq(7)).toEqual(seq(7));
    expect(seq(7)).not.toEqual(seq(8));
  });
});
