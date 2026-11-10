// Robust statistics shared by every descriptor (packages/dsp-core/CLAUDE.md):
// percentiles use linear interpolation between order statistics, Hyndman &
// Fan type 7 (the default of R and NumPy). Empty input → null ("not
// measurable", never 0). Non-finite input is a caller bug and throws.

import { DspInputError } from './errors.ts';

function sortedFinite(values: ArrayLike<number>): Float64Array {
  const out = Float64Array.from(values);
  for (const v of out) {
    if (!Number.isFinite(v)) throw new DspInputError('NON_FINITE_INPUT', 'statistics on a non-finite value');
  }
  return out.sort();
}

function quantileOfSorted(sorted: Float64Array, p: number): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const a = sorted[lo] ?? 0;
  const b = sorted[Math.min(lo + 1, n - 1)] ?? a;
  return a + (h - lo) * (b - a);
}

/** Type-7 quantile, `p` in [0, 1]. */
export function quantile(values: ArrayLike<number>, p: number): number | null {
  if (!(p >= 0 && p <= 1)) throw new DspInputError('BAD_PROBABILITY', `quantile p=${String(p)} outside [0, 1]`);
  return quantileOfSorted(sortedFinite(values), p);
}

/** Several type-7 quantiles with a single sort. */
export function quantiles(values: ArrayLike<number>, ps: readonly number[]): (number | null)[] {
  for (const p of ps) {
    if (!(p >= 0 && p <= 1)) throw new DspInputError('BAD_PROBABILITY', `quantile p=${String(p)} outside [0, 1]`);
  }
  const sorted = sortedFinite(values);
  return ps.map((p) => quantileOfSorted(sorted, p));
}

export const median = (values: ArrayLike<number>): number | null => quantile(values, 0.5);

/** Interquartile range Q3 − Q1 (type 7). */
export function iqr(values: ArrayLike<number>): number | null {
  const [q1, q3] = quantiles(values, [0.25, 0.75]);
  return q1 === null || q1 === undefined || q3 === null || q3 === undefined ? null : q3 - q1;
}
