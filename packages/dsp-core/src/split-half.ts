// Split-half division of the valid speech (SPEC §8, ADR-0008, ADR-0026).
//
// Valid speech = the useful frames (SPEC §7.4; qualitySummary counts the same).
// For the m-th whole second of valid speech, the prefix is the frame sequence
// up to and including the (100·m)-th useful frame. Its useful frames, in order,
// form blocks of SPLIT_HALF_BLOCK_SECONDS: even blocks → half A, odd → half B.
// Each half is measured with the same formulas and minimums as the whole
// (SPEC §7.4): a half below a minimum has a null measure, never 0 (R13).
// Onsets are detected once on the prefix and each counts in the half of its
// block, so the 80 ms distance is never applied across a glued seam.

import type { AcousticFrame } from './acoustic-frames.ts';
import { FRAME_HOP_SECONDS } from './config.ts';
import { descriptorsWithOnsets, detectOnsets, isUseful, type Descriptors } from './descriptors.ts';
import { assessSpeakers, type SpeakerAssessment } from './speaker-heuristic.ts';
import { SPLIT_HALF_BLOCK_SECONDS } from './stop-config.ts';

/** Useful frames per block: 1 s / 10 ms = 100. */
export const SPLIT_HALF_BLOCK_FRAMES = Math.round(SPLIT_HALF_BLOCK_SECONDS / FRAME_HOP_SECONDS);

export interface SplitHalf {
  /** Whole seconds of valid speech evaluated. */
  seconds: number;
  /** Frames of the prefix (useful or not). */
  prefixFrames: number;
  /** Descriptors of the whole prefix: its missing keys are condition 2 of SPEC §8. */
  whole: Descriptors;
  /** Several-voices heuristic of the prefix (SPEC §8 condition 2). */
  speakers: SpeakerAssessment;
  a: Descriptors;
  b: Descriptors;
}

/** Whole seconds of valid speech in these frames. */
export function validSpeechSeconds(frames: readonly AcousticFrame[]): number {
  let useful = 0;
  for (const f of frames) if (isUseful(f)) useful++;
  return Math.floor(useful / SPLIT_HALF_BLOCK_FRAMES);
}

/** The split-half at `seconds` of valid speech; null if the frames do not reach it (or `seconds` is not a positive integer). */
export function splitHalfAt(frames: readonly AcousticFrame[], seconds: number): SplitHalf | null {
  if (!Number.isInteger(seconds) || seconds <= 0) return null;
  const target = seconds * SPLIT_HALF_BLOCK_FRAMES;
  const a: AcousticFrame[] = [];
  const b: AcousticFrame[] = [];
  /** Block of each frame index of the prefix, for useful frames; -1 otherwise. */
  const blockOf: number[] = [];
  let useful = 0;
  let end = -1;
  for (let i = 0; i < frames.length && useful < target; i++) {
    const f = frames[i];
    if (f === undefined) break;
    if (!isUseful(f)) {
      blockOf.push(-1);
      continue;
    }
    const block = Math.floor(useful / SPLIT_HALF_BLOCK_FRAMES);
    blockOf.push(block);
    (block % 2 === 0 ? a : b).push(f);
    useful++;
    end = i;
  }
  if (useful < target) return null;
  const prefix = frames.slice(0, end + 1);
  const onsets = detectOnsets(prefix);
  let onsetsA = 0;
  let onsetsB = 0;
  for (const i of onsets) {
    const block = blockOf[i] ?? -1;
    if (block < 0) continue; // onsets are useful frames; kept for safety
    if (block % 2 === 0) onsetsA++;
    else onsetsB++;
  }
  return {
    seconds,
    prefixFrames: prefix.length,
    whole: descriptorsWithOnsets(prefix, onsets.length),
    speakers: assessSpeakers(prefix),
    a: descriptorsWithOnsets(a, onsetsA),
    b: descriptorsWithOnsets(b, onsetsB),
  };
}
