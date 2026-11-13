// I-07: the limits, with the worker's own steps (tests/benchmarks/stop-simulation.ts).
// The 120 s absolute timeout and the INTERRUPTED reasons are sequences of
// events and times in extension/test/capture-machine.test.ts and
// capture-session.test.ts.
import { describe, expect, it } from 'vitest';
import { tone } from '../../scripts/fixtures/synth/basic.ts';
import { simulateSession } from '../benchmarks/stop-simulation.ts';

describe('split-half stop: limits', () => {
  it(
    '46 s of digital silence: no valid speech, no evaluation, WALL_TIMEOUT at 45 s of listening, then INSUFFICIENT_DATA',
    () => {
      const sim = simulateSession([new Float32Array(46 * 48000)], 48000);
      expect(sim.exitReason).toBe('WALL_TIMEOUT');
      expect(sim.stoppedAtSeconds).toBe(45);
      expect(sim.state).toBe('INSUFFICIENT_DATA');
      expect(sim.seed).toBeNull();
      expect(sim.steps.every((s) => s.validSpeechMs === 0 && s.evaluations === 0)).toBe(true);
    },
    240_000,
  );

  it(
    'a 46 s tone: libfvad calls it speech, so it stops with MAX_VALID_SPEECH at 18 s, and still gives no crystal',
    () => {
      const sim = simulateSession([Float32Array.from(tone(200, 46, 48000, -12))], 48000);
      expect(sim.exitReason).toBe('MAX_VALID_SPEECH');
      expect(sim.stoppedAtSeconds).toBeLessThan(25);
      expect(sim.state).toBe('INSUFFICIENT_DATA');
      expect(sim.seed).toBeNull();
      // p6 (onsets) is never measurable on a tone: no evaluation can pass.
      expect(sim.steps.every((s) => s.last === null || !s.last.passed)).toBe(true);
    },
    240_000,
  );
});
