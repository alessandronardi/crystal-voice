// Measures the fixed plate scale (I-12): the largest projected half-extent of
// the habit-1 primary over many seeds and the three presets. The scale
// PLATE_SCALE_512 must keep it inside a 512 px plate with a 5% margin.
//   node scripts/golden/plate-scale.ts [--seeds N] [--seed S]

import { resolve } from 'node:path';
import { PLATE_PRESETS, type CrystalSeed } from '@voicecrystal/contracts';
import { generateCrystalGeometry } from '@voicecrystal/crystal-core';
import { PLATE_SCALE_512, PROJECTIONS } from '@voicecrystal/renderer-svg';
import { createPrng } from '../fixtures/prng.ts';

const EDGES = [0, 1, 2500, 3000, 3001, 3500, 4000, 4999, 5000, 5001, 5100, 5333, 5334, 9000, 9999, 10000];
const MARGIN = 0.95;

export interface ScaleReport {
  seeds: number;
  maxHalfExtent: number;
  worst: { seed: number[]; preset: string } | null;
  /** Largest integer scale that keeps the worst case within the margin. */
  maxScale: number;
}

export function measurePlateScale(count: number, prngSeed: number): ScaleReport {
  const prng = createPrng(prngSeed);
  let maxHalfExtent = 0;
  let worst: ScaleReport['worst'] = null;
  const visit = (seed: number[]): void => {
    const b = generateCrystalGeometry(seed as unknown as CrystalSeed, [1, 1, 1, 1, 1, 1], 'habit-1').bodies[0];
    if (b === undefined) return;
    for (const preset of PLATE_PRESETS) {
      const { right, up } = PROJECTIONS[preset];
      for (let i = 0; i < b.positions.length; i += 3) {
        const x = (b.positions[i] ?? 0) / 65536;
        const y = (b.positions[i + 1] ?? 0) / 65536;
        const z = (b.positions[i + 2] ?? 0) / 65536;
        const e = Math.max(Math.abs(right[0] * x + right[1] * y + right[2] * z), Math.abs(up[0] * x + up[1] * y + up[2] * z));
        if (e > maxHalfExtent) {
          maxHalfExtent = e;
          worst = { seed: [...seed], preset };
        }
      }
    }
  };
  // Corners of the mapping: every combination of segment edges on p1, p2, p4 at the longest p3.
  for (const p1 of EDGES) for (const p2 of EDGES) for (const p4 of [0, 10000]) visit([p1, p2, 10000, p4, 0, 0]);
  for (let i = 0; i < count; i++) {
    const pick = (): number => (i % 2 === 0 ? (EDGES[Math.floor(prng.next() * EDGES.length)] ?? 0) : Math.floor(prng.next() * 10001));
    visit([pick(), pick(), pick(), pick(), 0, 0]);
  }
  return { seeds: count + EDGES.length * EDGES.length * 2, maxHalfExtent, worst, maxScale: Math.floor((MARGIN * 256) / maxHalfExtent) };
}

function main(argv: readonly string[]): number {
  const arg = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const r = measurePlateScale(Number(arg('--seeds') ?? 40000), Number(arg('--seed') ?? 4242));
  console.log(
    `scala della tavola: ${r.seeds} seed, semi-ingombro massimo ${r.maxHalfExtent.toFixed(4)} unità (${JSON.stringify(r.worst)}); ` +
      `scala massima con margine 5%: ${r.maxScale} px/unità a 512 px; in uso: ${PLATE_SCALE_512}`,
  );
  return PLATE_SCALE_512 <= r.maxScale ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.exitCode = main(process.argv.slice(2));
}
