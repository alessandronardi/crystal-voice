// Synthetic voice (I-04): Rosenberg glottal pulse train with jitter, breath
// noise, cascade formant filters with a vowel per syllable, syllables at a
// known rate grouped in phrases with pauses. Every random choice comes from
// independent PRNG streams derived from one seed, so the same parameters give
// equivalent signals at 44.1 and 48 kHz (same syllable plan, same jitter per
// glottal period).
//
// The "truth" returned with the signal is computed from the synthesis itself
// (the f0 actually used at each voiced sample, the onsets actually placed), not
// estimated from the waveform.

import { createPrng } from '../prng.ts';
import { activeRms, dbToGain, resonate, samplesFor, scale, type Signal } from './signal.ts';

export interface VoiceParams {
  /** Centre f0 of the speaker. */
  f0Hz: number;
  /** Amplitude of the sinusoidal intonation contour, in semitones. */
  intonationDepthSemitones: number;
  intonationRateHz: number;
  /** Mean syllables per second (onset rate inside phrases). */
  syllableRateHz: number;
  syllablesPerPhrase: number;
  phrasePauseSeconds: number;
  /** Vocal-tract scaling of formant frequencies (1 = adult male table). */
  formantScale: number;
  /** Relative period-to-period f0 jitter (e.g. 0.005 = 0.5%). */
  jitter: number;
  /** Breath noise level relative to the glottal source. */
  breathiness: number;
  /** Active RMS of the result, in dBFS. */
  levelDbfs: number;
}

export interface VoiceTruth {
  f0MedianHz: number;
  /** IQR of 12·log2(f0) over voiced samples. */
  intonationIqrSemitones: number;
  onsetSamples: number[];
  syllableCount: number;
  voicedSeconds: number;
  /** Onsets per second of voiced (syllable) time. */
  onsetsPerVoicedSecond: number;
  /**
   * True f0 every `hopSamples` (≈10 ms) from sample 0: the f0 used by the
   * synthesis at that sample if it is voiced, null otherwise (not 0, R13).
   * Per-frame reference for f0 error and octave errors (BENCHMARK_PROTOCOL M2).
   */
  f0Track: { hopSamples: number; valuesHz: (number | null)[] };
}

export interface VoiceResult {
  signal: Signal;
  truth: VoiceTruth;
}

// Adult male formants (Peterson & Barney averages, rounded) and bandwidths.
const VOWELS: readonly (readonly [number, number, number, number])[] = [
  [730, 1090, 2440, 3400], // a
  [530, 1840, 2480, 3400], // e
  [270, 2290, 3010, 3500], // i
  [570, 840, 2410, 3400], // o
  [300, 870, 2240, 3400], // u
];
const BANDWIDTHS = [80, 90, 120, 150] as const;

const LEAD_SECONDS = 0.3;
const ATTACK_SECONDS = 0.015;
const RELEASE_SECONDS = 0.04;
const NUCLEUS_FRACTION = 0.65;
const RING_SECONDS = 0.05;
const TRACK_HOP_SECONDS = 0.01;

/** Rosenberg glottal flow over one period, phase in [0, 1). Open phase 40%, closing 20%. */
function rosenberg(phase: number): number {
  const tp = 0.4;
  const tn = 0.2;
  if (phase < tp) return 0.5 * (1 - Math.cos((Math.PI * phase) / tp));
  if (phase < tp + tn) return Math.cos((Math.PI * (phase - tp)) / (2 * tn));
  return 0;
}

interface Syllable {
  start: number;
  length: number;
  vowel: number;
  gain: number;
}

export function synthVoice(params: VoiceParams, seconds: number, sampleRate: number, seed: number): VoiceResult {
  const n = samplesFor(seconds, sampleRate);
  const planPrng = createPrng(seed >>> 0);
  const jitterPrng = createPrng((seed ^ 0x9e3779b9) >>> 0);
  const noisePrng = createPrng((seed ^ 0x85ebca6b) >>> 0);
  const contourPhase = createPrng((seed ^ 0xc2b2ae35) >>> 0).range(0, 2 * Math.PI);

  // 1. Syllable plan, in seconds (sample-rate independent), then converted.
  const syllables: Syllable[] = [];
  let t = LEAD_SECONDS;
  let inPhrase = 0;
  for (;;) {
    const duration = (1 / params.syllableRateHz) * planPrng.range(0.85, 1.15);
    const vowel = Math.floor(planPrng.next() * VOWELS.length);
    const gain = planPrng.range(0.75, 1);
    if (t + duration > seconds - LEAD_SECONDS) break;
    syllables.push({
      start: samplesFor(t, sampleRate),
      length: samplesFor(duration * NUCLEUS_FRACTION, sampleRate),
      vowel,
      gain,
    });
    t += duration;
    inPhrase++;
    if (inPhrase === params.syllablesPerPhrase) {
      t += params.phrasePauseSeconds;
      inPhrase = 0;
    }
  }

  // 2. Envelope (per-sample syllable gain) and syllable index per sample.
  const envelope = new Float64Array(n);
  const attack = samplesFor(ATTACK_SECONDS, sampleRate);
  const release = samplesFor(RELEASE_SECONDS, sampleRate);
  for (const s of syllables) {
    for (let i = 0; i < s.length; i++) {
      let w = 1;
      if (i < attack) w = 0.5 - 0.5 * Math.cos((Math.PI * i) / attack);
      else if (i >= s.length - release) w = 0.5 - 0.5 * Math.cos((Math.PI * (s.length - 1 - i)) / release);
      envelope[s.start + i] = s.gain * w;
    }
  }

  // 3. Glottal source (flow derivative = lip radiation) with jitter per period.
  const source = new Float64Array(n);
  const f0Track = new Float64Array(n);
  let phase = 0;
  let periodJitter = 1 + params.jitter * jitterPrng.range(-1, 1);
  let previousFlow = 0;
  for (let i = 0; i < n; i++) {
    const time = i / sampleRate;
    const semis = params.intonationDepthSemitones * Math.sin(2 * Math.PI * params.intonationRateHz * time + contourPhase);
    const f0 = params.f0Hz * 2 ** (semis / 12) * periodJitter;
    f0Track[i] = f0;
    phase += f0 / sampleRate;
    if (phase >= 1) {
      phase -= 1;
      periodJitter = 1 + params.jitter * jitterPrng.range(-1, 1);
    }
    const flow = rosenberg(phase);
    const breath = params.breathiness * noisePrng.range(-1, 1);
    source[i] = (flow - previousFlow) * sampleRate * (1 / params.f0Hz) + breath;
    previousFlow = flow;
  }

  // 4. Formants per syllable (each syllable filtered on its own, with a ringing tail).
  const out = new Float64Array(n);
  const ring = samplesFor(RING_SECONDS, sampleRate);
  for (const s of syllables) {
    const end = Math.min(n, s.start + s.length + ring);
    let segment: Signal = new Float64Array(end - s.start);
    for (let i = 0; i < segment.length; i++) segment[i] = (source[s.start + i] ?? 0) * (envelope[s.start + i] ?? 0);
    const formants = VOWELS[s.vowel] ?? VOWELS[0];
    if (formants === undefined) throw new RangeError('vowel table empty');
    formants.forEach((f, k) => {
      segment = resonate(segment, f * params.formantScale, (BANDWIDTHS[k] ?? 100) * params.formantScale, sampleRate);
    });
    for (let i = 0; i < segment.length; i++) out[s.start + i] = (out[s.start + i] ?? 0) + (segment[i] ?? 0);
  }

  // 5. Level, then truth from the synthesis parameters actually used.
  const level = activeRms(out);
  const signal = level > 0 ? scale(out, dbToGain(params.levelDbfs) / level) : out;

  // Voiced = inside a syllable nucleus with envelope at least half the syllable peak.
  const voiced = new Uint8Array(n);
  const voicedLog2: number[] = [];
  let voicedSamples = 0;
  for (const s of syllables) {
    voicedSamples += s.length;
    for (let i = s.start; i < s.start + s.length; i++) {
      if ((envelope[i] ?? 0) >= 0.5 * s.gain) {
        voiced[i] = 1;
        voicedLog2.push(Math.log2(f0Track[i] ?? params.f0Hz));
      }
    }
  }
  if (voicedLog2.length === 0) throw new RangeError('synthVoice: no voiced samples (duration too short)');
  const hopSamples = samplesFor(TRACK_HOP_SECONDS, sampleRate);
  const valuesHz: (number | null)[] = [];
  for (let i = 0; i < n; i += hopSamples) valuesHz.push(voiced[i] === 1 ? (f0Track[i] ?? null) : null);
  voicedLog2.sort((a, b) => a - b);
  const q = (p: number): number => quantileSorted(voicedLog2, p);
  const voicedSeconds = voicedSamples / sampleRate;
  return {
    signal,
    truth: {
      f0MedianHz: 2 ** q(0.5),
      intonationIqrSemitones: 12 * (q(0.75) - q(0.25)),
      onsetSamples: syllables.map((s) => s.start),
      syllableCount: syllables.length,
      voicedSeconds,
      onsetsPerVoicedSecond: syllables.length / voicedSeconds,
      f0Track: { hopSamples, valuesHz },
    },
  };
}

/** Linear-interpolation quantile (type 7) on a non-empty ascending array. */
function quantileSorted(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new RangeError('quantile of empty array');
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const a = sorted[lo] ?? 0;
  const b = sorted[Math.min(lo + 1, sorted.length - 1)] ?? a;
  return a + (h - lo) * (b - a);
}
