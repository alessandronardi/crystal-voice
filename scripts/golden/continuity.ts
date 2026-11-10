// `pnpm bench:continuity` (I-10, SPEC §10): random seed pairs that differ by
// 100 units in ONE geometric parameter (p1..p4); reports 1 − IoU of the
// front and top silhouettes per parameter. p5 and p6 are appearance only and
// are checked separately to move the geometry by exactly 0.
//
// Limits (review I-10, M2): the silhouette does not see inclusions or bodies
// entirely inside the primary; their growth is covered by the birth-size test
// in packages/crystal-core/test/generate.test.ts.
//
// The reported sample uses REPORT_SEED, distinct from TUNING_SEED, the sample
// the habit-1 constants were tuned on.
//   node scripts/golden/continuity.ts [--pairs N] [--seed S] [--out FILE]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { CrystalSeed } from '@voicecrystal/contracts';
import { generateCrystalGeometry } from '@voicecrystal/crystal-core';
import { geometryDistance } from '../../packages/crystal-core/test/silhouette.ts';
import { createPrng } from '../fixtures/prng.ts';

export const CONTINUITY_THRESHOLD = 0.03;
export const TUNING_SEED = 20261110;
export const REPORT_SEED = 777001;
const FULL = [1, 1, 1, 1, 1, 1] as const;

export interface ContinuityStats {
  parameter: string;
  pairs: number;
  max: number;
  p99: number;
  median: number;
  over: number;
  worst: { seed: number[]; distance: number } | null;
}

function pairDistance(seed: number[], param: number): number {
  const other = [...seed];
  const value = seed[param] ?? 0;
  other[param] = value + 100 <= 10000 ? value + 100 : value - 100;
  return geometryDistance(
    generateCrystalGeometry(seed as unknown as CrystalSeed, FULL, 'habit-1'),
    generateCrystalGeometry(other as unknown as CrystalSeed, FULL, 'habit-1'),
  );
}

/** `pairs` pairs spread evenly over `params` (default p1..p4). */
export function measureContinuity(pairs: number, prngSeed: number, params: readonly number[] = [0, 1, 2, 3]): ContinuityStats[] {
  const prng = createPrng(prngSeed);
  const buckets = params.map(() => ({ d: [] as number[], worst: null as ContinuityStats['worst'] }));
  for (let n = 0; n < pairs; n++) {
    const seed: number[] = Array.from({ length: 6 }, () => Math.floor(prng.next() * 10001));
    const k = n % params.length;
    const d = pairDistance(seed, params[k] ?? 0);
    const bucket = buckets[k];
    if (bucket === undefined) continue;
    bucket.d.push(d);
    if (bucket.worst === null || d > bucket.worst.distance) bucket.worst = { seed: [...seed], distance: d };
  }
  return buckets.map(({ d, worst }, k) => {
    const s = [...d].sort((a, b) => a - b);
    const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] ?? 0;
    return {
      parameter: `p${(params[k] ?? 0) + 1}`,
      pairs: s.length,
      max: s[s.length - 1] ?? 0,
      p99: q(0.99),
      median: q(0.5),
      over: s.filter((v) => v > CONTINUITY_THRESHOLD).length,
      worst,
    };
  });
}

function main(argv: readonly string[]): number {
  const arg = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const pairs = Number(arg('--pairs') ?? 10000);
  const seed = Number(arg('--seed') ?? REPORT_SEED);
  const out = resolve(arg('--out') ?? resolve(import.meta.dirname, '../../tests/benchmarks/out/continuity.json'));
  const started = performance.now();
  const stats = measureContinuity(pairs, seed);
  const appearance = measureContinuity(200, seed + 1, [4, 5]);
  const seconds = (performance.now() - started) / 1000;
  for (const s of [...stats, ...appearance]) {
    console.log(`${s.parameter}: ${s.pairs} coppie · max ${s.max.toFixed(4)} · p99 ${s.p99.toFixed(4)} · mediana ${s.median.toFixed(4)} · sopra ${CONTINUITY_THRESHOLD}: ${s.over}`);
  }
  const worst = Math.max(...stats.map((s) => s.max));
  const appearanceMoves = appearance.some((s) => s.max !== 0);
  console.log(`continuità (p1–p4, ${pairs} coppie, seed ${seed}): 1 − IoU massimo ${worst.toFixed(4)} (soglia ${CONTINUITY_THRESHOLD} [H]); p5/p6 ${appearanceMoves ? 'MUOVONO la geometria' : 'non muovono la geometria'}; ${seconds.toFixed(1)} s`);
  console.log('nota: la silhouette non vede inclusioni né corpi interni al primario');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ geometryVersion: 'habit-1', pairs, prngSeed: seed, threshold: CONTINUITY_THRESHOLD, seconds, perParameter: stats, appearance }, null, 2)}\n`);
  return worst <= CONTINUITY_THRESHOLD && !appearanceMoves ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.exitCode = main(process.argv.slice(2));
}
