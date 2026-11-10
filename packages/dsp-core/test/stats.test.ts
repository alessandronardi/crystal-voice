import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DspInputError, iqr, median, quantile, quantiles } from '../src/index.ts';

describe('type-7 quantiles', () => {
  it('matches the R/NumPy default on known values', () => {
    // R: quantile(1:10, c(.1, .25, .5, .9)) → 1.9 3.25 5.5 9.1
    const x = [10, 1, 9, 2, 8, 3, 7, 4, 6, 5];
    const [q10, q25, q50, q90] = quantiles(x, [0.1, 0.25, 0.5, 0.9]);
    expect(q10).toBeCloseTo(1.9, 12);
    expect(q25).toBeCloseTo(3.25, 12);
    expect(q50).toBeCloseTo(5.5, 12);
    expect(q90).toBeCloseTo(9.1, 12);
    expect(median([3, 1, 2])).toBe(2);
    expect(iqr([1, 2, 3, 4])).toBeCloseTo(1.5, 12);
  });

  it('returns null on empty input, never 0', () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(median([])).toBeNull();
    expect(iqr([])).toBeNull();
  });

  it('throws typed errors on non-finite values and bad p', () => {
    expect(() => median([1, Number.NaN])).toThrow(DspInputError);
    expect(() => median([Infinity])).toThrow(DspInputError);
    expect(() => quantile([1], 1.5)).toThrow(DspInputError);
    expect(() => quantile([1], Number.NaN)).toThrow(DspInputError);
  });

  it('is monotone in p, bounded by min/max, and order-independent', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e6, max: 1e6 }), { minLength: 1 }), (xs) => {
        const qs = quantiles(xs, [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]).map((q) => q ?? Number.NaN);
        for (let i = 1; i < qs.length; i++) expect(qs[i]).toBeGreaterThanOrEqual(qs[i - 1] ?? Number.NaN);
        expect(qs[0]).toBe(Math.min(...xs));
        expect(qs[qs.length - 1]).toBe(Math.max(...xs));
        expect(median([...xs].reverse())).toBe(median(xs));
      }),
    );
  });

  it('does not mutate its input', () => {
    const x = [3, 1, 2];
    median(x);
    expect(x).toEqual([3, 1, 2]);
  });
});
