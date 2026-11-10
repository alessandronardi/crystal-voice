// Pitch metrics for the offline bench (I-05a, BENCHMARK_PROTOCOL M2).
//
// Alignment: a YIN frame is compared with the true f0 sample of the fixture's
// f0Track nearest to its centre. Only frames voiced in BOTH are compared;
// missed and false voicing are reported separately, never mixed into M2.
// Octave error: |log2(estimate / truth)| > 0.5 (more than a tritone off).

import type { PitchTrack } from '@voicecrystal/dsp-core';
import { INTONATED_MAX_HZ, INTONATED_MIN_CONFIDENCE, INTONATED_MIN_HZ, median, quantile } from '@voicecrystal/dsp-core';

export const OCTAVE_ERROR_LOG2 = 0.5;

export interface PitchTruth {
  sampleRate: number;
  f0Track: { hopSamples: number; valuesHz: (number | null)[] } | null;
  toneHz: number | null;
  /** expected.f0MedianHz of the fixture, if any. */
  f0MedianHz: number | null;
}

export interface TruthComparison {
  framesCompared: number;
  medianRelError: number | null;
  p90RelError: number | null;
  octaveErrorRate: number | null;
  /** Truth voiced, estimate null. */
  missedVoicedRate: number | null;
  /** Truth unvoiced, estimate present. */
  falseVoicedRate: number | null;
  /** Median of the TRUE f0 on missed frames: shows whether misses depend on f0 (selection bias). */
  missedMedianTrueF0Hz: number | null;
  /** Relative error of the estimated median f0 (intonated frames) against expected.f0MedianHz. */
  medianF0RelError: number | null;
}

export interface PitchFixtureMetrics {
  framesTotal: number;
  framesWithF0: number;
  /** Median f0 over intonated frames (SPEC §7.4: 60–500 Hz, confidence ≥ 0.8). */
  medianF0Hz: number | null;
  truth: TruthComparison | null;
  /** Relative error of the median f0 for pure tones. */
  toneRelError: number | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Extracts the pitch ground truth from a fixture meta file (untrusted JSON: validated). */
export function parsePitchTruth(metaText: string): PitchTruth | null {
  let meta: unknown;
  try {
    meta = JSON.parse(metaText);
  } catch {
    return null;
  }
  if (!isRecord(meta) || typeof meta['sampleRate'] !== 'number' || !isRecord(meta['expected'])) return null;
  const expected = meta['expected'];
  let f0Track: PitchTruth['f0Track'] = null;
  const track = expected['f0Track'];
  if (isRecord(track) && typeof track['hopSamples'] === 'number' && Array.isArray(track['valuesHz'])) {
    const values: (number | null)[] = [];
    for (const v of track['valuesHz'] as unknown[]) {
      if (v !== null && typeof v !== 'number') return null;
      values.push(v);
    }
    f0Track = { hopSamples: track['hopSamples'], valuesHz: values };
  }
  const tone = expected['f0Hz'];
  const f0Median = expected['f0MedianHz'];
  return {
    sampleRate: meta['sampleRate'],
    f0Track,
    toneHz: typeof tone === 'number' ? tone : null,
    f0MedianHz: typeof f0Median === 'number' ? f0Median : null,
  };
}

/** Per-frame relative errors on frames voiced in both, for pooling across fixtures. */
export function frameErrors(track: PitchTrack, truth: PitchTruth): {
  errors: number[];
  octave: number;
  missed: number;
  missedTrueF0: number[];
  falseVoiced: number;
  truthVoiced: number;
  truthUnvoiced: number;
} {
  const errors: number[] = [];
  let octave = 0;
  let missed = 0;
  const missedTrueF0: number[] = [];
  let falseVoiced = 0;
  let truthVoiced = 0;
  let truthUnvoiced = 0;
  const t = truth.f0Track;
  if (t === null) return { errors, octave, missed, missedTrueF0, falseVoiced, truthVoiced, truthUnvoiced };
  for (const fr of track.frames) {
    const index = Math.round((fr.centreSeconds * truth.sampleRate) / t.hopSamples);
    const value = t.valuesHz[index];
    if (value === undefined) continue;
    if (value === null) {
      truthUnvoiced++;
      if (fr.f0Hz !== null) falseVoiced++;
      continue;
    }
    truthVoiced++;
    if (fr.f0Hz === null) {
      missed++;
      missedTrueF0.push(value);
      continue;
    }
    errors.push(Math.abs(fr.f0Hz / value - 1));
    if (Math.abs(Math.log2(fr.f0Hz / value)) > OCTAVE_ERROR_LOG2) octave++;
  }
  return { errors, octave, missed, missedTrueF0, falseVoiced, truthVoiced, truthUnvoiced };
}

const rate = (n: number, d: number): number | null => (d > 0 ? n / d : null);

export function compareWithTruth(track: PitchTrack, truth: PitchTruth, medianF0Hz: number | null): TruthComparison | null {
  if (truth.f0Track === null) return null;
  const e = frameErrors(track, truth);
  return {
    framesCompared: e.errors.length,
    medianRelError: median(e.errors),
    p90RelError: quantile(e.errors, 0.9),
    octaveErrorRate: rate(e.octave, e.errors.length),
    missedVoicedRate: rate(e.missed, e.truthVoiced),
    falseVoicedRate: rate(e.falseVoiced, e.truthUnvoiced),
    missedMedianTrueF0Hz: median(e.missedTrueF0),
    medianF0RelError: medianF0Hz !== null && truth.f0MedianHz !== null ? Math.abs(medianF0Hz / truth.f0MedianHz - 1) : null,
  };
}

export function pitchFixtureMetrics(track: PitchTrack, truth: PitchTruth | null): PitchFixtureMetrics {
  const intonated = track.frames
    .filter(
      (f) =>
        f.f0Hz !== null &&
        f.f0Hz >= INTONATED_MIN_HZ &&
        f.f0Hz <= INTONATED_MAX_HZ &&
        (f.pitchConfidence ?? 0) >= INTONATED_MIN_CONFIDENCE,
    )
    .map((f) => f.f0Hz ?? 0);
  const medianF0Hz = median(intonated);
  return {
    framesTotal: track.frames.length,
    framesWithF0: track.frames.filter((f) => f.f0Hz !== null).length,
    medianF0Hz,
    truth: truth === null ? null : compareWithTruth(track, truth, medianF0Hz),
    toneRelError: truth?.toneHz != null && medianF0Hz !== null ? Math.abs(medianF0Hz / truth.toneHz - 1) : null,
  };
}

/** Difference in cents between two median f0 values; null if either is missing. */
export const centsBetween = (a: number | null, b: number | null): number | null =>
  a === null || b === null ? null : 1200 * Math.log2(b / a);
