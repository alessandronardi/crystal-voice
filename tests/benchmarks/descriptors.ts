// `pnpm bench:descriptors` (I-06a, SPEC §7.2–§7.5, BENCHMARK_PROTOCOL §7):
// extractor-0-experimental on every fixture and on the long rejection cases.
// Prints the tables recorded in BENCHMARK_PROTOCOL §7 and writes
// tests/benchmarks/out/descriptors.json. Synthetic signals only (R16).
//
//   pnpm bench:descriptors [--fixtures DIR] [--out DIR]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DESCRIPTOR_KEYS } from '@voicecrystal/contracts';
import { describeEnvironment, readManifest } from './harness.ts';
import { FIXTURES_DIR, KNOWN_GAP_CASES, LONG_REJECTION_CASES, runFixture, runGapCase, runLongCase, type DescriptorCase } from './descriptor-cases.ts';

const ROOT = resolve(import.meta.dirname, '../..');

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? resolve(process.argv[i + 1] ?? fallback) : fallback;
}

const fmt = (v: number | null | undefined, d = 2): string => (v === null || v === undefined ? '—' : v.toFixed(d));

/** Distance, in seed units, from 100·p to the nearest rounding boundary (k + 0.5). */
export function roundingMargin(point: number): number {
  const u = point * 100;
  return Math.abs(u - Math.floor(u) - 0.5);
}

function row(c: DescriptorCase): Record<string, unknown> {
  const x = c.extraction;
  return {
    name: c.name,
    status: x.status,
    extractorVersion: x.extractorVersion,
    gainDb: x.gainDb,
    usefulSeconds: x.amounts.usefulFrames / 100,
    intonatedSeconds: x.amounts.intonatedFrames / 100,
    onsets: x.amounts.onsets,
    raw: x.raw,
    points: c.mapped?.points ?? null,
    seed: c.mapped?.seed ?? null,
    confidence: x.confidence,
    missing: x.missingFeatureKeys,
    veiled: x.veiledKeys,
    warnings: x.warnings,
    music: x.music,
    speakers: x.speakers,
  };
}

function main(): void {
  const dir = arg('--fixtures', FIXTURES_DIR);
  const outDir = arg('--out', join(ROOT, 'tests/benchmarks/out'));
  const manifest = readManifest(dir);
  const names = Object.keys(manifest.files).sort();
  const cases = new Map<string, DescriptorCase>();
  for (const name of names) cases.set(name, runFixture(name, dir));
  for (const c of LONG_REJECTION_CASES) cases.set(c.name, runLongCase(c));
  const gaps = KNOWN_GAP_CASES.map(runGapCase);

  console.log('\n## Per fixture\n');
  console.log('| Caso | Esito | Utili s | Intonati s | Onset | Mancano | Musica (quota; altezza/armonica/flusso) | Bimod. | Distanza st | Gruppo min. | Salti centroide | Avvisi |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of cases.values()) {
    const x = c.extraction;
    const m = x.music;
    const s = x.speakers;
    const warn = x.warnings.filter((w) => w !== 'EXPERIMENTAL_MAPPING').join(', ') || '—';
    console.log(
      `| ${c.name} | ${x.status} | ${fmt(x.amounts.usefulFrames / 100, 1)} | ${fmt(x.amounts.intonatedFrames / 100, 1)} | ${x.amounts.onsets} | ${x.missingFeatureKeys.join(', ') || '—'} | ${fmt(m.share * 100, 0)}%; ${m.cueFrames.stablePitch}/${m.cueFrames.harmonicUnpitched}/${m.cueFrames.periodicFlux} | ${fmt(s.bimodality, 3)} | ${fmt(s.gapSemitones, 2)} | ${s.minorGroupShare === null ? '—' : `${fmt(s.minorGroupShare * 100, 0)}%`} | ${s.centroidJumps}/${s.centroidTransitions} | ${warn} |`,
    );
  }

  console.log('\n## Raw measures, points (mapping-0) and confidence\n');
  console.log(`| Caso | ${DESCRIPTOR_KEYS.join(' | ')} |`);
  console.log(`|---|${DESCRIPTOR_KEYS.map(() => '---').join('|')}|`);
  for (const c of cases.values()) {
    const x = c.extraction;
    const cells = DESCRIPTOR_KEYS.map((_, i) => {
      const p = c.mapped?.points[i];
      return `${fmt(x.raw[i], 3)} · ${p === undefined ? '—' : fmt(p, 1)} · c ${fmt(x.confidence[i], 2)}`;
    });
    console.log(`| ${c.name} | ${cells.join(' | ')} |`);
  }

  // Invariance (DoD: Δ ≤ 1 point per parameter): gain ±6 dB and 44.1 vs 48 kHz against voice-a.
  const base = cases.get('voice-a');
  const invariance: Record<string, (number | null)[]> = {};
  console.log('\n## Invariance against voice-a (Δ points per parameter; DoD ≤ 1)\n');
  console.log(`| Variante | ${DESCRIPTOR_KEYS.join(' | ')} | max |`);
  console.log(`|---|${DESCRIPTOR_KEYS.map(() => '---').join('|')}|---|`);
  for (const v of ['voice-a-plus6db', 'voice-a-minus6db', 'voice-a-44k']) {
    const c = cases.get(v);
    const deltas = DESCRIPTOR_KEYS.map((_, i) => {
      const a = base?.mapped?.points[i];
      const b = c?.mapped?.points[i];
      return a === undefined || b === undefined ? null : Math.abs(a - b);
    });
    invariance[v] = deltas;
    const max = Math.max(...deltas.map((d) => d ?? Infinity));
    console.log(`| ${v} | ${deltas.map((d) => fmt(d, 2)).join(' | ')} | ${fmt(max, 2)} |`);
  }

  const comp = cases.get('voice-a-compressed-4to1');
  const dp3raw = base && comp && base.extraction.raw[2] !== null && comp.extraction.raw[2] !== null ? comp.extraction.raw[2] - base.extraction.raw[2] : null;
  const dp3pt = base?.mapped && comp?.mapped ? comp.mapped.points[2] - base.mapped.points[2] : null;
  console.log(`\n## Compression 4:1 (VC-10)\n\nΔp3 = ${fmt(dp3raw, 2)} dB = ${fmt(dp3pt, 1)} punti (compressed − voice-a)`);

  const rate = (prefix: string, warning: string, exclude: string | null = null): { hit: number; of: number; names: string[] } => {
    const sel = [...cases.values()].filter((c) => c.name.startsWith(prefix) && (exclude === null || !c.name.startsWith(exclude)));
    const hits = sel.filter((c) => c.extraction.warnings.includes(warning as never));
    return { hit: hits.length, of: sel.length, names: hits.map((c) => c.name) };
  };
  const warningRates = {
    mixed12: rate('voice-music-12db', 'MIXED_AUDIO_UNCERTAIN'),
    mixed6: rate('voice-music-6db', 'MIXED_AUDIO_UNCERTAIN'),
    mixed18: rate('voice-music-18db', 'MIXED_AUDIO_UNCERTAIN'),
    multiAB: rate('alternating-ab', 'MULTI_SPEAKER_SUSPECTED'),
    multiAthenB: rate('a-then-b', 'MULTI_SPEAKER_SUSPECTED'),
    mixedCleanVoice: rate('voice-', 'MIXED_AUDIO_UNCERTAIN', 'voice-music'),
    multiCleanVoice: rate('voice-', 'MULTI_SPEAKER_SUSPECTED', 'voice-music'),
    multiVoiceMusic: rate('voice-music', 'MULTI_SPEAKER_SUSPECTED'),
  };
  console.log('\n## Warning rates\n');
  for (const [k, r] of Object.entries(warningRates)) console.log(`- ${k}: ${r.hit}/${r.of}${r.names.length ? ` (${r.names.join(', ')})` : ''}`);

  const rejected = ['silence', 'tone-', 'noise-', 'sweep-', 'impulses', 'music-chords', 'long-'];
  console.log('\n## Rejection (no crystal expected)\n');
  for (const c of cases.values()) {
    if (!rejected.some((p) => c.name.startsWith(p))) continue;
    console.log(`- ${c.name}: ${c.extraction.status}; missing ${c.extraction.missingFeatureKeys.join(', ') || '—'}; veiled ${c.extraction.veiledKeys.join(', ') || '—'}`);
  }

  console.log('\n## KNOWN GAP (review H-1): short notes, should give no crystal\n');
  for (const c of gaps) {
    const x = c.extraction;
    console.log(`- ${c.name}: ${x.status}; music share ${fmt(x.music.share * 100, 0)}%; onsets ${x.amounts.onsets}; veiled ${x.veiledKeys.join(', ') || '—'}; seed ${c.mapped ? JSON.stringify(c.mapped.seed) : '—'}`);
  }

  // Seed margin (VC-24): smallest distance to a rounding boundary over OK cases.
  let minMargin = Infinity;
  let where = '';
  for (const c of cases.values()) {
    c.mapped?.points.forEach((p, i) => {
      if (p <= 0 || p >= 100) return; // saturated: an ULP cannot move it
      const m = roundingMargin(p);
      if (m < minMargin) {
        minMargin = m;
        where = `${c.name} ${DESCRIPTOR_KEYS[i] ?? ''}`;
      }
    });
  }
  console.log(`\n## Seed margin (VC-24)\n\nSmallest distance to a rounding boundary: ${fmt(minMargin, 6)} seed units (${where}).`);

  mkdirSync(outDir, { recursive: true });
  const report = {
    environment: { ...describeEnvironment(new Date()), extractorVersion: base?.extraction.extractorVersion ?? null, mappingVersion: base?.mapped?.mappingVersion ?? null },
    fixturesVersion: manifest.fixturesVersion,
    cases: [...cases.values()].map(row),
    knownGaps: gaps.map(row),
    invariance,
    compression: { dp3Db: dp3raw, dp3Points: dp3pt },
    warningRates,
    seedMargin: { minUnits: minMargin, where },
  };
  writeFileSync(join(outDir, 'descriptors.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nwrote ${join(outDir, 'descriptors.json')}`);
}

if (import.meta.main) main();
