// Builds packages/calibration/mapping-0-experimental.json (SPEC §7.5, ADR-0006):
// before G1 each table is linear between provisional anchors, tabulated as the
// 101 percentiles P0…P100 like the real quantile tables of mapping-1 (I-09).
//
//   node scripts/calibration/build-mapping-0.ts           write the file
//   node scripts/calibration/build-mapping-0.ts --check   exit 1 if it differs
//
// The anchors in log2 are computed here, once, and committed as numbers: at run
// time the mapping is arithmetic only, so the seed never depends on the
// engine's Math.log2 for the table (VC-24).

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const MAPPING_0_PATH = resolve(import.meta.dirname, '../../packages/calibration/mapping-0-experimental.json');

interface ParameterSpec {
  measure: string;
  unit: string;
  low: number;
  high: number;
}

/** SPEC §7.5: p1 70–320 Hz in log2; p2 0–8 st; p3 6–30 dB; p4 0.05–0.45; p5 600–2400 Hz in log2; p6 2–7 onsets/s. */
const PARAMETERS: Readonly<Record<string, ParameterSpec>> = {
  p1_pitch: { measure: 'median of log2(f0Hz) over intonated frames', unit: 'log2(Hz)', low: Math.log2(70), high: Math.log2(320) },
  p2_intonation: { measure: 'IQR of 12·log2(f0Hz) over intonated frames', unit: 'semitones', low: 0, high: 8 },
  p3_dynamics: { measure: 'P90 − P10 of normalized rmsDbfs over intonated frames (ADR-0024, D-V)', unit: 'dB', low: 6, high: 30 },
  p4_roughness: { measure: 'median of 1 − periodicity over intonated frames', unit: 'aperiodicity', low: 0.05, high: 0.45 },
  p5_brightness: { measure: 'median of log2(centroid 300–4000 Hz) over useful frames', unit: 'log2(Hz)', low: Math.log2(600), high: Math.log2(2400) },
  p6_rhythm: { measure: 'onsets per second of intonated frames (ADR-0024, D-V)', unit: 'onsets/s', low: 2, high: 7 },
};

export function buildMapping0(): string {
  const parameters: Record<string, unknown> = {};
  for (const [key, p] of Object.entries(PARAMETERS)) {
    const percentiles = Array.from({ length: 101 }, (_, k) => (k === 100 ? p.high : p.low + ((p.high - p.low) * k) / 100));
    parameters[key] = { measure: p.measure, unit: p.unit, anchors: [p.low, p.high], percentiles };
  }
  const table = {
    mappingVersion: 'mapping-0-experimental',
    experimental: true,
    description: 'Linear tables between the provisional anchors of SPEC §7.5, before calibration (G1). Not a population quantile table.',
    parameters,
  };
  return `${JSON.stringify(table, null, 2)}\n`;
}

if (import.meta.main) {
  const text = buildMapping0();
  if (process.argv.includes('--check')) {
    const current = readFileSync(MAPPING_0_PATH, 'utf8').replace(/\r\n/g, '\n');
    if (current !== text) {
      console.error('mapping-0-experimental.json differs from the generator output');
      process.exit(1);
    }
    console.log('mapping-0-experimental.json is up to date');
  } else {
    writeFileSync(MAPPING_0_PATH, text);
    console.log(`wrote ${MAPPING_0_PATH}`);
  }
}
