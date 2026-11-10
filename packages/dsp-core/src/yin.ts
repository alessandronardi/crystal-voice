// YIN pitch estimator (de Cheveigné & Kawahara, 2002), SPEC §7.3–§7.4.
// Range 60–1100 Hz (ADR-0017): singing is measured; the descriptors keep only
// "intonated" frames in 60–500 Hz (INTONATED_*), applied downstream in I-06.
//
// On one PITCH_FRAME_SAMPLES frame at ANALYSIS_SAMPLE_RATE:
//   d(τ)  = Σ_{j<W} (x[j] − x[j+τ])²,  W = frame − τmax − 2
//   d′(τ) = d(τ)·τ / Σ_{1≤k≤τ} d(k),   d′(0) = 1
// The search starts below the range, at τ for YIN_SEARCH_MAX_HZ: the first τ
// with d′ < YIN_THRESHOLD is moved to the bottom of its dip and refined by
// parabolic interpolation. The estimate is null when the dip lies outside
// [τmin, τmax] or the refined f0 leaves [F0_MIN_HZ, F0_MAX_HZ] (± F0_RANGE_TOLERANCE),
// so a pitch outside the range is never folded back into it as an octave error.
//   pitchConfidence = 1 − d′(τ̂), clamped to [0, 1]; null without an estimate
//   periodicity     = 1 − min d′ over [τmin, τmax], clamped; null on silence
// (SPEC §7.4: roughness p4 is the median of 1 − periodicity.)

import {
  ANALYSIS_SAMPLE_RATE,
  F0_MAX_HZ,
  F0_MIN_HZ,
  F0_RANGE_TOLERANCE,
  PITCH_FRAME_SAMPLES,
  YIN_SEARCH_MAX_HZ,
  YIN_THRESHOLD,
} from './config.ts';
import { DspInputError } from './errors.ts';

export interface YinResult {
  f0Hz: number | null;
  pitchConfidence: number | null;
  periodicity: number | null;
}

const TAU_MIN = Math.floor(ANALYSIS_SAMPLE_RATE / F0_MAX_HZ);
const TAU_MAX = Math.ceil(ANALYSIS_SAMPLE_RATE / F0_MIN_HZ);
const TAU_SEARCH = Math.floor(ANALYSIS_SAMPLE_RATE / YIN_SEARCH_MAX_HZ);
const WINDOW = PITCH_FRAME_SAMPLES - TAU_MAX - 2;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export function yinFrame(frame: Float32Array, sampleRate: number): YinResult {
  if (sampleRate !== ANALYSIS_SAMPLE_RATE) {
    throw new DspInputError('BAD_SAMPLE_RATE', `YIN runs at ${ANALYSIS_SAMPLE_RATE} Hz, got ${sampleRate}`);
  }
  if (frame.length !== PITCH_FRAME_SAMPLES) {
    throw new DspInputError('BAD_FRAME', `YIN frame must have ${PITCH_FRAME_SAMPLES} samples`);
  }
  let energy = 0;
  for (const v of frame) {
    if (!Number.isFinite(v)) throw new DspInputError('NON_FINITE_INPUT', 'non-finite PCM sample');
    energy += v * v;
  }
  if (energy === 0) return { f0Hz: null, pitchConfidence: null, periodicity: null };

  // Difference function up to τmax + 1 (the extra lag serves the interpolation).
  const cmnd = new Float64Array(TAU_MAX + 2);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= TAU_MAX + 1; tau++) {
    let d = 0;
    for (let j = 0; j < WINDOW; j++) {
      const diff = (frame[j] ?? 0) - (frame[j + tau] ?? 0);
      d += diff * diff;
    }
    running += d;
    cmnd[tau] = running > 0 ? (d * tau) / running : 1;
  }

  let minValue = Infinity;
  for (let tau = TAU_MIN; tau <= TAU_MAX; tau++) minValue = Math.min(minValue, cmnd[tau] ?? 1);
  const periodicity = clamp01(1 - minValue);

  let best = -1;
  for (let tau = TAU_SEARCH; tau <= TAU_MAX; tau++) {
    if ((cmnd[tau] ?? 1) < YIN_THRESHOLD) {
      best = tau;
      while (best + 1 <= TAU_MAX + 1 && (cmnd[best + 1] ?? 1) < (cmnd[best] ?? 1)) best++;
      break;
    }
  }
  // No dip, a dip below τmin (pitch above the range), or a dip still descending
  // past τmax (pitch below the range): not measurable.
  if (best < TAU_MIN || best > TAU_MAX) return { f0Hz: null, pitchConfidence: null, periodicity };

  // Parabolic interpolation on d′ around the dip.
  const a = cmnd[best - 1] ?? 1;
  const b = cmnd[best] ?? 1;
  const c = cmnd[best + 1] ?? 1;
  const denom = a - 2 * b + c;
  let shift = denom > 0 ? (0.5 * (a - c)) / denom : 0;
  if (shift > 0.5) shift = 0.5;
  if (shift < -0.5) shift = -0.5;
  const tauHat = best + shift;
  const f0Hz = ANALYSIS_SAMPLE_RATE / tauHat;
  if (f0Hz > F0_MAX_HZ * (1 + F0_RANGE_TOLERANCE) || f0Hz < F0_MIN_HZ * (1 - F0_RANGE_TOLERANCE)) {
    return { f0Hz: null, pitchConfidence: null, periodicity };
  }
  return {
    f0Hz,
    pitchConfidence: clamp01(1 - b),
    periodicity,
  };
}
