// Non-voice fixtures (I-04): silence, tones, sweeps, noise, impulses.
// They must all be rejected by the pipeline (BENCHMARK_PROTOCOL M1).

import type { Prng } from '../prng.ts';
import { dbToGain, fadeEdges, normalizeTo, samplesFor, type Signal } from './signal.ts';

export function silence(seconds: number, sampleRate: number): Signal {
  return new Float64Array(samplesFor(seconds, sampleRate));
}

export function tone(freqHz: number, seconds: number, sampleRate: number, levelDbfs: number): Signal {
  const n = samplesFor(seconds, sampleRate);
  // Peak amplitude for a sine with the requested RMS: A = √2 · rms.
  const amp = Math.SQRT2 * dbToGain(levelDbfs);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  return fadeEdges(out, samplesFor(0.01, sampleRate));
}

/** Exponential (log-frequency) sweep from f0 to f1. Instantaneous frequency f(t) = f0·(f1/f0)^(t/T). */
export function logSweep(f0: number, f1: number, seconds: number, sampleRate: number, levelDbfs: number): Signal {
  const n = samplesFor(seconds, sampleRate);
  const k = Math.log(f1 / f0);
  const amp = Math.SQRT2 * dbToGain(levelDbfs);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const phase = ((2 * Math.PI * f0 * seconds) / k) * (Math.exp((t / seconds) * k) - 1);
    out[i] = amp * Math.sin(phase);
  }
  return fadeEdges(out, samplesFor(0.01, sampleRate));
}

export function whiteNoise(seconds: number, sampleRate: number, levelDbfs: number, prng: Prng): Signal {
  const n = samplesFor(seconds, sampleRate);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = prng.range(-1, 1);
  return normalizeTo(out, levelDbfs);
}

/** Pink noise with Paul Kellet's refined filter (−3 dB/octave within ±0.05 dB above 9 Hz at 44.1 kHz). */
export function pinkNoise(seconds: number, sampleRate: number, levelDbfs: number, prng: Prng): Signal {
  const n = samplesFor(seconds, sampleRate);
  const out = new Float64Array(n);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = prng.range(-1, 1);
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return normalizeTo(out, levelDbfs);
}

/** Single-sample clicks of the given peak level, every `intervalSeconds`. Returns the click positions too. */
export function impulses(
  seconds: number,
  sampleRate: number,
  intervalSeconds: number,
  peakDbfs: number,
): { signal: Signal; positions: number[] } {
  const n = samplesFor(seconds, sampleRate);
  const out = new Float64Array(n);
  const step = samplesFor(intervalSeconds, sampleRate);
  const positions: number[] = [];
  const amp = dbToGain(peakDbfs);
  for (let i = step; i < n; i += step) {
    out[i] = amp;
    positions.push(i);
  }
  return { signal: out, positions };
}
