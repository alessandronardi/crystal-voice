// Builds packages/comparator/comparator-0-experimental.json (SPEC §11, ADR-0007):
// before G1 (I-08 human dataset), the inter-speaker distance CDF G(D) is
// tabulated from 200,000 deterministic independent uniform seed pairs in
// [0, 10000]^6 with equal weights w_i = 1/6. Anchored at P0 = 0 and P100 = 1
// so identical seeds map to nearness 100 and maximally opposite seeds map to 0.
//
//   node scripts/calibration/build-comparator-0.ts           write the file
//   node scripts/calibration/build-comparator-0.ts --check   exit 1 if it differs

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const COMPARATOR_0_PATH = resolve(import.meta.dirname, '../../packages/comparator/comparator-0-experimental.json');

const PAIR_COUNT = 200_000;
const SEED_MAX = 10_000;
const INITIAL_PRNG_STATE = 0x56433037; // 'VC07'

function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function buildComparator0(): string {
  const rand = createMulberry32(INITIAL_PRNG_STATE);
  const weight = 1 / 6;
  const distances = new Float64Array(PAIR_COUNT);

  for (let p = 0; p < PAIR_COUNT; p++) {
    let sumSq = 0;
    for (let i = 0; i < 6; i++) {
      const a = Math.floor(rand() * (SEED_MAX + 1));
      const b = Math.floor(rand() * (SEED_MAX + 1));
      const delta = (a - b) / SEED_MAX;
      sumSq += weight * delta * delta;
    }
    distances[p] = Math.sqrt(sumSq);
  }

  distances.sort();

  const quantiles: number[] = [0];
  for (let k = 1; k < 100; k++) {
    const pos = (k / 100) * (PAIR_COUNT - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(PAIR_COUNT - 1, lo + 1);
    const frac = pos - lo;
    const interpolated = (distances[lo] ?? 0) * (1 - frac) + (distances[hi] ?? 0) * frac;
    const prev = quantiles[k - 1] ?? 0;
    // Guarantee strictly increasing quantiles after 6-decimal rounding.
    const candidate = round6(interpolated);
    quantiles.push(candidate > prev ? candidate : round6(prev + 0.000001));
  }
  quantiles.push(1);

  const table = {
    comparatorVersion: 'comparator-0-experimental',
    experimental: true,
    createdAt: '2026-11-15T00:00:00.000Z',
    sourceSummary:
      'Synthetic pre-G1 reference distribution of weighted Euclidean distance D over 200,000 independent uniform seed pairs in [0, 10000]^6 with equal weights w_i = 1/6; replace at G1 via I-08 inter-speaker pairs.',
    weights: [weight, weight, weight, weight, weight, weight],
    distanceQuantiles: quantiles,
  };

  return `${JSON.stringify(table, null, 2)}\n`;
}

if (import.meta.main) {
  const text = buildComparator0();
  if (process.argv.includes('--check')) {
    const current = readFileSync(COMPARATOR_0_PATH, 'utf8').replace(/\r\n/g, '\n');
    if (current !== text) {
      console.error('comparator-0-experimental.json differs from the generator output');
      process.exit(1);
    }
    console.log('comparator-0-experimental.json is up to date');
  } else {
    writeFileSync(COMPARATOR_0_PATH, text);
    console.log(`wrote ${COMPARATOR_0_PATH}`);
  }
}
