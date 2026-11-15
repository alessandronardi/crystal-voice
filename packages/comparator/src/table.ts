// Reference distribution table G(D) (SPEC §11, ADR-0007, ADR-0030).
// Tabulated as 101 quantiles q_0 ... q_100 of weighted Euclidean distance D
// over reference pairs (synthetic uniform seed pairs). Pure module.

import comparator0Json from '../comparator-0.json' with { type: 'json' };
import { ComparatorError } from './errors.ts';

export const COMPARATOR_0_VERSION = 'comparator-0' as const;

export type ComparatorWeights = readonly [number, number, number, number, number, number];

export const EQUAL_WEIGHTS: ComparatorWeights = Object.freeze<ComparatorWeights>([
  1 / 6,
  1 / 6,
  1 / 6,
  1 / 6,
  1 / 6,
  1 / 6,
]);

export interface ComparatorTable {
  readonly comparatorVersion: string;
  readonly experimental: boolean;
  readonly createdAt: string;
  readonly sourceSummary: string;
  readonly weights: ComparatorWeights;
  /** 101 strictly increasing quantiles q_0 .. q_100 of D in [0, 1], with q_0 = 0 and q_100 = 1. */
  readonly distanceQuantiles: readonly number[];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates an untrusted comparator table; fails closed on any invariant violation. */
export function parseComparatorTable(raw: unknown): ComparatorTable {
  if (!isPlainRecord(raw)) {
    throw new ComparatorError('BAD_TABLE', 'comparator table must be an object');
  }
  const comparatorVersion = raw['comparatorVersion'];
  const experimental = raw['experimental'];
  const createdAt = raw['createdAt'];
  const sourceSummary = raw['sourceSummary'];
  const weightsRaw = raw['weights'];
  const quantilesRaw = raw['distanceQuantiles'];

  if (typeof comparatorVersion !== 'string' || comparatorVersion.length === 0) {
    throw new ComparatorError('BAD_TABLE', 'missing comparatorVersion');
  }
  if (typeof experimental !== 'boolean') {
    throw new ComparatorError('BAD_TABLE', 'missing experimental flag');
  }
  if (typeof createdAt !== 'string' || createdAt.length === 0) {
    throw new ComparatorError('BAD_TABLE', 'missing createdAt');
  }
  if (typeof sourceSummary !== 'string' || sourceSummary.length === 0) {
    throw new ComparatorError('BAD_TABLE', 'missing sourceSummary');
  }
  if (!Array.isArray(weightsRaw) || weightsRaw.length !== 6) {
    throw new ComparatorError('BAD_TABLE', 'weights must be a 6-element array');
  }

  const weightsList: number[] = [];
  let weightSum = 0;
  for (let i = 0; i < 6; i++) {
    const w: unknown = weightsRaw[i];
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) {
      throw new ComparatorError('BAD_TABLE', `weight[${i}] must be a non-negative finite number`);
    }
    weightsList.push(w);
    weightSum += w;
  }
  if (Math.abs(weightSum - 1) > 1e-6) {
    throw new ComparatorError('BAD_TABLE', `weights must sum to 1, got ${String(weightSum)}`);
  }

  if (!Array.isArray(quantilesRaw) || quantilesRaw.length !== 101) {
    throw new ComparatorError('BAD_TABLE', 'distanceQuantiles must have length 101');
  }
  const quantiles: number[] = [];
  for (let k = 0; k < 101; k++) {
    const q: unknown = quantilesRaw[k];
    if (typeof q !== 'number' || !Number.isFinite(q) || q < 0 || q > 1) {
      throw new ComparatorError('BAD_TABLE', `q[${k}] must be a finite number in [0, 1]`);
    }
    const prev = quantiles[k - 1];
    if (prev !== undefined && !(q > prev)) {
      throw new ComparatorError('BAD_TABLE', `q[${k}] must be strictly greater than q[${k - 1}]`);
    }
    quantiles.push(q);
  }
  if (quantiles[0] !== 0 || quantiles[100] !== 1) {
    throw new ComparatorError('BAD_TABLE', 'distanceQuantiles must start at 0 and end at 1');
  }

  return Object.freeze({
    comparatorVersion,
    experimental,
    createdAt,
    sourceSummary,
    weights: Object.freeze(weightsList) as unknown as ComparatorWeights,
    distanceQuantiles: Object.freeze(quantiles),
  });
}

/** Canonical comparator-0 table (SPEC §11, ADR-0030). Validated on load. */
export const COMPARATOR_0: ComparatorTable = parseComparatorTable(comparator0Json);
if (COMPARATOR_0.comparatorVersion !== COMPARATOR_0_VERSION || COMPARATOR_0.experimental) {
  throw new ComparatorError('BAD_TABLE', 'comparator-0.json has unexpected version or experimental flag');
}

/**
 * Evaluates G(D) in [0, 1] via piecewise linear interpolation across the 101
 * tabulated quantiles q_0 .. q_100 of the reference distance distribution.
 */
export function evaluateDistanceCdf(distance: number, table: ComparatorTable = COMPARATOR_0): number {
  if (!Number.isFinite(distance)) {
    throw new ComparatorError('BAD_TABLE', `distance must be finite, got ${String(distance)}`);
  }
  if (distance <= 0) return 0;
  if (distance >= 1) return 1;

  const q = table.distanceQuantiles;
  let lo = 0;
  let hi = 100;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((q[mid] ?? 0) <= distance) lo = mid;
    else hi = mid;
  }
  const qLo = q[lo] ?? 0;
  const qHi = q[lo + 1] ?? 1;
  const span = qHi - qLo;
  const frac = span > 0 ? (distance - qLo) / span : 0;
  const cdf = (lo + frac) / 100;
  return cdf < 0 ? 0 : cdf > 1 ? 1 : cdf;
}
