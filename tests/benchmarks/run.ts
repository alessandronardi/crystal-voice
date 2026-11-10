// `pnpm bench` (I-04): runs the harness on tests/fixtures and writes
// tests/benchmarks/out/bench-<timestamp>.json plus latest.json (not versioned).
//
//   pnpm bench [--fixtures DIR] [--out DIR]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BenchError, describeEnvironment, runBench } from './harness.ts';

const ROOT = resolve(import.meta.dirname, '../..');

function arg(argv: readonly string[], flag: string, fallback: string): string {
  const i = argv.indexOf(flag);
  return i >= 0 ? resolve(argv[i + 1] ?? fallback) : fallback;
}

function main(argv: readonly string[]): number {
  const fixtureDir = arg(argv, '--fixtures', join(ROOT, 'tests/fixtures'));
  const outDir = arg(argv, '--out', join(ROOT, 'tests/benchmarks/out'));
  const now = new Date();
  const started = performance.now();
  let report;
  try {
    report = runBench(fixtureDir, describeEnvironment(now));
  } catch (error) {
    if (error instanceof BenchError) {
      console.error(`bench: ${error.code}: ${error.message}`);
      return 1;
    }
    throw error;
  }
  const text = `${JSON.stringify(report, null, 2)}\n`;
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `bench-${now.toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, text);
  writeFileSync(join(outDir, 'latest.json'), text);
  const { totals } = report;
  console.log(
    `bench: ${totals.fixtures} fixture, ${totals.audioSeconds.toFixed(1)} s di audio, ` +
      `analisi ${totals.analysisMs.toFixed(0)} ms (${totals.secondsPerAudioSecond.toExponential(2)} s/s), ` +
      `totale ${((performance.now() - started) / 1000).toFixed(1)} s → ${file}`,
  );
  return 0;
}

process.exitCode = main(process.argv.slice(2));
