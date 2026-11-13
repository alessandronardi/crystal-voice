// I-07, pure pieces tested in Node: the accumulator snapshot, the stream
// evaluator (when an evaluation is due, catch-up, stop, failure) and the
// STREAM_PROGRESS guard.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isDspWorkerReply, isStreamProgress, type StreamProgress } from '../src/shared/dsp-protocol.ts';
import { PcmAccumulator } from '../src/shared/pcm-accumulator.ts';
import { observePrefix, SplitHalfMonitor, type SplitHalfProgress } from '../src/shared/split-half-rule.ts';
import { createEvaluationLoop, StreamEvaluator, type PrefixAnalyser } from '../src/shared/stream-evaluator.ts';
import { synthVoice } from '../../scripts/fixtures/synth/voice.ts';
import { VOICE_A } from '../../scripts/fixtures/catalog.ts';
import { loadFvad } from '../../tests/benchmarks/fvad-loader.ts';

const SR = 1000;
const block = (n: number, from = 0): Float32Array[] => [Float32Array.from({ length: n }, (_, i) => (from + i) / 1e6)];
const clock = (): (() => number) => {
  let t = 0;
  return () => (t += 5);
};
const never = (): never => {
  throw new Error('not called');
};

describe('PcmAccumulator.snapshot', () => {
  it('copies the first frames of the blocks without consuming them (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 300 }), { minLength: 1, maxLength: 20 }), fc.integer({ min: 0, max: 7000 }), (cuts, n) => {
        const acc = new PcmAccumulator(100_000);
        let at = 0;
        for (const c of cuts) {
          acc.push(block(c, at));
          at += c;
        }
        const [s] = acc.snapshot(n);
        const expected = Math.min(n, at);
        if (s?.length !== expected) return false;
        for (let i = 0; i < expected; i++) if (s[i] !== Math.fround(i / 1e6)) return false;
        s.fill(9); // a copy: the kept audio does not change
        const [whole] = acc.take();
        return whole?.length === at && whole[0] === 0;
      }),
    );
  });
});

describe('StreamEvaluator', () => {
  const fake =
    (out: Partial<SplitHalfProgress> = {}, seen: number[] = []) =>
    (channels: Float32Array[]): SplitHalfProgress => {
      seen.push(channels[0]?.length ?? -1);
      return { validSpeechMs: 0, evaluations: 0, last: null, converged: false, provisionalSeed: null, ...out };
    };

  it('is due once per new whole second of audio, and analyses the prefix of that many seconds', () => {
    const e = new StreamEvaluator(10_000, SR);
    const seen: number[] = [];
    e.accumulator.push(block(999));
    expect(e.due()).toBeNull();
    e.accumulator.push(block(1));
    expect(e.due()).toBe(1);
    const p = e.evaluate(1, fake({ validSpeechMs: 420 }, seen), clock(), never);
    expect(p).toMatchObject({ audioSeconds: 1, validSpeechMs: 420, failure: null, converged: false, analysisMs: 5 });
    expect(e.due()).toBeNull();
    // Behind: 3.5 s received → the next evaluation jumps to 3 s.
    e.accumulator.push(block(2500));
    expect(e.due()).toBe(3);
    e.evaluate(3, fake({}, seen), clock(), never);
    expect(seen).toEqual([1000, 3000]);
  });

  it('stops after convergence, after a failure and after the end of the stream', () => {
    const converged = new StreamEvaluator(10_000, SR);
    converged.accumulator.push(block(1000));
    // The real monitor decides convergence: a fake that says so is not enough.
    expect(converged.evaluate(1, fake({ converged: true }), clock(), never).converged).toBe(true);
    converged.accumulator.push(block(1000));
    expect(converged.due()).toBe(2);

    const failing = new StreamEvaluator(10_000, SR);
    failing.accumulator.push(block(2000));
    const p = failing.evaluate(2, () => {
      throw new Error('boom');
    }, clock(), () => 'INTERNAL');
    expect(p.failure).toBe('INTERNAL');
    failing.accumulator.push(block(1000));
    expect(failing.due()).toBeNull();

    const ended = new StreamEvaluator(10_000, SR);
    ended.accumulator.push(block(2000));
    ended.stop();
    expect(ended.due()).toBeNull();
  });

  it('stops once its own monitor converges (real analysis of a steady synthetic voice is not needed: fake frames)', () => {
    const e = new StreamEvaluator(10_000, SR);
    e.accumulator.push(block(1000));
    const converge = (_c: Float32Array[], _sr: number, monitor: SplitHalfMonitor): SplitHalfProgress => {
      for (let s = 8; s <= 10; s++) monitor.push({ seconds: s, a: [50, 50, 50, 50, 50, 50], b: [50, 50, 50, 50, 50, 50], missingWhole: [], multiSpeakerSuspected: false });
      return { validSpeechMs: 10_000, evaluations: monitor.evaluations, last: monitor.last, converged: monitor.converged, provisionalSeed: null };
    };
    expect(e.evaluate(1, converge, clock(), never).converged).toBe(true);
    e.accumulator.push(block(5000));
    expect(e.due()).toBeNull();
  });
});

describe('createEvaluationLoop (review H-2)', () => {
  function setup() {
    const evaluator = new StreamEvaluator(100_000, SR);
    const queue: (() => void)[] = [];
    const seen: number[] = [];
    const posted: StreamProgress[] = [];
    const analyse: PrefixAnalyser = (channels) => {
      seen.push(channels[0]?.length ?? -1);
      return { validSpeechMs: 0, evaluations: 0, last: null, converged: false, provisionalSeed: null };
    };
    const loop = createEvaluationLoop(evaluator, {
      defer: (fn) => queue.push(fn),
      analyser: () => Promise.resolve(analyse),
      now: clock(),
      failureOf: () => 'INTERNAL',
      post: (p) => posted.push(p),
    });
    const runDeferred = async (): Promise<void> => {
      const fn = queue.shift();
      fn?.();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    };
    return { evaluator, queue, seen, posted, loop, runDeferred };
  }

  it('never evaluates in the current task: blocks queued meanwhile are in, and it jumps to the latest second', async () => {
    const t = setup();
    t.evaluator.accumulator.push(block(1000));
    t.loop.kick();
    expect(t.seen).toEqual([]); // deferred, not run yet
    // Three more seconds arrive before the deferred task runs (they were waiting on the port).
    for (let i = 0; i < 3; i++) {
      t.evaluator.accumulator.push(block(1000));
      t.loop.kick(); // already scheduled: no second evaluation
    }
    expect(t.queue).toHaveLength(1);
    await t.runDeferred();
    expect(t.seen).toEqual([4000]);
    expect(t.posted.map((p) => p.audioSeconds)).toEqual([4]);
    expect(t.queue).toHaveLength(0); // nothing new is due
  });

  it('schedules the next one only after the running one, and nothing once the stream ended', async () => {
    const t = setup();
    t.evaluator.accumulator.push(block(1000));
    t.loop.kick();
    await t.runDeferred();
    t.evaluator.accumulator.push(block(1000));
    t.loop.kick();
    t.evaluator.stop(); // STREAM_END before the deferred task
    await t.runDeferred();
    expect(t.seen).toEqual([1000]);
    expect(t.posted).toHaveLength(1);
  });
});

describe('observePrefix', () => {
  it('reports the valid speech of a synthetic voice and no evaluation below 8 s', () => {
    const { signal } = synthVoice(VOICE_A, 6, 48000, 1001);
    const p = observePrefix([Float32Array.from(signal)], 48000, loadFvad().fvad, new SplitHalfMonitor());
    expect(p.validSpeechMs).toBeGreaterThan(1000);
    expect(p.validSpeechMs).toBeLessThan(6000);
    expect(p.evaluations).toBe(0);
    expect(p.converged).toBe(false);
  });
});

describe('STREAM_PROGRESS guard', () => {
  const good: StreamProgress = {
    audioSeconds: 14,
    validSpeechMs: 8410,
    evaluations: 1,
    last: { seconds: 8, differences: [7.3, 0.6, 3.8, 0, 5, 11.4], s: 11.4, passed: false, blockedBy: 'UNSTABLE', consecutive: 0 },
    converged: false,
    provisionalSeed: null,
    analysisMs: 212,
    failure: null,
  };

  it('accepts a well-formed progress and refuses broken ones', () => {
    expect(isStreamProgress(good)).toBe(true);
    expect(isDspWorkerReply({ type: 'STREAM_PROGRESS', progress: good })).toBe(true);
    expect(isStreamProgress({ ...good, last: null })).toBe(true);
    expect(isStreamProgress({ ...good, validSpeechMs: -1 })).toBe(false);
    expect(isStreamProgress({ ...good, audioSeconds: 1.5 })).toBe(false);
    expect(isStreamProgress({ ...good, last: { ...good.last, blockedBy: 'NOPE' } })).toBe(false);
    // passed and blockedBy must agree.
    expect(isStreamProgress({ ...good, last: { ...good.last, passed: true } })).toBe(false);
    expect(isStreamProgress({ ...good, last: { ...good.last, differences: [1, 2, 3] } })).toBe(false);
    expect(isStreamProgress({ ...good, last: { ...good.last, s: Number.NaN } })).toBe(false);
    expect(isDspWorkerReply({ type: 'STREAM_PROGRESS', progress: { ...good, converged: 'yes' } })).toBe(false);
  });
});
