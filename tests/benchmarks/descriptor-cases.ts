// Shared by `pnpm bench:descriptors` and tests/unit/descriptors-fixtures.test.ts
// (I-06a): the extractor on a fixture or on an in-memory synthetic signal,
// with libfvad in the canonical mode, and the seed of mapping-0.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createWebRtcVad, extractDescriptors, type Extraction } from '@voicecrystal/dsp-core';
import { seedFromRaw, type MappedSeed } from '@voicecrystal/calibration';
import { buildFixture, selectSpecs } from '../../scripts/fixtures/build.ts';
import { createPrng } from '../../scripts/fixtures/prng.ts';
import { impulses, logSweep, pinkNoise, tone, whiteNoise } from '../../scripts/fixtures/synth/basic.ts';
import { chords } from '../../scripts/fixtures/synth/music.ts';
import { normalizeTo } from '../../scripts/fixtures/synth/signal.ts';
import { decodeWav } from '../../scripts/fixtures/wav.ts';
import { loadFvad } from './fvad-loader.ts';

export const FIXTURES_DIR = resolve(import.meta.dirname, '../fixtures');

const fvad = loadFvad().fvad;

export interface DescriptorCase {
  name: string;
  extraction: Extraction;
  /** null when the extraction is INSUFFICIENT_DATA (no crystal). */
  mapped: MappedSeed | null;
}

export function runExtraction(name: string, channels: readonly Float32Array[], sampleRate: number): DescriptorCase {
  const vad = createWebRtcVad(fvad);
  try {
    const extraction = extractDescriptors(channels, sampleRate, vad);
    const mapped = extraction.status === 'OK' ? seedFromRaw(extraction.raw) : null;
    return { name, extraction, mapped };
  } finally {
    vad.dispose();
  }
}

export function runFixture(name: string, dir = FIXTURES_DIR): DescriptorCase {
  const wav = decodeWav(new Uint8Array(readFileSync(join(dir, `${name}.wav`))));
  return runExtraction(name, wav.channels, wav.sampleRate);
}

/**
 * A catalog fixture rendered and WAV-encoded in memory, then decoded: the same
 * int16 samples as the file `pnpm fixtures` writes, without needing it (CI
 * runs the unit tests before generating the fixtures).
 */
export function runFixtureInMemory(name: string): DescriptorCase {
  const [spec] = selectSpecs([name]);
  if (spec === undefined) throw new Error(`unknown fixture ${name}`);
  const wav = decodeWav(buildFixture(spec).wav);
  return runExtraction(name, wav.channels, wav.sampleRate);
}

const SR = 48000;
const f32 = (x: ArrayLike<number>): Float32Array => Float32Array.from(x);

/**
 * Longer versions of the rejection fixtures (the files last 4–6 s, too short
 * to test the minimum amounts): same generators, generated in memory, never
 * written (R16 does not apply to synthetic signals, but nothing is committed).
 */
export const LONG_REJECTION_CASES: readonly { name: string; seconds: number; make: () => Float32Array }[] = [
  { name: 'long-tone-200hz', seconds: 30, make: () => f32(tone(200, 30, SR, -12)) },
  { name: 'long-noise-white', seconds: 30, make: () => f32(whiteNoise(30, SR, -20, createPrng(71))) },
  { name: 'long-noise-pink', seconds: 30, make: () => f32(pinkNoise(30, SR, -20, createPrng(72))) },
  { name: 'long-sweep-80-4000hz', seconds: 30, make: () => f32(logSweep(80, 4000, 30, SR, -15)) },
  { name: 'long-impulses', seconds: 30, make: () => f32(impulses(30, SR, 0.25, -3).signal) },
  { name: 'long-music-chords', seconds: 40, make: () => f32(normalizeTo(chords(40, SR, 1.5, createPrng(3301)).signal, -24)) },
  { name: 'long-music-chords-fast', seconds: 40, make: () => f32(normalizeTo(chords(40, SR, 0.5, createPrng(3302)).signal, -24)) },
];

export function runLongCase(c: (typeof LONG_REJECTION_CASES)[number]): DescriptorCase {
  return runExtraction(c.name, [c.make()], SR);
}

/**
 * Short notes (80–190 ms, attack and release 5 ms) at −20 dBFS-ish level, with
 * or without gaps, pure or with 8 harmonics, optional 5.5 Hz vibrato: the
 * counterexamples of the I-06a adversarial review (H-1). They should give no
 * crystal and today they give one: the "stable pitch" cue needs more than
 * 200 ms (SPEC §7.2). Tracked as a KNOWN GAP, not hidden (R14).
 */
function shortNotes(seconds: number, seed: number, o: { gaps: boolean; melody: boolean; harmonics: number; vibrato: boolean }): Float32Array {
  const prng = createPrng(seed);
  const n = seconds * SR;
  const out = new Float32Array(n);
  let i = 0;
  let phase = 0;
  while (i < n) {
    const dur = Math.floor((0.08 + 0.11 * prng.next()) * SR);
    const f = o.melody ? 110 * 2 ** (prng.next() * 1.86) : 200;
    for (let j = 0; j < dur && i < n; j++, i++) {
      const ramp = Math.min(1, j / (0.005 * SR), (dur - j) / (0.005 * SR));
      const fv = o.vibrato ? f * 2 ** ((0.5 * Math.sin((2 * Math.PI * 5.5 * i) / SR)) / 12) : f;
      phase += fv / SR;
      let v = 0;
      for (let k = 1; k <= o.harmonics; k++) v += Math.sin(2 * Math.PI * k * phase) / k;
      out[i] = 0.2 * ramp * v;
    }
    if (o.gaps) i += Math.floor((0.06 + 0.14 * prng.next()) * SR);
  }
  return out;
}

export const KNOWN_GAP_CASES: readonly { name: string; make: () => Float32Array }[] = [
  { name: 'gap-gated-tone-200hz', make: () => shortNotes(20, 9101, { gaps: true, melody: false, harmonics: 1, vibrato: false }) },
  { name: 'gap-pure-melody', make: () => shortNotes(20, 9102, { gaps: false, melody: true, harmonics: 1, vibrato: false }) },
  { name: 'gap-pure-melody-gaps', make: () => shortNotes(20, 9103, { gaps: true, melody: true, harmonics: 1, vibrato: false }) },
  { name: 'gap-saw-melody-gaps', make: () => shortNotes(20, 9104, { gaps: true, melody: true, harmonics: 8, vibrato: false }) },
  { name: 'gap-saw-melody-vibrato', make: () => shortNotes(20, 9105, { gaps: true, melody: true, harmonics: 8, vibrato: true }) },
];

export function runGapCase(c: (typeof KNOWN_GAP_CASES)[number]): DescriptorCase {
  return runExtraction(c.name, [c.make()], SR);
}
