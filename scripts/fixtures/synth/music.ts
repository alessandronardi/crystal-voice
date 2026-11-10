// Sustained synthetic chords and chain effects (I-04).

import type { Prng } from '../prng.ts';
import { dbToGain, gainToDb, samplesFor, type Signal } from './signal.ts';

// Triads (semitones above the root) and roots (MIDI notes) for the progression.
const CHORDS: readonly (readonly number[])[] = [
  [0, 4, 7],
  [0, 3, 7],
  [0, 4, 7, 11],
  [0, 3, 7, 10],
];
const HARMONICS = 8;

const midiToHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

export interface ChordTruth {
  chordSeconds: number;
  /** MIDI notes of each chord, in order. */
  progression: number[][];
}

/**
 * Additive chords (harmonics with 1/k amplitude), each `chordSeconds` long with
 * 50 ms cross-fades: stable pitch for far longer than 200 ms and harmonic energy
 * between syllables, the music cues of SPEC §7.2. Unnormalized.
 */
export function chords(seconds: number, sampleRate: number, chordSeconds: number, prng: Prng): { signal: Signal; truth: ChordTruth } {
  const n = samplesFor(seconds, sampleRate);
  const out = new Float64Array(n);
  const chordLen = samplesFor(chordSeconds, sampleRate);
  const fade = samplesFor(0.05, sampleRate);
  const progression: number[][] = [];
  for (let start = 0; start < n; start += chordLen) {
    const shape = CHORDS[Math.floor(prng.next() * CHORDS.length)] ?? CHORDS[0] ?? [0];
    const root = 48 + Math.floor(prng.next() * 12);
    const notes = shape.map((s) => root + s);
    progression.push(notes);
    const end = Math.min(n, start + chordLen + fade);
    for (const note of notes) {
      const f = midiToHz(note);
      for (let k = 1; k <= HARMONICS; k++) {
        const fk = f * k;
        if (fk >= sampleRate / 2) break;
        const amp = 1 / k;
        for (let i = start; i < end; i++) {
          const local = i - start;
          let w = 1;
          if (local < fade) w = local / fade;
          else if (local >= chordLen) w = 1 - (local - chordLen) / fade;
          out[i] = (out[i] ?? 0) + amp * w * Math.sin((2 * Math.PI * fk * i) / sampleRate);
        }
      }
    }
  }
  return { signal: out, truth: { chordSeconds, progression } };
}

/** Hard clipping at ±1 after a gain; returns the fraction of clipped samples. */
export function hardClip(x: Signal, gainDb: number): { signal: Signal; clippedFraction: number } {
  const g = dbToGain(gainDb);
  const out = new Float64Array(x.length);
  let clipped = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (x[i] ?? 0) * g;
    if (v >= 1 || v <= -1) clipped++;
    out[i] = v > 1 ? 1 : v < -1 ? -1 : v;
  }
  return { signal: out, clippedFraction: x.length > 0 ? clipped / x.length : 0 };
}

export interface CompressorParams {
  thresholdDbfs: number;
  ratio: number;
  attackSeconds: number;
  releaseSeconds: number;
}

/**
 * Feed-forward compressor with a peak-envelope detector (one-pole attack and
 * release) and a hard knee. No make-up gain: the level change is part of what
 * VC-10 measures.
 */
export function compress(x: Signal, sampleRate: number, p: CompressorParams): Signal {
  const aAtt = Math.exp(-1 / (p.attackSeconds * sampleRate));
  const aRel = Math.exp(-1 / (p.releaseSeconds * sampleRate));
  const out = new Float64Array(x.length);
  let env = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i] ?? 0;
    const level = Math.abs(v);
    env = level > env ? aAtt * env + (1 - aAtt) * level : aRel * env + (1 - aRel) * level;
    let gain = 1;
    if (env > 0) {
      const over = gainToDb(env) - p.thresholdDbfs;
      if (over > 0) gain = dbToGain(-over * (1 - 1 / p.ratio));
    }
    out[i] = v * gain;
  }
  return out;
}
