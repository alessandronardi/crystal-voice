import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DspInputError, frameCount, PITCH_FRAME_SAMPLES, PITCH_HOP_SAMPLES, yinFrame } from '../src/index.ts';

const SR = 16000;
const frameOf = (fn: (t: number) => number, offset = 0): Float32Array =>
  Float32Array.from({ length: PITCH_FRAME_SAMPLES }, (_, i) => fn((i + offset) / SR));
const sine = (f: number, amp = 0.5) => (t: number) => amp * Math.sin(2 * Math.PI * f * t);
/** Band-limited sawtooth-like tone: strong harmonics, a classic octave-error trap. */
const harmonic = (f: number) => (t: number) => {
  let v = 0;
  for (let k = 1; k * f < 7000; k++) v += Math.sin(2 * Math.PI * k * f * t) / k;
  return 0.3 * v;
};

describe('frameCount', () => {
  it('counts only frames fully inside the signal', () => {
    expect(frameCount(0, 640, 160)).toBe(0);
    expect(frameCount(639, 640, 160)).toBe(0);
    expect(frameCount(640, 640, 160)).toBe(1);
    expect(frameCount(800, 640, 160)).toBe(2);
    expect(frameCount(16000, PITCH_FRAME_SAMPLES, PITCH_HOP_SAMPLES)).toBe(97);
  });
});

describe('YIN', () => {
  it('estimates pure tones from 65 to 1100 Hz within 0.5% (singing included, ADR-0017)', () => {
    for (let f = 65; f <= 1100; f += 15) {
      const r = yinFrame(frameOf(sine(f)), SR);
      expect(r.f0Hz).not.toBeNull();
      expect(Math.abs((r.f0Hz ?? 0) / f - 1)).toBeLessThan(0.005);
      expect(r.pitchConfidence ?? 0).toBeGreaterThan(0.85);
    }
  });

  it('has no octave errors on harmonic-rich tones', () => {
    for (const f of [80, 110, 150, 220, 330, 440, 660, 880, 1046]) {
      for (const offset of [0, 37, 211]) {
        const r = yinFrame(frameOf(harmonic(f), offset), SR);
        expect(r.f0Hz).not.toBeNull();
        expect(Math.abs(Math.log2((r.f0Hz ?? 1) / f))).toBeLessThan(0.02);
      }
    }
  });

  // Review I-05a (M2): a dip on the range edge used to fold 600 Hz into 300 Hz with confidence 0.997.
  it('returns null outside 60–1100 Hz instead of folding into the range (no octave errors)', () => {
    for (const f of [40, 52, 55, 1120, 1200, 1500, 2000]) {
      for (const gen of [sine, harmonic]) {
        const r = yinFrame(frameOf(gen(f)), SR);
        expect(r.f0Hz, `${gen === sine ? 'sine' : 'harmonic'} ${f} Hz`).toBeNull();
      }
    }
  });

  it('returns null pitch on digital silence and on white noise', () => {
    const silent = yinFrame(new Float32Array(PITCH_FRAME_SAMPLES), SR);
    expect(silent).toEqual({ f0Hz: null, pitchConfidence: null, periodicity: null });
    let seed = 12345;
    const noise = Float32Array.from({ length: PITCH_FRAME_SAMPLES }, () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 2 ** 32 - 0.5;
    });
    const r = yinFrame(noise, SR);
    expect(r.f0Hz).toBeNull();
    expect(r.pitchConfidence).toBeNull();
    expect(r.periodicity).not.toBeNull();
    expect(r.periodicity ?? 1).toBeLessThan(0.5);
  });

  it('never emits NaN; confidence and periodicity stay in [0, 1]', () => {
    fc.assert(
      fc.property(fc.float32Array({ minLength: PITCH_FRAME_SAMPLES, maxLength: PITCH_FRAME_SAMPLES, noNaN: true, min: -1, max: 1 }), (x) => {
        const r = yinFrame(x, SR);
        for (const v of [r.f0Hz, r.pitchConfidence, r.periodicity]) if (v !== null) expect(Number.isFinite(v)).toBe(true);
        if (r.pitchConfidence !== null) expect(r.pitchConfidence).toBeGreaterThanOrEqual(0);
        if (r.pitchConfidence !== null) expect(r.pitchConfidence).toBeLessThanOrEqual(1);
        if (r.periodicity !== null) expect(r.periodicity).toBeGreaterThanOrEqual(0);
        if (r.periodicity !== null) expect(r.periodicity).toBeLessThanOrEqual(1);
        if (r.f0Hz !== null) expect(r.f0Hz).toBeGreaterThanOrEqual(60 * 0.995);
        if (r.f0Hz !== null) expect(r.f0Hz).toBeLessThanOrEqual(1100 * 1.005);
      }),
      { numRuns: 50 },
    );
  });

  it('is gain-invariant and deterministic', () => {
    const x = frameOf(harmonic(150));
    const r = yinFrame(x, SR);
    expect(yinFrame(x, SR)).toEqual(r);
    const quieter = yinFrame(x.map((v) => v * 0.25), SR);
    expect(quieter.f0Hz).toBeCloseTo(r.f0Hz ?? 0, 6);
  });

  it('rejects frames of the wrong length or rate', () => {
    expect(() => yinFrame(new Float32Array(100), SR)).toThrow(DspInputError);
    expect(() => yinFrame(new Float32Array(PITCH_FRAME_SAMPLES), 44100)).toThrow(DspInputError);
  });
});
