// I-07 Definition of Done on synthetic voices (BACKLOG I-07, SPEC §8): a tab
// or microphone session simulated in Node with the worker's own steps
// (tests/benchmarks/stop-simulation.ts, ADR-0026). Measured values are in
// docs/BENCHMARK_PROTOCOL.md §7 (`pnpm bench:descriptors`).
import { describe, expect, it } from 'vitest';
import { fixtureAudio, regularVoice, regularVoiceAThenB, simulateSession } from '../benchmarks/stop-simulation.ts';

const SLOW = 120_000;

describe('split-half stop on synthetic voices', () => {
  it(
    'voice-a-long: never CONVERGED with τ = 6 (D-AE, measured), MAX_VALID_SPEECH at 18 s of valid speech, then a crystal',
    () => {
      const { channels, sampleRate } = fixtureAudio('voice-a-long');
      const sim = simulateSession(channels, sampleRate);
      expect(sim.exitReason).toBe('MAX_VALID_SPEECH');
      expect(sim.state).toBe('RESULT_READY');
      expect(sim.seed).not.toBeNull();
      expect(sim.steps.every((s) => s.last === null || s.last.consecutive < 3)).toBe(true);
      // Never before 8 s of valid speech, one evaluation per second of it.
      const first = sim.steps.find((s) => s.evaluations > 0);
      expect(first?.validSpeechMs).toBeGreaterThanOrEqual(8000);
      expect(sim.steps.at(-1)?.validSpeechMs).toBeGreaterThanOrEqual(18_000);
      expect(sim.steps.at(-1)?.evaluations).toBe(11); // seconds 8…18
    },
    SLOW,
  );

  it(
    'a-then-b: no CONVERGED across the change of voice (too short for complete halves: warning or incomplete halves block it)',
    () => {
      const { channels, sampleRate } = fixtureAudio('a-then-b');
      const sim = simulateSession(channels, sampleRate);
      expect(sim.exitReason).not.toBe('CONVERGED');
      expect(sim.stoppedAtSeconds).toBeNull();
      // Valid speech reaches 8 s only after the change (8 s of audio): every evaluation mixes A and B.
      const evaluated = sim.steps.filter((s) => s.last !== null);
      expect(evaluated.length).toBeGreaterThan(0);
      expect(evaluated[0]?.audioSeconds).toBeGreaterThan(8);
      for (const s of evaluated) expect(s.last?.passed).toBe(false);
    },
    SLOW,
  );

  it(
    'regular A (10 s) then regular B: complete halves after the change, still no CONVERGED (review H-1: the warning stays pending)',
    () => {
      const { channels, sampleRate } = regularVoiceAThenB(10, 25, 1);
      const sim = simulateSession(channels, sampleRate);
      expect(sim.exitReason).toBe('MAX_VALID_SPEECH');
      const evaluated = sim.steps.filter((s) => s.last !== null);
      expect(evaluated.some((s) => s.last?.blockedBy === 'MULTI_SPEAKER')).toBe(true);
      // Once the warning appeared, no later evaluation passes.
      const firstWarning = evaluated.findIndex((s) => s.last?.blockedBy === 'MULTI_SPEAKER');
      for (const s of evaluated.slice(firstWarning)) expect(s.last?.passed).toBe(false);
    },
    SLOW,
  );

  it(
    'alternating-ab-v1: no CONVERGED on two voices taking turns',
    () => {
      const { channels, sampleRate } = fixtureAudio('alternating-ab-v1');
      const sim = simulateSession(channels, sampleRate);
      expect(sim.exitReason).not.toBe('CONVERGED');
    },
    SLOW,
  );

  it(
    'positive control: a very regular synthetic voice converges (p6 saturated: the chain, not τ, is checked)',
    () => {
      for (const seed of [1, 2]) {
        const { channels, sampleRate } = regularVoice(30, seed);
        const sim = simulateSession(channels, sampleRate);
        expect(sim.exitReason, `seed ${seed}`).toBe('CONVERGED');
        expect(sim.state).toBe('RESULT_READY');
        const last = sim.steps.at(-1);
        expect(last?.last?.consecutive).toBe(3);
        expect(last?.validSpeechMs).toBeGreaterThanOrEqual(10_000);
        expect(last?.validSpeechMs).toBeLessThan(18_000);
      }
    },
    SLOW,
  );
});
