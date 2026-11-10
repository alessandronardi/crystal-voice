// `pnpm bench:robustness` (I-10): mesh invariants on many seeds, half of them
// built from the edges of the habit-1 mapping segments (where faces and
// bodies are born). Exit 1 on any failure or exception.
//   node scripts/golden/robustness.ts [--seeds N] [--seed S]

import { resolve } from 'node:path';
import type { CrystalSeed } from '@voicecrystal/contracts';
import { generateCrystalGeometry } from '@voicecrystal/crystal-core';
import {
  checkCanonicalOrder,
  checkClosedAndOriented,
  checkConvex,
  checkOnFacePlane,
  checkOutwardWinding,
  euler,
} from '../../packages/crystal-core/test/mesh-checks.ts';
import { createPrng } from '../fixtures/prng.ts';

const EDGES = [0, 1, 2500, 3000, 3001, 3500, 4000, 4999, 5000, 5001, 5100, 5333, 5334, 9000, 9999, 10000];

export interface RobustnessReport {
  seeds: number;
  failures: { seed: number[]; reason: string }[];
  maxTriangles: number;
  msPerGeometry: number;
}

export function checkRobustness(count: number, prngSeed: number): RobustnessReport {
  const prng = createPrng(prngSeed);
  const failures: RobustnessReport['failures'] = [];
  let maxTriangles = 0;
  const started = performance.now();
  for (let i = 0; i < count; i++) {
    const pick = (): number => (i % 2 === 0 ? (EDGES[Math.floor(prng.next() * EDGES.length)] ?? 0) : Math.floor(prng.next() * 10001));
    const seed = [pick(), pick(), pick(), pick(), 0, 0];
    try {
      const g = generateCrystalGeometry(seed as unknown as CrystalSeed, [1, 1, 1, 1, 1, 1], 'habit-1');
      maxTriangles = Math.max(maxTriangles, g.bodies.reduce((n, b) => n + b.faceOfTriangle.length, 0));
      for (const b of g.bodies) {
        const e = euler(b);
        const reason =
          checkClosedAndOriented(b) ??
          checkOutwardWinding(b, b.planes) ??
          checkConvex(b, b.planes) ??
          checkOnFacePlane(b, b.planes) ??
          checkCanonicalOrder(b) ??
          (e.triangles === 2 && e.faces === 2 ? null : `Euler ${JSON.stringify(e)}`);
        if (reason !== null) {
          failures.push({ seed, reason: `${b.kind}: ${reason}` });
          break;
        }
      }
    } catch (error) {
      failures.push({ seed, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { seeds: count, failures, maxTriangles, msPerGeometry: (performance.now() - started) / count };
}

function main(argv: readonly string[]): number {
  const arg = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const r = checkRobustness(Number(arg('--seeds') ?? 40000), Number(arg('--seed') ?? 4242));
  console.log(`robustezza habit-1: ${r.seeds} seed (metà sui bordi), ${r.failures.length} difetti, max ${r.maxTriangles} triangoli, ${r.msPerGeometry.toFixed(2)} ms/geometria`);
  for (const f of r.failures.slice(0, 10)) console.log(`  ${JSON.stringify(f.seed)}: ${f.reason}`);
  return r.failures.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.exitCode = main(process.argv.slice(2));
}
