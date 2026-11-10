// Golden seeds (I-10, ADR-0010): 1,000 fixed seeds and their geometryHash for
// each geometryVersion, in tests/fixtures/seeds/golden-<version>.json.
//
//   pnpm test:golden            regenerate in Node and compare (exit 1 on any difference)
//   node scripts/golden/seeds.ts --write   (re)write the file — only for a NEW
//                               geometryVersion: changing hashes of an existing
//                               version breaks saved records
//
// The seed list itself is deterministic: extremes, the edges of the habit-1
// mapping segments, then pseudo-random seeds from a fixed mulberry32 stream.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { CrystalSeed } from '@voicecrystal/contracts';
import { generateCrystalGeometry, HABIT_1 } from '@voicecrystal/crystal-core';
import { createPrng } from '../fixtures/prng.ts';

export const GOLDEN_COUNT = 1000;
const FULL = [1, 1, 1, 1, 1, 1] as const;
const EDGES = [0, 1, 2500, 3000, 3001, 3500, 4000, 4999, 5000, 5001, 5100, 9000, 9999, 10000];

export interface GoldenFile {
  geometryVersion: string;
  count: number;
  entries: { seed: number[]; hash: string }[];
}

export const goldenPath = (version: string): string =>
  resolve(import.meta.dirname, `../../tests/fixtures/seeds/golden-${version}.json`);

export function goldenSeeds(): number[][] {
  const seeds: number[][] = [
    [0, 0, 0, 0, 0, 0],
    [10000, 10000, 10000, 10000, 10000, 10000],
    [5000, 5000, 5000, 5000, 5000, 5000],
  ];
  for (let k = 0; k < 4; k++) {
    for (const e of EDGES) {
      const s = [5000, 5000, 5000, 5000, 5000, 5000];
      s[k] = e;
      seeds.push(s);
    }
  }
  const prng = createPrng(20261110);
  while (seeds.length < GOLDEN_COUNT) {
    const pick = (): number => (prng.next() < 0.15 ? (EDGES[Math.floor(prng.next() * EDGES.length)] ?? 0) : Math.floor(prng.next() * 10001));
    seeds.push([pick(), pick(), pick(), pick(), pick(), pick()]);
  }
  return seeds;
}

/** One entry per line: readable diffs, stable bytes. */
export function serializeGolden(g: GoldenFile): string {
  const lines = g.entries.map((e) => `  {"seed":[${e.seed.join(',')}],"hash":"${e.hash}"}`);
  return `{\n "geometryVersion": "${g.geometryVersion}",\n "count": ${g.count},\n "entries": [\n${lines.join(',\n')}\n ]\n}\n`;
}

export function computeGolden(version: string): GoldenFile {
  const entries = goldenSeeds().map((seed) => ({
    seed,
    hash: generateCrystalGeometry(seed as unknown as CrystalSeed, FULL, version).geometryHash,
  }));
  return { geometryVersion: version, count: entries.length, entries };
}

function main(argv: readonly string[]): number {
  const version = HABIT_1;
  const started = performance.now();
  const fresh = computeGolden(version);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const path = goldenPath(version);
  if (argv.includes('--write')) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, serializeGolden(fresh));
    console.log(`golden: ${fresh.count} seed scritti in ${path} (${seconds} s)`);
    return 0;
  }
  let stored: GoldenFile;
  try {
    stored = JSON.parse(readFileSync(path, 'utf8')) as GoldenFile;
  } catch {
    console.error(`golden: ${path} non leggibile`);
    return 1;
  }
  const storedEntries: readonly (GoldenFile['entries'][number] | undefined)[] = stored.entries;
  const diffs = fresh.entries.filter((e, i) => {
    const s = storedEntries[i];
    return s === undefined || s.hash !== e.hash || s.seed.join(',') !== e.seed.join(',');
  });
  if (diffs.length > 0 || stored.count !== fresh.count) {
    console.error(`golden: ${diffs.length} hash diversi su ${fresh.count} (${version}); primo: ${JSON.stringify(diffs[0])}`);
    return 1;
  }
  console.log(`golden: ${fresh.count} hash identici in Node ${process.version} (${version}, ${seconds} s)`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.exitCode = main(process.argv.slice(2));
}
