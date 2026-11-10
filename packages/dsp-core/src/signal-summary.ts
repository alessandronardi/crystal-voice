// Whole-signal summary (I-04): the first analyzer run by `pnpm bench`. Level
// and clipping only; frame-level features arrive with I-05/I-06 (SPEC §7.3).

import { CLIP_THRESHOLD } from './config.ts';
import { DspInputError } from './errors.ts';

export const SIGNAL_SUMMARY_VERSION = 'signal-summary-0';

export interface SignalSummary {
  sampleRate: number;
  lengthSamples: number;
  /** Max |x|; 0 for empty or silent input. */
  peak: number;
  /** RMS in dBFS (sine at full scale = −3.01). null when RMS is 0: −∞ is not a number we emit. */
  rmsDbfs: number | null;
  /** Samples with |x| ≥ CLIP_THRESHOLD. */
  clippedSamples: number;
}

export function signalSummary(pcm: Float32Array, sampleRate: number): SignalSummary {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new DspInputError('BAD_SAMPLE_RATE', `sample rate ${String(sampleRate)}`);
  }
  let peak = 0;
  let sumSquares = 0;
  let clippedSamples = 0;
  for (const v of pcm) {
    if (!Number.isFinite(v)) throw new DspInputError('NON_FINITE_INPUT', 'non-finite PCM sample');
    const a = Math.abs(v);
    if (a > peak) peak = a;
    if (a >= CLIP_THRESHOLD) clippedSamples++;
    sumSquares += v * v;
  }
  const rms = pcm.length > 0 ? Math.sqrt(sumSquares / pcm.length) : 0;
  return {
    sampleRate,
    lengthSamples: pcm.length,
    peak,
    rmsDbfs: rms > 0 ? 20 * Math.log10(rms) : null,
    clippedSamples,
  };
}
