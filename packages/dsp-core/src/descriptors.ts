// Six descriptors EXPERIMENTAL v0 (SPEC §7.4). Frame classes:
//   useful    = vadSpeech, not clipped, rmsDbfs measurable and > USEFUL_MIN_DBFS
//   intonated = useful, f0 in [INTONATED_MIN_HZ, INTONATED_MAX_HZ], pitchConfidence ≥ INTONATED_MIN_CONFIDENCE
// Raw measures x_i (null below the minimum amount, never 0 — R13):
//   p1 median log2(f0) · p2 IQR 12·log2(f0) · p4 median (1 − periodicity)   on intonated frames
//   p3 P90 − P10 of rmsDbfs                                                on intonated frames (D-V)
//   p5 median log2(centroid)                                               on useful frames
//   p6 onsets per second of intonated frames (D-V)
// D-V (ADR-0024, accepted 2026-11-12, overrides SPEC §7.4 here): SPEC §7.4 computes p3 on the useful frames and p6
// per second of useful frames. Their edges move with the level (VAD hangover,
// floor), and the ±6 dB invariance failed by up to 7 points (p3). Measured in
// I-06a: on the intonated frames the change is 0.0 points. Minimums: p3 needs
// MIN_USEFUL_SECONDS of useful and MIN_INTONATED_SECONDS of intonated frames;
// p6 needs MIN_ONSETS onsets and MIN_INTONATED_SECONDS of intonated frames.
// Onsets: useful frames whose flux, divided by the median band magnitude of
// the useful frames (independent of gain), reaches ONSET_FLUX_THRESHOLD; the
// largest are kept first, at least ONSET_MIN_DISTANCE_SECONDS apart (ties:
// earlier frame first).

import type { DescriptorKey } from '@voicecrystal/contracts';
import type { AcousticFrame } from './acoustic-frames.ts';
import {
  FRAME_HOP_SECONDS,
  INTONATED_MAX_HZ,
  INTONATED_MIN_CONFIDENCE,
  INTONATED_MIN_HZ,
  MIN_INTONATED_SECONDS,
  MIN_ONSETS,
  MIN_USEFUL_SECONDS,
  ONSET_FLUX_THRESHOLD,
  ONSET_MIN_DISTANCE_SECONDS,
  USEFUL_MIN_DBFS,
} from './config.ts';
import { iqr, median, quantiles } from './stats.ts';

export type RawMeasures = readonly [number | null, number | null, number | null, number | null, number | null, number | null];

export function isUseful(f: AcousticFrame): boolean {
  return f.vadSpeech && !f.clipped && f.rmsDbfs !== null && f.rmsDbfs > USEFUL_MIN_DBFS;
}

export function isIntonated(f: AcousticFrame): boolean {
  return (
    isUseful(f) &&
    f.f0Hz !== null &&
    f.f0Hz >= INTONATED_MIN_HZ &&
    f.f0Hz <= INTONATED_MAX_HZ &&
    f.pitchConfidence !== null &&
    f.pitchConfidence >= INTONATED_MIN_CONFIDENCE
  );
}

/** Frames that the minimum distance spans: 80 ms / 10 ms = 8. */
const ONSET_MIN_FRAMES = Math.round(ONSET_MIN_DISTANCE_SECONDS / FRAME_HOP_SECONDS);

/** The flux scale: median band magnitude of the useful frames; null without a positive one. */
export function fluxScale(frames: readonly AcousticFrame[]): number | null {
  const m = median(frames.filter(isUseful).map((f) => f.bandMagnitude));
  return m !== null && m > 0 ? m : null;
}

/** Normalized flux per frame (0 where the flux is not measurable or the frame is not useful). */
export function normalizedFlux(frames: readonly AcousticFrame[], scale: number | null): Float64Array {
  const out = new Float64Array(frames.length);
  if (scale === null) return out;
  frames.forEach((f, i) => {
    if (isUseful(f) && f.spectralFlux !== null) out[i] = f.spectralFlux / scale;
  });
  return out;
}

/** Frame indices of the onsets, ascending. */
export function detectOnsets(frames: readonly AcousticFrame[]): number[] {
  const nu = normalizedFlux(frames, fluxScale(frames));
  const candidates: number[] = [];
  nu.forEach((v, i) => {
    if (v >= ONSET_FLUX_THRESHOLD) candidates.push(i);
  });
  candidates.sort((a, b) => (nu[b] ?? 0) - (nu[a] ?? 0) || a - b);
  const blocked = new Uint8Array(frames.length);
  const onsets: number[] = [];
  for (const c of candidates) {
    if (blocked[c] === 1) continue;
    onsets.push(c);
    for (let j = Math.max(0, c - ONSET_MIN_FRAMES + 1); j <= Math.min(frames.length - 1, c + ONSET_MIN_FRAMES - 1); j++) blocked[j] = 1;
  }
  return onsets.sort((a, b) => a - b);
}

export interface DescriptorAmounts {
  usefulFrames: number;
  intonatedFrames: number;
  onsets: number;
}

export interface Descriptors {
  raw: RawMeasures;
  amounts: DescriptorAmounts;
  /** Keys whose measure is below its minimum amount (null). */
  missing: DescriptorKey[];
}

const KEYS: readonly DescriptorKey[] = ['p1_pitch', 'p2_intonation', 'p3_dynamics', 'p4_roughness', 'p5_brightness', 'p6_rhythm'];

export function computeDescriptors(frames: readonly AcousticFrame[]): Descriptors {
  return descriptorsWithOnsets(frames, detectOnsets(frames).length);
}

/**
 * The six measures of a frame set whose onsets were counted elsewhere (I-07:
 * each split-half takes the onsets detected on the whole prefix, so that the
 * 80 ms distance is never applied across the seam of two glued blocks).
 */
export function descriptorsWithOnsets(frames: readonly AcousticFrame[], onsetCount: number): Descriptors {
  const useful = frames.filter(isUseful);
  const intonated = useful.filter(isIntonated);
  const usefulSeconds = useful.length * FRAME_HOP_SECONDS;
  const intonatedSeconds = intonated.length * FRAME_HOP_SECONDS;
  const enoughIntonated = intonatedSeconds >= MIN_INTONATED_SECONDS;
  const enoughUseful = usefulSeconds >= MIN_USEFUL_SECONDS;

  const log2f0 = intonated.map((f) => Math.log2(f.f0Hz ?? 1));
  const p1 = enoughIntonated ? median(log2f0) : null;
  const p2 = enoughIntonated ? iqr(log2f0.map((v) => 12 * v)) : null;
  let p3: number | null = null;
  if (enoughUseful && enoughIntonated) {
    const [p10, p90] = quantiles(intonated.map((f) => f.rmsDbfs ?? 0), [0.1, 0.9]);
    p3 = p10 === null || p10 === undefined || p90 === null || p90 === undefined ? null : p90 - p10;
  }
  const aperiodicity = intonated.filter((f) => f.periodicity !== null).map((f) => 1 - (f.periodicity ?? 0));
  const p4 = enoughIntonated ? median(aperiodicity) : null;
  const centroids = useful.filter((f) => f.spectralCentroidHz !== null && f.spectralCentroidHz > 0).map((f) => Math.log2(f.spectralCentroidHz ?? 1));
  const p5 = enoughUseful ? median(centroids) : null;
  const p6 = onsetCount >= MIN_ONSETS && enoughIntonated ? onsetCount / intonatedSeconds : null;

  const raw: RawMeasures = [p1, p2, p3, p4, p5, p6];
  return {
    raw,
    amounts: { usefulFrames: useful.length, intonatedFrames: intonated.length, onsets: onsetCount },
    missing: KEYS.filter((_, i) => raw[i] === null),
  };
}
