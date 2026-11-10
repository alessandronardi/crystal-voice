// `pnpm fixtures` (I-04): writes tests/fixtures/<name>.wav, <name>.meta.json
// and manifest.json. WAVs are not versioned (.gitignore); meta and manifest are.
//
//   pnpm fixtures            regenerate everything
//   pnpm fixtures --check    regenerate in memory and compare with the
//                            committed manifest and meta files; writes nothing
//   pnpm fixtures --out DIR  write somewhere else (used by tests)

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildFixture, buildManifest, stableJson, type BuiltFixture } from './build.ts';
import { CATALOG } from './catalog.ts';

export const DEFAULT_FIXTURE_DIR = resolve(import.meta.dirname, '../../tests/fixtures');

export function writeFixtures(dir: string, built: readonly BuiltFixture[], manifestText: string): void {
  mkdirSync(dir, { recursive: true });
  for (const b of built) {
    writeFileSync(join(dir, `${b.name}.wav`), b.wav);
    writeFileSync(join(dir, `${b.name}.meta.json`), b.metaText);
  }
  writeFileSync(join(dir, 'manifest.json'), manifestText);
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** Returns the list of differences between a fresh build and the files in `dir`. */
export function checkFixtures(dir: string, built: readonly BuiltFixture[], manifestText: string): string[] {
  const problems: string[] = [];
  if (readText(join(dir, 'manifest.json')) !== manifestText) problems.push('manifest.json differs from a fresh build');
  for (const b of built) {
    if (readText(join(dir, `${b.name}.meta.json`)) !== b.metaText) problems.push(`${b.name}.meta.json differs`);
  }
  // Orphans: meta files of fixtures no longer in the build.
  const names = new Set(built.map((b) => b.name));
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    // Missing directory: already reported through manifest.json.
  }
  for (const f of entries) {
    if (f.endsWith('.meta.json') && !names.has(f.slice(0, -'.meta.json'.length))) problems.push(`${f} is orphaned`);
  }
  return problems;
}

function main(argv: readonly string[]): number {
  const check = argv.includes('--check');
  const outIndex = argv.indexOf('--out');
  const dir = outIndex >= 0 ? resolve(argv[outIndex + 1] ?? DEFAULT_FIXTURE_DIR) : DEFAULT_FIXTURE_DIR;
  const started = performance.now();
  const built = CATALOG.map(buildFixture);
  const manifestText = stableJson(buildManifest(CATALOG, built));
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  if (check) {
    const problems = checkFixtures(dir, built, manifestText);
    if (problems.length > 0) {
      console.error(`fixtures --check: ${problems.length} differenze\n  ${problems.join('\n  ')}`);
      return 1;
    }
    console.log(`fixtures --check: ${built.length} fixture identiche al manifest (${seconds} s)`);
    return 0;
  }
  writeFixtures(dir, built, manifestText);
  const bytes = built.reduce((n, b) => n + b.wav.byteLength, 0);
  console.log(`fixtures: ${built.length} WAV, ${(bytes / 1e6).toFixed(1)} MB in ${dir} (${seconds} s)`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.exitCode = main(process.argv.slice(2));
}
