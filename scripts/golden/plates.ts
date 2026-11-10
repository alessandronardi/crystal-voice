// Golden plates (I-12, ADR-0013): SHA-256 of the SVG plate of each golden seed
// (scripts/golden/seeds.ts) in the three presets at 512 px, in
// tests/fixtures/plates/golden-plates-<geometryVersion>.json.
//
//   node scripts/golden/plates.ts           regenerate in Node and compare (exit 1 on any difference)
//   node scripts/golden/plates.ts --write   (re)write the file — only with a NEW
//                                           PLATE_RENDERER_VERSION or geometryVersion
//
// Browsers: tests/golden-browsers/plates.spec.ts.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PLATE_PRESETS, PLATE_RENDERER_VERSION, type CrystalSeed, type PlatePreset } from '@voicecrystal/contracts';
import { generateCrystalGeometry, HABIT_1 } from '@voicecrystal/crystal-core';
import { renderPlateSvg } from '@voicecrystal/renderer-svg';
import { goldenSeeds } from './seeds.ts';

export const PLATE_SIZE = 512;

export interface GoldenPlatesFile {
  renderer: string;
  geometryVersion: string;
  sizePx: number;
  count: number;
  entries: ({ seed: number[] } & Record<PlatePreset, string>)[];
}

export const goldenPlatesPath = (version: string): string =>
  resolve(import.meta.dirname, `../../tests/fixtures/plates/golden-plates-${version}.json`);

export function plateSvg(seed: readonly number[], preset: PlatePreset, version: string = HABIT_1): string {
  const g = generateCrystalGeometry(seed as unknown as CrystalSeed, [1, 1, 1, 1, 1, 1], version);
  return renderPlateSvg(g, { preset, sizePx: PLATE_SIZE });
}

const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

export function computeGoldenPlates(version: string): GoldenPlatesFile {
  const entries = goldenSeeds().map((seed) => {
    const g = generateCrystalGeometry(seed as unknown as CrystalSeed, [1, 1, 1, 1, 1, 1], version);
    const hashes = Object.fromEntries(PLATE_PRESETS.map((p) => [p, sha256Hex(renderPlateSvg(g, { preset: p, sizePx: PLATE_SIZE }))])) as Record<PlatePreset, string>;
    return { seed, ...hashes };
  });
  return { renderer: PLATE_RENDERER_VERSION, geometryVersion: version, sizePx: PLATE_SIZE, count: entries.length, entries };
}

/** One entry per line: readable diffs, stable bytes. */
export function serializeGoldenPlates(g: GoldenPlatesFile): string {
  const lines = g.entries.map(
    (e) => `  {"seed":[${e.seed.join(',')}],${PLATE_PRESETS.map((p) => `"${p}":"${e[p]}"`).join(',')}}`,
  );
  return (
    `{\n "renderer": "${g.renderer}",\n "geometryVersion": "${g.geometryVersion}",\n "sizePx": ${g.sizePx},\n` +
    ` "count": ${g.count},\n "entries": [\n${lines.join(',\n')}\n ]\n}\n`
  );
}

function main(argv: readonly string[]): number {
  const started = performance.now();
  const fresh = computeGoldenPlates(HABIT_1);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const file = goldenPlatesPath(HABIT_1);
  const text = serializeGoldenPlates(fresh);
  if (argv.includes('--write')) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    console.log(`tavole dorate scritte: ${fresh.count} seed × ${PLATE_PRESETS.length} viste → ${file}`);
    return 0;
  }
  const committed = JSON.parse(readFileSync(file, 'utf8')) as GoldenPlatesFile;
  const diff = fresh.entries.flatMap((e, i) => (PLATE_PRESETS.some((p) => committed.entries[i]?.[p] !== e[p]) ? [i] : []));
  if (diff.length > 0 || committed.renderer !== fresh.renderer || text !== readFileSync(file, 'utf8')) {
    console.log(`tavole dorate: ${diff.length} seed con SVG diverso (primi: ${diff.slice(0, 5).join(', ')})`);
    return 1;
  }
  console.log(`tavole dorate: ${fresh.count * PLATE_PRESETS.length} SVG identici in Node ${process.version} (${fresh.renderer}, ${seconds} s)`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.exitCode = main(process.argv.slice(2));
}
