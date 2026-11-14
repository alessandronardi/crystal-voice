// Split-half stopping rule (SPEC §8, ADR-0008, ADR-0026). Pure: it runs in the
// offscreen dsp-worker during a tab or microphone session and in Node (tests,
// fixture simulation). It never sees samples, only acoustic frames.
//
// One evaluation per whole second of valid speech, from SPEC_MIN (8 s) on.
// An evaluation passes when, for its prefix:
//   1. valid speech ≥ 8 s;
//   2. the six descriptors reach their minimum (SPEC §7.4) and no
//      several-voices warning waits for an answer. Before I-13 nobody can
//      answer: once the warning appears on a prefix, it stays pending for the
//      rest of the session and no later evaluation passes (review H-1);
//   3. both halves measure all six descriptors and
//      s_t = max_i |a_i − b_i| ≤ SPLIT_HALF_TAU_POINTS, in points of mapping-0.
// Converged after SPLIT_HALF_CONSECUTIVE passing evaluations in a row; a
// failing one resets the run. observe() catches up: from the frames of one
// analysis it evaluates every second reached since the previous evaluation,
// so how many evaluations there are never depends on the machine's speed.
import { MAPPING_0, mapToPoint, seedFromRaw, type MappingTable } from '@voicecrystal/calibration';
import { DESCRIPTOR_KEYS, type CrystalSeed, type DescriptorKey, type SplitHalfBlock } from '@voicecrystal/contracts';
import {
  computeDescriptors,
  createWebRtcVad,
  extractAcousticFrames,
  isUseful,
  SPLIT_HALF_BLOCK_FRAMES,
  SPLIT_HALF_BLOCK_SECONDS,
  SPLIT_HALF_CONSECUTIVE,
  SPLIT_HALF_TAU_POINTS,
  splitHalfAt,
  validSpeechSeconds,
  type AcousticFrame,
  type FvadModule,
  type RawMeasures,
  type SplitHalf,
} from '@voicecrystal/dsp-core';
import { CAPTURE_LIMITS } from '../offscreen/capture-machine.ts';

/** First second evaluated: the SPEC §8 minimum of valid speech. */
export const FIRST_EVALUATED_SECOND = Math.ceil(CAPTURE_LIMITS.minValidSpeechMs / 1000);

/** What one evaluation looks at; built from a SplitHalf, or by hand in tests. */
export interface SplitHalfInput {
  seconds: number;
  a: RawMeasures;
  b: RawMeasures;
  /** Descriptor keys of the whole prefix below their minimum. */
  missingWhole: readonly DescriptorKey[];
  multiSpeakerSuspected: boolean;
}

/** Why an evaluation did not pass (the contract's SplitHalfBlock), null when it passed. */
export type SplitHalfOutcome = SplitHalfBlock | null;

export interface SplitHalfEvaluation {
  seconds: number;
  /** |a_i − b_i| in points, null when a half cannot measure it. */
  differences: readonly (number | null)[];
  /** max of the differences; null when any is null. */
  s: number | null;
  passed: boolean;
  /** Why it did not pass (the first condition that failed); null when it passed. */
  blockedBy: SplitHalfOutcome;
  /** Passing evaluations in a row, this one included. */
  consecutive: number;
}

export function inputOf(split: SplitHalf): SplitHalfInput {
  return {
    seconds: split.seconds,
    a: split.a.raw,
    b: split.b.raw,
    missingWhole: split.whole.missing,
    multiSpeakerSuspected: split.speakers.multiSpeakerSuspected,
  };
}

/** One evaluation, without the run (consecutive is filled in by the monitor). */
export function evaluateSplitHalf(input: SplitHalfInput, table: MappingTable = MAPPING_0): Omit<SplitHalfEvaluation, 'consecutive'> {
  const differences = DESCRIPTOR_KEYS.map((key, i) => {
    const a = input.a[i] ?? null;
    const b = input.b[i] ?? null;
    if (a === null || b === null) return null;
    const parameter = table.parameters[key];
    return Math.abs(mapToPoint(parameter, a) - mapToPoint(parameter, b));
  });
  const s = differences.some((d) => d === null) ? null : Math.max(...differences.map((d) => d ?? 0));
  const blockedBy: SplitHalfOutcome =
    input.seconds * 1000 < CAPTURE_LIMITS.minValidSpeechMs
      ? 'TOO_SHORT'
      : input.missingWhole.length > 0
        ? 'MISSING_DESCRIPTOR'
        : input.multiSpeakerSuspected
          ? 'MULTI_SPEAKER'
          : s === null
            ? 'HALF_INCOMPLETE'
            : s > SPLIT_HALF_TAU_POINTS
              ? 'UNSTABLE'
              : null;
  return { seconds: input.seconds, differences, s, passed: blockedBy === null, blockedBy };
}

export interface SplitHalfProgress {
  /** Valid speech of the analysed prefix, ms (useful 10 ms frames). */
  validSpeechMs: number;
  evaluations: number;
  last: SplitHalfEvaluation | null;
  converged: boolean;
  /**
   * I-13a: the seed of the whole prefix with the current estimates, for the
   * growing germ (SPEC §9 provisionalSeed, §13). Null until all six measures
   * reach their minimum. Display only: never stored, never the result.
   */
  provisionalSeed: CrystalSeed | null;
}

export class SplitHalfMonitor {
  private lastSeconds = FIRST_EVALUATED_SECOND - 1;
  private run = 0;
  private count = 0;
  private latest: SplitHalfEvaluation | null = null;
  private done = false;
  /** A several-voices warning appeared: pending until an answer (I-13), so every later evaluation is blocked. */
  private multiSpeakerPending = false;
  /** Review M-6: the germ's seed is recomputed only when the valid speech gains a whole second. */
  private seedSeconds = -1;
  private seed: CrystalSeed | null = null;

  private readonly table: MappingTable;

  constructor(table: MappingTable = MAPPING_0) {
    this.table = table;
  }

  get converged(): boolean {
    return this.done;
  }

  get evaluations(): number {
    return this.count;
  }

  get last(): SplitHalfEvaluation | null {
    return this.latest;
  }

  /**
   * Feeds one evaluation. Seconds must follow each other (lastSeconds + 1):
   * anything else is refused and returns null, so a run can never skip one.
   * Nothing changes after convergence.
   */
  push(input: SplitHalfInput): SplitHalfEvaluation | null {
    if (this.done || input.seconds !== this.lastSeconds + 1) return null;
    this.lastSeconds = input.seconds;
    if (input.multiSpeakerSuspected) this.multiSpeakerPending = true;
    const e = evaluateSplitHalf({ ...input, multiSpeakerSuspected: this.multiSpeakerPending }, this.table);
    this.run = e.passed ? this.run + 1 : 0;
    this.count++;
    this.latest = { ...e, consecutive: this.run };
    if (this.run >= SPLIT_HALF_CONSECUTIVE) this.done = true;
    return this.latest;
  }

  private provisional(frames: readonly AcousticFrame[], reached: number): CrystalSeed | null {
    if (reached !== this.seedSeconds) {
      this.seedSeconds = reached;
      this.seed = provisionalSeedOf(frames, this.table);
    }
    return this.seed;
  }

  /**
   * The frames of one analysis of the audio so far: evaluates, in order,
   * every whole second of valid speech reached since the last evaluation,
   * and stops at convergence.
   */
  observe(frames: readonly AcousticFrame[]): SplitHalfProgress {
    const reached = validSpeechSeconds(frames);
    for (let m = this.lastSeconds + 1; m <= reached && !this.done; m++) {
      const split = splitHalfAt(frames, m);
      if (split === null) break;
      this.push(inputOf(split));
    }
    return {
      validSpeechMs: validSpeechMsOf(frames),
      evaluations: this.count,
      last: this.latest,
      converged: this.done,
      provisionalSeed: this.provisional(frames, reached),
    };
  }
}

/**
 * One analysis of the audio so far (ADR-0026): libfvad in the canonical mode,
 * the acoustic frames of the whole prefix with its own normalization gain,
 * then the monitor. The same call runs in the offscreen worker and in the
 * Node simulation of tests/benchmarks/stop-simulation.ts.
 */
export function observePrefix(
  channels: readonly Float32Array[],
  sampleRate: number,
  fvad: FvadModule,
  monitor: SplitHalfMonitor,
): SplitHalfProgress {
  const vad = createWebRtcVad(fvad);
  try {
    return monitor.observe(extractAcousticFrames(channels, sampleRate, vad).frames);
  } finally {
    vad.dispose();
  }
}

/** The seed of all the frames so far, or null while a measure is below its minimum (R13: never 0). */
export function provisionalSeedOf(frames: readonly AcousticFrame[], table: MappingTable = MAPPING_0): CrystalSeed | null {
  const raw = computeDescriptors(frames).raw;
  return raw.some((x) => x === null) ? null : seedFromRaw(raw, table).seed;
}

/** Valid speech of a frame sequence, ms: the useful 10 ms frames (same count as qualitySummary). */
export function validSpeechMsOf(frames: readonly AcousticFrame[]): number {
  let n = 0;
  for (const f of frames) if (isUseful(f)) n++;
  return Math.round((n * 1000 * SPLIT_HALF_BLOCK_SECONDS) / SPLIT_HALF_BLOCK_FRAMES);
}
