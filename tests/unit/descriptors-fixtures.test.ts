// I-06a Definition of Done on the synthetic fixtures (BACKLOG I-06, SPEC
// §7.2–§7.5), with libfvad in the canonical mode and mapping-0. Fixtures are
// rendered in memory (same int16 samples as the files). Measured values are
// recorded in docs/BENCHMARK_PROTOCOL.md §7 (`pnpm bench:descriptors`).
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { DESCRIPTOR_KEYS, isCrystalSeed } from '@voicecrystal/contracts';
import { EXTRACTOR_VERSION, qualitySummary } from '@voicecrystal/dsp-core';
import {
  KNOWN_GAP_CASES,
  LONG_REJECTION_CASES,
  runFixtureInMemory,
  runGapCase,
  runLongCase,
  type DescriptorCase,
} from '../benchmarks/descriptor-cases.ts';
import { selectSpecs } from '../../scripts/fixtures/build.ts';

const NAMES = [
  'voice-a',
  'voice-a-plus6db',
  'voice-a-minus6db',
  'voice-a-44k',
  'voice-a-compressed-4to1',
  'voice-b',
  'voice-a-long',
  ...[1, 2, 3, 4, 5].map((v) => `voice-music-12db-v${v}`),
  ...[1, 2, 3].map((v) => `alternating-ab-v${v}`),
  'silence',
  'tone-100hz',
  'tone-200hz',
  'tone-400hz',
  'tone-step-150-300hz',
  'sweep-80-4000hz',
  'noise-white',
  'noise-pink',
  'impulses',
  ...[1, 2, 3].map((v) => `music-chords-v${v}`),
];

const cases = new Map<string, DescriptorCase>();
const get = (name: string): DescriptorCase => {
  const c = cases.get(name);
  if (c === undefined) throw new Error(`case ${name} not computed`);
  return c;
};

beforeAll(() => {
  for (const name of NAMES) cases.set(name, runFixtureInMemory(name));
  for (const c of LONG_REJECTION_CASES) cases.set(c.name, runLongCase(c));
}, 300_000);

describe('extractor-0-experimental on the fixtures', () => {
  it('uses the canonical VAD and version', () => {
    expect(get('voice-a').extraction.extractorVersion).toBe(EXTRACTOR_VERSION);
    expect(get('voice-a').extraction.vad).toMatchObject({ id: 'webrtc-fvad-0', mode: 2 });
  });

  it('never emits NaN, Infinity or a seed outside the integer range', () => {
    for (const c of cases.values()) {
      const x = c.extraction;
      for (const v of [...x.raw, ...x.confidence, ...x.coverage, x.music.share, x.gainDb]) {
        if (v !== null) expect(Number.isFinite(v)).toBe(true);
      }
      for (const v of x.confidence) expect(v >= 0 && v <= 1).toBe(true);
      if (c.mapped !== null) expect(isCrystalSeed(c.mapped.seed)).toBe(true);
      // A null measure always means INSUFFICIENT_DATA, never a default (R13).
      if (x.raw.some((v) => v === null)) expect(x.status).toBe('INSUFFICIENT_DATA');
    }
  });

  it('measures the clean synthetic voice close to its ground truth', () => {
    const [spec] = selectSpecs(['voice-a']);
    const truth = spec?.render().expected as { f0MedianHz: number; intonationIqrSemitones: number };
    const x = get('voice-a').extraction;
    expect(2 ** (x.raw[0] ?? 0) / truth.f0MedianHz).toBeCloseTo(1, 2);
    expect(Math.abs((x.raw[1] ?? 0) - truth.intonationIqrSemitones)).toBeLessThan(0.1);
    expect(x.status).toBe('OK');
    // 22 onsets (minimum 20) → p6 coverage 0.55; × (1 − 12% stable-pitch cues) = 0.48: veiled (D-U, measured).
    expect(x.veiledKeys).toEqual(['p6_rhythm']);
    expect(x.warnings).toEqual(['LOW_CONFIDENCE_PARAMETER', 'EXPERIMENTAL_MAPPING']);
    expect(get('voice-a-long').extraction.veiledKeys).toEqual([]);
  });

  it('DoD: ±6 dB and 44.1/48 kHz change no parameter by more than 1 point', () => {
    const base = get('voice-a').mapped;
    expect(base).not.toBeNull();
    for (const v of ['voice-a-plus6db', 'voice-a-minus6db', 'voice-a-44k']) {
      const m = get(v).mapped;
      expect(m, v).not.toBeNull();
      DESCRIPTOR_KEYS.forEach((key, i) => {
        expect(Math.abs((m?.points[i] ?? 0) - (base?.points[i] ?? 0)), `${v} ${key}`).toBeLessThanOrEqual(1);
      });
    }
  });

  it('DoD: silence, tones, sweeps, noise, impulses and music alone give no crystal', () => {
    const rejected = [
      'silence', 'tone-100hz', 'tone-200hz', 'tone-400hz', 'tone-step-150-300hz', 'sweep-80-4000hz',
      'noise-white', 'noise-pink', 'impulses', 'music-chords-v1', 'music-chords-v2', 'music-chords-v3',
      ...LONG_REJECTION_CASES.map((c) => c.name),
    ];
    for (const name of rejected) {
      const c = get(name);
      expect(c.extraction.status, name).toBe('INSUFFICIENT_DATA');
      expect(c.mapped, name).toBeNull();
      expect(qualitySummary(c.extraction).accepted, name).toBe(false);
    }
  });

  it('DoD: voice + music at −12 dB → MIXED_AUDIO_UNCERTAIN on every variant (≥ 90% of 5)', () => {
    for (let v = 1; v <= 5; v++) expect(get(`voice-music-12db-v${v}`).extraction.warnings).toContain('MIXED_AUDIO_UNCERTAIN');
  });

  it('no music warning and no several-voices warning on the clean single voices', () => {
    for (const name of ['voice-a', 'voice-a-plus6db', 'voice-a-minus6db', 'voice-a-44k', 'voice-a-compressed-4to1', 'voice-b', 'voice-a-long']) {
      const w = get(name).extraction.warnings;
      expect(w, name).not.toContain('MIXED_AUDIO_UNCERTAIN');
      expect(w, name).not.toContain('MULTI_SPEAKER_SUSPECTED');
    }
  });

  it('DoD (measured, below the 90% target): A/B alternation → MULTI_SPEAKER_SUSPECTED on 2 of 3 variants', () => {
    // v2 (B at 150 Hz, formants ×1.08) is not detected: BENCHMARK_PROTOCOL §7, ADR-0024.
    const flagged = [1, 2, 3].filter((v) => get(`alternating-ab-v${v}`).extraction.warnings.includes('MULTI_SPEAKER_SUSPECTED'));
    expect(flagged).toEqual([1, 3]);
    expect(get('alternating-ab-v1').extraction.speakers.pitchCriterion).toBe(true);
  });

  it('DoD: compression 4:1 lowers p3 (VC-10, measured and reported)', () => {
    const a = get('voice-a').extraction.raw[2] ?? 0;
    const c = get('voice-a-compressed-4to1').extraction.raw[2] ?? 0;
    expect(c - a).toBeLessThan(-6);
  });

  it('a several-voices warning never lowers confidence (SPEC §7.2: the user answers)', () => {
    const x = get('alternating-ab-v1').extraction;
    expect(x.status).toBe('OK');
    x.confidence.forEach((c, i) => {
      expect(c).toBeCloseTo((x.coverage[i] ?? 0) * (['p2_intonation', 'p3_dynamics', 'p4_roughness', 'p6_rhythm'].includes(DESCRIPTOR_KEYS[i] ?? '') ? 1 - x.music.share : 1), 12);
    });
  });

  it('is deterministic bit for bit', () => {
    expect(runFixtureInMemory('voice-a')).toEqual(get('voice-a'));
  });

  it('extractor-0-experimental has not changed meaning: result digests are pinned (review M-1)', () => {
    // Any change to a formula, window, VAD mapping or heuristic changes these
    // digests: bump EXTRACTOR_VERSION and update them deliberately.
    const digest = (name: string): string => {
      const x = get(name).extraction;
      const payload = { raw: x.raw, confidence: x.confidence, warnings: x.warnings, status: x.status, music: x.music, speakers: x.speakers, gainDb: x.gainDb };
      return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    };
    expect({
      version: EXTRACTOR_VERSION,
      'voice-a': digest('voice-a'),
      'voice-music-12db-v1': digest('voice-music-12db-v1'),
      'alternating-ab-v1': digest('alternating-ab-v1'),
    }).toMatchInlineSnapshot(`
      {
        "alternating-ab-v1": "56113a40d2a54f170b9f9523bdd3d2a0ac6f84755e88d1494a198da8aa2bb3f9",
        "version": "extractor-0-experimental",
        "voice-a": "5d91cc34a8ff9ac2299f8de05c21510a8819a325707f635e7cfd09c4b42ca199",
        "voice-music-12db-v1": "c850e7193d4894ebe5bbbb1cf8fa753816633dd37b74d4d2e9176d1a6c03eefc",
      }
    `);
  });
});

describe('KNOWN GAP (review H-1): short notes give a crystal', () => {
  // Gated tones and monophonic melodies with notes of 80–190 ms carry no music
  // cue (the stable-pitch cue needs > 200 ms, SPEC §7.2) and give a full
  // crystal. Recorded in VC-11 and ADR-0024. `it.fails` keeps the gap visible:
  // the day a cue rejects them, these tests turn red and must become `it`.
  for (const c of KNOWN_GAP_CASES) {
    it.fails(`${c.name} gives no crystal`, () => {
      expect(runGapCase(c).extraction.status).toBe('INSUFFICIENT_DATA');
    });
  }
});
