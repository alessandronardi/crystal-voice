// Music heuristic (SPEC §7.2 [H], ADR-0023: music is not the VAD's job).
// A useful frame carries a music cue when any of the three holds:
//   1. stable pitch: it lies in a window of MUSIC_STABLE_MIN_FRAMES consecutive
//      frames, all with a measured f0, whose f0 spread is at most
//      2·MUSIC_STABLE_CENTS (all within ±MUSIC_STABLE_CENTS of one centre);
//   2. sustained harmonic energy without a single pitch: it lies in a run of at
//      least MUSIC_HARMONIC_MIN_FRAMES consecutive useful, non-intonated frames
//      with spectral flatness ≤ MUSIC_HARMONIC_MAX_FLATNESS (tonal energy that
//      YIN cannot reduce to one f0, as between syllables over chords);
//   3. periodic flux: it lies in a window of MUSIC_FLUX_WINDOW_SECONDS whose
//      normalized flux autocorrelation peaks above MUSIC_FLUX_PERIODICITY at a
//      lag in [MUSIC_FLUX_MIN_LAG_SECONDS, MUSIC_FLUX_MAX_LAG_SECONDS].
// share = cue frames / useful frames; MIXED_AUDIO_UNCERTAIN when share > MUSIC_SHARE_THRESHOLD.
// The heuristic warns and lowers confidence; it never removes frames from the
// descriptors (SPEC §7.4 formulas unchanged).

import type { AcousticFrame } from './acoustic-frames.ts';
import {
  FRAME_HOP_SECONDS,
  MUSIC_FLUX_MAX_LAG_SECONDS,
  MUSIC_FLUX_MIN_LAG_SECONDS,
  MUSIC_FLUX_PERIODICITY,
  MUSIC_FLUX_WINDOW_SECONDS,
  MUSIC_HARMONIC_MAX_FLATNESS,
  MUSIC_HARMONIC_MIN_FRAMES,
  MUSIC_SHARE_THRESHOLD,
  MUSIC_STABLE_CENTS,
  MUSIC_STABLE_MIN_FRAMES,
} from './config.ts';
import { fluxScale, isIntonated, isUseful, normalizedFlux } from './descriptors.ts';

export interface MusicAssessment {
  /** Share of useful frames with at least one cue, in [0, 1]; 0 without useful frames. */
  share: number;
  /** Useful frames carrying each cue (a frame may carry several). */
  cueFrames: { stablePitch: number; harmonicUnpitched: number; periodicFlux: number };
  usefulFrames: number;
  mixedAudioUncertain: boolean;
}

function markStablePitch(frames: readonly AcousticFrame[], mark: Uint8Array): void {
  const cents = frames.map((f) => (f.f0Hz === null ? null : 1200 * Math.log2(f.f0Hz)));
  const w = MUSIC_STABLE_MIN_FRAMES;
  for (let i = 0; i + w <= frames.length; i++) {
    let lo = Infinity;
    let hi = -Infinity;
    let ok = true;
    for (let j = i; j < i + w; j++) {
      const c = cents[j];
      if (c === null || c === undefined) {
        ok = false;
        i = j; // no window containing j can qualify
        break;
      }
      if (c < lo) lo = c;
      if (c > hi) hi = c;
    }
    if (ok && hi - lo <= 2 * MUSIC_STABLE_CENTS) for (let j = i; j < i + w; j++) mark[j] = 1;
  }
}

function markHarmonicUnpitched(frames: readonly AcousticFrame[], mark: Uint8Array): void {
  const cand = frames.map(
    (f) => isUseful(f) && !isIntonated(f) && f.spectralFlatness !== null && f.spectralFlatness <= MUSIC_HARMONIC_MAX_FLATNESS,
  );
  for (let i = 0; i < frames.length; ) {
    if (!cand[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < frames.length && cand[j]) j++;
    if (j - i >= MUSIC_HARMONIC_MIN_FRAMES) for (let k = i; k < j; k++) mark[k] = 1;
    i = j;
  }
}

/** Largest normalized autocorrelation of x (mean removed) over the lag range; 0 when x is constant. */
export function peakAutocorrelation(x: ArrayLike<number>, minLag: number, maxLag: number): number {
  const n = x.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i] ?? 0;
  mean /= n || 1;
  let r0 = 0;
  for (let i = 0; i < n; i++) r0 += ((x[i] ?? 0) - mean) ** 2;
  if (!(r0 > 0)) return 0;
  let best = 0;
  for (let lag = minLag; lag <= Math.min(maxLag, n - 1); lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += ((x[i] ?? 0) - mean) * ((x[i + lag] ?? 0) - mean);
    if (s / r0 > best) best = s / r0;
  }
  return best;
}

function markPeriodicFlux(frames: readonly AcousticFrame[], mark: Uint8Array): void {
  const nu = normalizedFlux(frames, fluxScale(frames));
  const win = Math.round(MUSIC_FLUX_WINDOW_SECONDS / FRAME_HOP_SECONDS);
  const minLag = Math.round(MUSIC_FLUX_MIN_LAG_SECONDS / FRAME_HOP_SECONDS);
  const maxLag = Math.round(MUSIC_FLUX_MAX_LAG_SECONDS / FRAME_HOP_SECONDS);
  // Complete windows only, from the start: a partial tail is too short for the lag range.
  for (let start = 0; start + win <= frames.length; start += win) {
    if (peakAutocorrelation(nu.subarray(start, start + win), minLag, maxLag) > MUSIC_FLUX_PERIODICITY) {
      for (let k = start; k < start + win; k++) mark[k] = 1;
    }
  }
}

export function assessMusic(frames: readonly AcousticFrame[]): MusicAssessment {
  const stable = new Uint8Array(frames.length);
  const harmonic = new Uint8Array(frames.length);
  const periodic = new Uint8Array(frames.length);
  markStablePitch(frames, stable);
  markHarmonicUnpitched(frames, harmonic);
  markPeriodicFlux(frames, periodic);
  let useful = 0;
  let any = 0;
  const cueFrames = { stablePitch: 0, harmonicUnpitched: 0, periodicFlux: 0 };
  frames.forEach((f, i) => {
    if (!isUseful(f)) return;
    useful++;
    if (stable[i] === 1) cueFrames.stablePitch++;
    if (harmonic[i] === 1) cueFrames.harmonicUnpitched++;
    if (periodic[i] === 1) cueFrames.periodicFlux++;
    if (stable[i] === 1 || harmonic[i] === 1 || periodic[i] === 1) any++;
  });
  const share = useful > 0 ? any / useful : 0;
  return { share, cueFrames, usefulFrames: useful, mixedAudioUncertain: share > MUSIC_SHARE_THRESHOLD };
}
