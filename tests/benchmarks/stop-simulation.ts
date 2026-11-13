// I-07: a tab or microphone session simulated in Node, second by second, with
// the same steps as the offscreen dsp-worker (ADR-0026): after each whole
// second of source audio, the prefix is analysed (libfvad, canonical mode),
// the split-half monitor observes its frames, and the capture machine gets
// SPLIT_HALF_STABLE and a TICK with the valid speech, like CaptureSession.
// Shared by tests/unit/stop-rule-fixtures.test.ts and `pnpm bench:descriptors`.

import { seedFromRaw } from '@voicecrystal/calibration';
import type { CaptureExitReason, CaptureState, CrystalSeed } from '@voicecrystal/contracts';
import { createWebRtcVad, extractDescriptors, qualitySummary } from '@voicecrystal/dsp-core';
import { INITIAL_STATE, transition, type MachineState } from '../../extension/src/offscreen/capture-machine.ts';
import { observePrefix, SplitHalfMonitor, type SplitHalfEvaluation } from '../../extension/src/shared/split-half-rule.ts';
import { buildFixture, selectSpecs } from '../../scripts/fixtures/build.ts';
import { VOICE_A, VOICE_B } from '../../scripts/fixtures/catalog.ts';
import { synthVoice, type VoiceParams } from '../../scripts/fixtures/synth/voice.ts';
import { decodeWav } from '../../scripts/fixtures/wav.ts';
import { loadFvad } from './fvad-loader.ts';

const fvad = loadFvad().fvad;

export interface StopStep {
  /** Seconds of source audio analysed. */
  audioSeconds: number;
  validSpeechMs: number;
  evaluations: number;
  last: SplitHalfEvaluation | null;
  state: CaptureState;
  /** Time of the prefix analysis in Node, ms. */
  analysisMs: number;
}

export interface StopSimulation {
  /**
   * Terminal state after the final analysis of the audio up to the stop
   * (ADR-0025: QUALITY with the 8 s rule of SPEC §6.1); LISTENING when the
   * audio ran out before any stop.
   */
  state: CaptureState;
  exitReason: CaptureExitReason | null;
  /** Seconds of audio at the stop, null if the audio ran out first. */
  stoppedAtSeconds: number | null;
  steps: StopStep[];
  /** Seed of the final analysis, null without a crystal or without a stop. */
  seed: CrystalSeed | null;
}

export interface SimulationOptions {
  /** Seconds of audio to simulate at most (default: the whole signal). */
  maxSeconds?: number;
  /** Ignore the monitor's convergence (to reach MAX_VALID_SPEECH). */
  neverConverge?: boolean;
}

function prefix(channels: readonly Float32Array[], frames: number): Float32Array[] {
  return channels.map((c) => c.subarray(0, frames));
}

export function simulateSession(channels: readonly Float32Array[], sampleRate: number, options: SimulationOptions = {}): StopSimulation {
  const length = channels[0]?.length ?? 0;
  const seconds = Math.min(Math.floor(length / sampleRate), options.maxSeconds ?? Infinity);
  const monitor = new SplitHalfMonitor();
  let machine: MachineState = transition(transition(INITIAL_STATE, { type: 'START' }).next, { type: 'ACQUIRED' }).next;
  const steps: StopStep[] = [];
  for (let k = 1; k <= seconds && machine.state === 'LISTENING'; k++) {
    const t0 = performance.now();
    const progress = observePrefix(prefix(channels, k * sampleRate), sampleRate, fvad, monitor);
    const analysisMs = performance.now() - t0;
    if (progress.converged && !options.neverConverge) machine = transition(machine, { type: 'SPLIT_HALF_STABLE' }).next;
    machine = transition(machine, { type: 'TICK', activeMs: k * 1000, elapsedMs: k * 1000, validSpeechMs: progress.validSpeechMs }).next;
    steps.push({ audioSeconds: k, validSpeechMs: progress.validSpeechMs, evaluations: progress.evaluations, last: progress.last, state: machine.state, analysisMs });
  }
  if (machine.state !== 'FINALIZING') return { state: machine.state, exitReason: machine.exitReason, stoppedAtSeconds: null, steps, seed: null };
  // The final analysis of everything received (the worker's STREAM_END): here the prefix up to the stop.
  const stoppedAtSeconds = steps.length;
  const vad = createWebRtcVad(fvad);
  let final: { seed: CrystalSeed | null; accepted: boolean; validSpeechMs: number };
  try {
    const x = extractDescriptors(prefix(channels, stoppedAtSeconds * sampleRate), sampleRate, vad);
    const q = qualitySummary(x);
    const seed = x.status === 'OK' ? seedFromRaw(x.raw).seed : null;
    final = { seed, accepted: q.accepted && seed !== null, validSpeechMs: q.validSpeechMs };
  } finally {
    vad.dispose();
  }
  const { seed } = final;
  machine = transition(machine, { type: 'QUALITY', accepted: final.accepted, validSpeechMs: final.validSpeechMs }).next;
  return { state: machine.state, exitReason: machine.exitReason, stoppedAtSeconds, steps, seed: machine.state === 'RESULT_READY' ? seed : null };
}

/**
 * Positive control of the stopping mechanism (decision D-AE): voice A with
 * almost no intonation, no jitter, no breath and no phrase pauses, at 5
 * syllables per second, generated in memory. Measured in I-07: it converges,
 * but p6 is saturated at 100 points on both halves with mapping-0 (raw
 * 7.7 and 9.2 onsets per second): it checks the chain end to end, not the
 * threshold τ (docs/BENCHMARK_PROTOCOL.md §7).
 */
export const REGULAR_VOICE: VoiceParams = {
  ...VOICE_A,
  intonationDepthSemitones: 0.5,
  jitter: 0,
  breathiness: 0,
  syllableRateHz: 5,
  syllablesPerPhrase: 1000,
  phrasePauseSeconds: 0,
};

export function regularVoice(seconds: number, seed: number): { channels: Float32Array[]; sampleRate: number } {
  return { channels: [Float32Array.from(synthVoice(REGULAR_VOICE, seconds, 48000, seed).signal)], sampleRate: 48000 };
}

/**
 * Review H-1/H-3: voice A then voice B, both as regular as REGULAR_VOICE, so
 * that the halves measure all six descriptors after the change (the a-then-b
 * fixture is too short for that). After the change both halves hold A and B.
 */
export function regularVoiceAThenB(secondsA: number, secondsB: number, seed: number): { channels: Float32Array[]; sampleRate: number } {
  const regularB: VoiceParams = { ...REGULAR_VOICE, f0Hz: VOICE_B.f0Hz, formantScale: VOICE_B.formantScale };
  const a = synthVoice(REGULAR_VOICE, secondsA, 48000, seed).signal;
  const b = synthVoice(regularB, secondsB, 48000, seed + 1).signal;
  const out = new Float32Array(a.length + b.length);
  out.set(Float32Array.from(a), 0);
  out.set(Float32Array.from(b), a.length);
  return { channels: [out], sampleRate: 48000 };
}

/** A catalog fixture rendered in memory (same int16 samples as the file). */
export function fixtureAudio(name: string): { channels: Float32Array[]; sampleRate: number } {
  const [spec] = selectSpecs([name]);
  if (spec === undefined) throw new Error(`unknown fixture ${name}`);
  const wav = decodeWav(buildFixture(spec).wav);
  return { channels: [...wav.channels], sampleRate: wav.sampleRate };
}
