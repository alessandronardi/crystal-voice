// VAD interface (SPEC §7.2) and the band-energy pre-filter.
//
// Engines (WebRTC libfvad, Silero) arrive with I-05b behind `VadEngine`. The
// pre-filter here is RMS + share of energy in 85–3400 Hz: SPEC §7.2 allows it
// ONLY as pre-filter and diagnostics, never as the main VAD, hence
// `primary: false`. Binary engines report probability null: a probability is
// never invented (SPEC §7.2). The band filter is a single 2nd-order RBJ
// band-pass (≈ 6 dB/octave skirts, edges at −3 dB): a coarse cue, not a
// brick-wall band.
//
// LIMIT (review I-05a, H1): this interface is synchronous and fixed at 20 ms
// frames, which fits libfvad. Silero works on 512-sample windows and ONNX
// Runtime Web returns Promises: its adapter, or a revised interface, is part of
// I-05b, which fixes the final shape of VadEngine.

import {
  ANALYSIS_SAMPLE_RATE,
  PREFILTER_HIGH_HZ,
  PREFILTER_LOW_HZ,
  PREFILTER_MIN_BAND_RATIO,
  PREFILTER_MIN_DBFS,
  VAD_FRAME_SAMPLES,
} from './config.ts';
import { DspInputError } from './errors.ts';

export interface VadFrameResult {
  speech: boolean;
  /** Engine probability in [0, 1], or null for engines with a binary decision only. */
  probability: number | null;
}

export interface VadEngine {
  readonly id: string;
  /** False for diagnostics-only detectors: they must never gate the seed. */
  readonly primary: boolean;
  readonly sampleRate: typeof ANALYSIS_SAMPLE_RATE;
  readonly frameSamples: typeof VAD_FRAME_SAMPLES;
  /** Frames must be fed in order; engines may keep state between frames. */
  process(frame: Float32Array): VadFrameResult;
  /** Clears inter-frame state (new session). */
  reset(): void;
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** RBJ cookbook band-pass (constant 0 dB peak gain) between two edges. */
function bandPass(lowHz: number, highHz: number, sampleRate: number): Biquad {
  const centre = Math.sqrt(lowHz * highHz);
  const bwOctaves = Math.log2(highHz / lowHz);
  const w0 = (2 * Math.PI * centre) / sampleRate;
  const alpha = Math.sin(w0) * Math.sinh(((Math.LN2 / 2) * bwOctaves * w0) / Math.sin(w0));
  const a0 = 1 + alpha;
  return { b0: alpha / a0, b1: 0, b2: -alpha / a0, a1: (-2 * Math.cos(w0)) / a0, a2: (1 - alpha) / a0 };
}

export const PREFILTER_ID = 'band-energy-prefilter-0';

/**
 * Diagnostics-only detector: speech-like if RMS > PREFILTER_MIN_DBFS and at
 * least PREFILTER_MIN_BAND_RATIO of the energy is in 85–3400 Hz. Filter state
 * carries across frames.
 */
export function createBandEnergyPrefilter(): VadEngine {
  const f = bandPass(PREFILTER_LOW_HZ, PREFILTER_HIGH_HZ, ANALYSIS_SAMPLE_RATE);
  const minEnergy = 10 ** (PREFILTER_MIN_DBFS / 10);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  return {
    id: PREFILTER_ID,
    primary: false,
    sampleRate: ANALYSIS_SAMPLE_RATE,
    frameSamples: VAD_FRAME_SAMPLES,
    process(frame) {
      if (frame.length !== VAD_FRAME_SAMPLES) {
        throw new DspInputError('BAD_FRAME', `VAD frame must have ${VAD_FRAME_SAMPLES} samples`);
      }
      let total = 0;
      let band = 0;
      for (const x of frame) {
        if (!Number.isFinite(x)) throw new DspInputError('NON_FINITE_INPUT', 'non-finite PCM sample');
        const y = f.b0 * x + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        total += x * x;
        band += y * y;
      }
      const meanEnergy = total / frame.length;
      const speech = meanEnergy > minEnergy && band / total >= PREFILTER_MIN_BAND_RATIO;
      return { speech, probability: null };
    },
    reset() {
      x1 = 0;
      x2 = 0;
      y1 = 0;
      y2 = 0;
    },
  };
}
