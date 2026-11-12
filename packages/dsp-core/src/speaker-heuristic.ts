// Several-voices heuristic (SPEC §7.2 [H] D4, decision D-T, ADR-0024).
// It flags; it never identifies anyone (AGENTS.md R3) and never lowers confidence:
// the UI asks the user (SPEC §7.2).
//
// Pitch criterion, on log2(f0) of the intonated frames, with at least
// SPEAKER_MIN_SECONDS of them:
//   bimodality coefficient b = (g² + 1) / (k + 3(n−1)²/((n−2)(n−3)))   (sample skewness g,
//   sample excess kurtosis k, both bias-corrected) > SPEAKER_BIMODALITY, AND
//   the two groups of a single-threshold split (minimum within-group sum of
//   squares) have medians at least SPEAKER_MIN_GAP_SEMITONES apart, AND the
//   smaller group holds at least SPEAKER_MIN_GROUP_SHARE of the frames.
//   (D-T: a single synthetic voice already has b ≈ 0.66, so b alone fires on it.)
// Centroid criterion: the useful frames, in order, are cut into blocks of
//   SPEAKER_BLOCK_SECONDS; with at least SPEAKER_MIN_TRANSITIONS transitions,
//   a share ≥ SPEAKER_MIN_JUMP_SHARE of them change the block median of
//   log2(centroid) by more than SPEAKER_CENTROID_JUMP_OCTAVES.
// MULTI_SPEAKER_SUSPECTED = pitch criterion OR centroid criterion.

import type { AcousticFrame } from './acoustic-frames.ts';
import {
  FRAME_HOP_SECONDS,
  SPEAKER_BIMODALITY,
  SPEAKER_BLOCK_SECONDS,
  SPEAKER_CENTROID_JUMP_OCTAVES,
  SPEAKER_MIN_GAP_SEMITONES,
  SPEAKER_MIN_GROUP_SHARE,
  SPEAKER_MIN_JUMP_SHARE,
  SPEAKER_MIN_SECONDS,
  SPEAKER_MIN_TRANSITIONS,
} from './config.ts';
import { isIntonated, isUseful } from './descriptors.ts';
import { median } from './stats.ts';

export interface SpeakerAssessment {
  /** null below SPEAKER_MIN_SECONDS of intonated frames or on a constant pitch. */
  bimodality: number | null;
  /** Distance of the two group medians, semitones; null when not measured. */
  gapSemitones: number | null;
  /** Share of the smaller group, null when not measured. */
  minorGroupShare: number | null;
  pitchCriterion: boolean;
  centroidTransitions: number;
  centroidJumps: number;
  centroidCriterion: boolean;
  multiSpeakerSuspected: boolean;
}

/** Sample bimodality coefficient; null for n < 4 or zero variance. */
export function bimodalityCoefficient(values: ArrayLike<number>): number | null {
  const n = values.length;
  if (n < 4) return null;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += values[i] ?? 0;
  mean /= n;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (let i = 0; i < n; i++) {
    const d = (values[i] ?? 0) - mean;
    const d2 = d * d;
    m2 += d2;
    m3 += d2 * d;
    m4 += d2 * d2;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;
  if (!(m2 > 0)) return null;
  const g = m3 / (m2 * Math.sqrt(m2));
  const k = m4 / (m2 * m2) - 3;
  const skew = (Math.sqrt(n * (n - 1)) / (n - 2)) * g;
  const kurt = (((n + 1) * k + 6) * (n - 1)) / ((n - 2) * (n - 3));
  const b = (skew * skew + 1) / (kurt + (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3)));
  return Number.isFinite(b) ? b : null;
}

/** Split of sorted values into [0, s) and [s, n) minimizing the within-group sum of squares (ties: smallest s). */
export function twoGroupSplit(sorted: Float64Array): number {
  const n = sorted.length;
  const prefix = new Float64Array(n + 1);
  const prefixSq = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const v = sorted[i] ?? 0;
    prefix[i + 1] = (prefix[i] ?? 0) + v;
    prefixSq[i + 1] = (prefixSq[i] ?? 0) + v * v;
  }
  const ss = (a: number, b: number): number => {
    const s = (prefix[b] ?? 0) - (prefix[a] ?? 0);
    return (prefixSq[b] ?? 0) - (prefixSq[a] ?? 0) - (s * s) / (b - a);
  };
  let best = 1;
  let bestValue = Infinity;
  for (let s = 1; s < n; s++) {
    const v = ss(0, s) + ss(s, n);
    if (v < bestValue) {
      bestValue = v;
      best = s;
    }
  }
  return best;
}

export function assessSpeakers(frames: readonly AcousticFrame[]): SpeakerAssessment {
  const log2f0 = Float64Array.from(frames.filter(isIntonated), (f) => Math.log2(f.f0Hz ?? 1)).sort();
  let bimodality: number | null = null;
  let gapSemitones: number | null = null;
  let minorGroupShare: number | null = null;
  if (log2f0.length * FRAME_HOP_SECONDS >= SPEAKER_MIN_SECONDS) {
    bimodality = bimodalityCoefficient(log2f0);
    if (bimodality !== null) {
      const s = twoGroupSplit(log2f0);
      const low = median(log2f0.subarray(0, s));
      const high = median(log2f0.subarray(s));
      if (low !== null && high !== null) {
        gapSemitones = 12 * (high - low);
        minorGroupShare = Math.min(s, log2f0.length - s) / log2f0.length;
      }
    }
  }
  const pitchCriterion =
    bimodality !== null &&
    bimodality > SPEAKER_BIMODALITY &&
    gapSemitones !== null &&
    gapSemitones >= SPEAKER_MIN_GAP_SEMITONES &&
    minorGroupShare !== null &&
    minorGroupShare >= SPEAKER_MIN_GROUP_SHARE;

  const useful = frames.filter(isUseful);
  const block = Math.round(SPEAKER_BLOCK_SECONDS / FRAME_HOP_SECONDS);
  const medians: number[] = [];
  for (let i = 0; i + block <= useful.length; i += block) {
    const m = median(
      useful
        .slice(i, i + block)
        .filter((f) => f.spectralCentroidHz !== null && f.spectralCentroidHz > 0)
        .map((f) => Math.log2(f.spectralCentroidHz ?? 1)),
    );
    if (m !== null) medians.push(m);
  }
  const transitions = Math.max(0, medians.length - 1);
  let jumps = 0;
  for (let i = 1; i < medians.length; i++) if (Math.abs((medians[i] ?? 0) - (medians[i - 1] ?? 0)) > SPEAKER_CENTROID_JUMP_OCTAVES) jumps++;
  const centroidCriterion = transitions >= SPEAKER_MIN_TRANSITIONS && jumps / transitions >= SPEAKER_MIN_JUMP_SHARE;

  return {
    bimodality,
    gapSemitones,
    minorGroupShare,
    pitchCriterion,
    centroidTransitions: transitions,
    centroidJumps: jumps,
    centroidCriterion,
    multiSpeakerSuspected: pitchCriterion || centroidCriterion,
  };
}
