// I-07: the split-half stopping rule with synthetic descriptor sequences
// (BACKLOG I-07 DoD: semantics checked on sequences of descriptors and times).
import { parseMappingTable, type MappingTable } from '@voicecrystal/calibration';
import { DESCRIPTOR_KEYS } from '@voicecrystal/contracts';
import { SPLIT_HALF_CONSECUTIVE, SPLIT_HALF_TAU_POINTS, type AcousticFrame, type RawMeasures } from '@voicecrystal/dsp-core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  evaluateSplitHalf,
  FIRST_EVALUATED_SECOND,
  SplitHalfMonitor,
  validSpeechMsOf,
  type SplitHalfInput,
} from '../src/shared/split-half-rule.ts';

/** Identity table: a raw value x in [0, 100] maps to x points exactly. */
const IDENTITY: MappingTable = parseMappingTable({
  mappingVersion: 'identity-test',
  experimental: true,
  parameters: Object.fromEntries(
    DESCRIPTOR_KEYS.map((k) => [k, { measure: 'x', unit: 'points', percentiles: Array.from({ length: 101 }, (_, i) => i) }]),
  ),
});

const six = (v: number): RawMeasures => [v, v, v, v, v, v];

function input(seconds: number, over: Partial<SplitHalfInput> = {}): SplitHalfInput {
  return { seconds, a: six(50), b: six(52), missingWhole: [], multiSpeakerSuspected: false, ...over };
}

/** Feeds seconds 8, 9, … with `at(seconds)`; returns the second of convergence or null. */
function run(at: (seconds: number) => Partial<SplitHalfInput>, until = 18): number | null {
  const m = new SplitHalfMonitor(IDENTITY);
  for (let s = FIRST_EVALUATED_SECOND; s <= until; s++) {
    m.push(input(s, at(s)));
    if (m.converged) return s;
  }
  return null;
}

describe('evaluateSplitHalf', () => {
  it('takes the largest half-to-half difference in points', () => {
    const e = evaluateSplitHalf(input(8, { a: [10, 20, 30, 40, 50, 60], b: [11, 25, 30, 38, 50, 60] }), IDENTITY);
    expect(e.differences).toEqual([1, 5, 0, 2, 0, 0]);
    expect(e.s).toBe(5);
    expect(e.passed).toBe(true);
  });

  it('is stable at exactly τ and not above', () => {
    expect(SPLIT_HALF_TAU_POINTS).toBe(6);
    expect(evaluateSplitHalf(input(8, { a: six(50), b: six(56) }), IDENTITY).passed).toBe(true);
    const above = evaluateSplitHalf(input(8, { a: six(50), b: six(56.001) }), IDENTITY);
    expect(above.passed).toBe(false);
    expect(above.blockedBy).toBe('UNSTABLE');
  });

  it('never passes when a half cannot measure a descriptor (null, never 0)', () => {
    const e = evaluateSplitHalf(input(8, { a: [50, 50, 50, 50, 50, null], b: six(50) }), IDENTITY);
    expect(e.s).toBeNull();
    expect(e.differences[5]).toBeNull();
    expect(e.blockedBy).toBe('HALF_INCOMPLETE');
  });

  it('reports the first SPEC §8 condition that fails', () => {
    expect(evaluateSplitHalf(input(7), IDENTITY).blockedBy).toBe('TOO_SHORT');
    expect(evaluateSplitHalf(input(8, { missingWhole: ['p6_rhythm'] }), IDENTITY).blockedBy).toBe('MISSING_DESCRIPTOR');
    expect(evaluateSplitHalf(input(8, { multiSpeakerSuspected: true }), IDENTITY).blockedBy).toBe('MULTI_SPEAKER');
  });
});

describe('SplitHalfMonitor', () => {
  it('converges after three passing evaluations in a row, at the earliest at 10 s', () => {
    expect(FIRST_EVALUATED_SECOND).toBe(8);
    expect(SPLIT_HALF_CONSECUTIVE).toBe(3);
    expect(run(() => ({}))).toBe(10);
  });

  it('restarts the run after a failing evaluation', () => {
    // 8, 9 pass; 10 unstable; 11, 12, 13 pass → converged at 13.
    expect(run((s) => (s === 10 ? { b: six(70) } : {}))).toBe(13);
  });

  it('never converges with a missing descriptor or several voices, whatever the halves say', () => {
    expect(run(() => ({ missingWhole: ['p3_dynamics'] }), 45)).toBeNull();
    expect(run(() => ({ multiSpeakerSuspected: true }), 45)).toBeNull();
    // Review H-1: a warning seen once stays pending (no answer before I-13), so nothing converges afterwards.
    expect(run((s) => ({ multiSpeakerSuspected: s === 9 }), 45)).toBeNull();
    const m = new SplitHalfMonitor(IDENTITY);
    m.push(input(8, { multiSpeakerSuspected: true }));
    expect(m.push(input(9))?.blockedBy).toBe('MULTI_SPEAKER');
  });

  it('I-13b (D-AM): «Sì, continua» unblocks the stop for the rest of the session', () => {
    const m = new SplitHalfMonitor(IDENTITY);
    m.push(input(8, { multiSpeakerSuspected: true }));
    expect(m.multiSpeakerPending).toBe(true);
    expect(m.push(input(9))?.blockedBy).toBe('MULTI_SPEAKER');
    m.confirmSingleSpeaker();
    expect(m.multiSpeakerPending).toBe(false);
    // The heuristic fires again: the answer holds, the run builds up and converges.
    m.push(input(10, { multiSpeakerSuspected: true }));
    m.push(input(11, { multiSpeakerSuspected: true }));
    expect(m.push(input(12, { multiSpeakerSuspected: true }))?.consecutive).toBe(3);
    expect(m.multiSpeakerPending).toBe(false);
    expect(m.converged).toBe(true);
  });

  it('without an answer the warning stays pending (ADR-0026 point 4.3)', () => {
    const m = new SplitHalfMonitor(IDENTITY);
    m.push(input(8, { multiSpeakerSuspected: true }));
    for (let s = 9; s < 30; s++) m.push(input(s));
    expect(m.multiSpeakerPending).toBe(true);
    expect(m.converged).toBe(false);
  });

  it('refuses an evaluation out of order and changes nothing after convergence', () => {
    const m = new SplitHalfMonitor(IDENTITY);
    expect(m.push(input(9))).toBeNull(); // 8 first
    expect(m.push(input(8))?.consecutive).toBe(1);
    expect(m.push(input(8))).toBeNull(); // twice the same second
    expect(m.push(input(10))).toBeNull(); // a skipped second
    m.push(input(9));
    m.push(input(10));
    expect(m.converged).toBe(true);
    expect(m.push(input(11))).toBeNull();
    expect(m.evaluations).toBe(3);
  });

  it('never converges before 8 s + two more seconds, nor without three passes in a row (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ stable: fc.boolean(), missing: fc.boolean(), multi: fc.boolean() }), { minLength: 1, maxLength: 40 }), (seq) => {
        const m = new SplitHalfMonitor(IDENTITY);
        const passed: boolean[] = [];
        let warned = false;
        seq.forEach((v, i) => {
          if (m.converged) return;
          const seconds = FIRST_EVALUATED_SECOND + i;
          m.push(input(seconds, { b: six(v.stable ? 53 : 80), missingWhole: v.missing ? ['p1_pitch'] : [], multiSpeakerSuspected: v.multi }));
          warned ||= v.multi;
          passed.push(v.stable && !v.missing && !warned);
        });
        const n = passed.length;
        const lastThree = n >= 3 && passed.slice(n - 3).every(Boolean);
        return m.converged === lastThree && (!m.converged || FIRST_EVALUATED_SECOND + n - 1 >= 10);
      }),
      { numRuns: 300 },
    );
  });
});

describe('observe', () => {
  function frame(i: number, useful: boolean): AcousticFrame {
    return {
      frameIndex: i,
      sampleStart: i * 160,
      sampleLength: 640,
      centreSeconds: (i * 160 + 320) / 16000,
      vadSpeech: useful,
      rmsDbfs: -20,
      f0Hz: 150,
      pitchConfidence: 0.95,
      spectralCentroidHz: 900,
      spectralFlatness: 0.2,
      periodicity: 0.97,
      envelopeEnergy: 0.01,
      clipped: false,
      spectralFlux: i === 0 ? null : i % 20 === 10 ? 20 : 0.1,
      bandMagnitude: 10,
    };
  }
  const frames = (n: number): AcousticFrame[] => Array.from({ length: n }, (_, i) => frame(i, true));

  it('gives a provisional seed once all six measures are measurable, never 0 before (I-13a, R13)', () => {
    expect(new SplitHalfMonitor().observe(frames(150)).provisionalSeed).toBeNull();
    const p = new SplitHalfMonitor().observe(frames(700));
    expect(p.provisionalSeed).toHaveLength(6);
    expect(p.provisionalSeed?.every((v) => Number.isInteger(v) && v >= 0 && v <= 10_000)).toBe(true);
  });

  it('evaluates nothing below 8 s and reports the valid speech in ms', () => {
    const m = new SplitHalfMonitor();
    const p = m.observe(frames(799));
    expect(p.evaluations).toBe(0);
    expect(p.validSpeechMs).toBe(7990);
    expect(validSpeechMsOf(frames(1234))).toBe(12340);
  });

  it('catches up: one analysis that jumps from 7 s to 12 s evaluates 8, 9, 10 and stops at convergence', () => {
    // A steady synthetic voice: identical halves, all minimums reached
    // (an onset every 200 ms, five in every block).
    const m = new SplitHalfMonitor();
    m.observe(frames(700));
    const p = m.observe(frames(1200));
    expect(p.last?.s).toBe(0);
    expect(p.converged).toBe(true);
    expect(p.evaluations).toBe(3);
    expect(p.last?.seconds).toBe(10);
  });
});
