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
  const pct = (v: number | null): string => (v === null ? 'n/d' : `${(v * 100).toFixed(2)}%`);
  const { m2 } = report;
  console.log(`M2 su ${m2.scope}`);
  console.log(
    `M2 (${m2.fixtures.length} fixture, ${m2.framesCompared} frame): errore mediano ${pct(m2.medianRelError)} ` +
      `(obiettivo ≤ ${pct(m2.targets.medianRelError)}), errori d'ottava ${pct(m2.octaveErrorRate)} ` +
      `(obiettivo ≤ ${pct(m2.targets.octaveErrorRate)}) → ${m2.meetsTargets === null ? 'non misurabile' : m2.meetsTargets ? 'entro gli obiettivi' : 'FUORI OBIETTIVO'}`,
  );
  for (const f of report.fixtures) {
    const t = f.pitch.truth;
    console.log(
      `  ${f.name.padEnd(28)} f0 mediana ${f.pitch.medianF0Hz?.toFixed(2) ?? 'n/d'} Hz` +
        (t
          ? ` · err ${pct(t.medianRelError)} · ottava ${pct(t.octaveErrorRate)} · mancati ${pct(t.missedVoicedRate)}` +
            ` (f0 vera mediana ${t.missedMedianTrueF0Hz?.toFixed(1) ?? 'n/d'} Hz) · falsi ${pct(t.falseVoicedRate)}` +
            ` · mediana vs vera ${pct(t.medianF0RelError)}`
          : '') +
        (f.pitch.toneRelError !== null ? ` · tono ${pct(f.pitch.toneRelError)}` : '') +
        ` · mono ${f.monoRule}${f.warnings.length > 0 ? ` ${f.warnings.join(',')}` : ''}`,
    );
  }
  for (const [pair, cents] of Object.entries(report.invariance)) {
    console.log(`  Δ f0 ${pair}: ${cents === null ? 'n/d' : `${cents.toFixed(2)} cent`}`);
  }
  const { totals } = report;
  console.log(
    `bench: ${totals.fixtures} fixture, ${totals.audioSeconds.toFixed(1)} s di audio, ` +
      `analisi ${totals.analysisMs.toFixed(0)} ms (${totals.secondsPerAudioSecond.toExponential(2)} s/s), ` +
      `totale ${((performance.now() - started) / 1000).toFixed(1)} s → ${file}`,
  );
  return 0;
}

process.exitCode = main(process.argv.slice(2));
