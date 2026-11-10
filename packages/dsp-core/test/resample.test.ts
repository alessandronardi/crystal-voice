import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createResampler, DspInputError, resample } from '../src/index.ts';

const sine = (f: number, sr: number, seconds: number, amp = 0.5): Float32Array =>
  Float32Array.from({ length: Math.round(seconds * sr) }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / sr));

/** RMS in dB over the middle, away from the zero-padded edges. */
function midRmsDb(x: Float32Array): number {
  const from = Math.floor(x.length * 0.2);
  const to = Math.floor(x.length * 0.8);
  let s = 0;
  for (let i = from; i < to; i++) s += (x[i] ?? 0) ** 2;
  return 10 * Math.log10(s / (to - from));
}

describe('resample', () => {
  it('produces exact output lengths', () => {
    expect(resample(new Float32Array(48000), 48000, 16000)).toHaveLength(16000);
    expect(resample(new Float32Array(44100), 44100, 16000)).toHaveLength(16000);
    expect(resample(new Float32Array(7), 48000, 16000)).toHaveLength(3);
    expect(resample(new Float32Array(0), 48000, 16000)).toHaveLength(0);
  });

  it('is the identity at equal rates', () => {
    const x = sine(440, 16000, 0.1);
    expect(resample(x, 16000, 16000)).toEqual(x);
  });

  it('preserves in-band tones within 0.1 dB at 44.1 and 48 kHz', () => {
    for (const sr of [44100, 48000]) {
      for (const f of [100, 440, 1000, 3000, 6500]) {
        const x = sine(f, sr, 1);
        const y = resample(x, sr, 16000);
        expect(Math.abs(midRmsDb(y) - midRmsDb(x))).toBeLessThan(0.1);
      }
    }
  });

  it('attenuates out-of-band tones (anti-alias) by at least 60 dB [H]', () => {
    for (const sr of [44100, 48000]) {
      for (const f of [9000, 12000, 15000]) {
        const x = sine(f, sr, 1);
        const y = resample(x, sr, 16000);
        expect(midRmsDb(x) - midRmsDb(y)).toBeGreaterThan(60);
      }
    }
  });

  it('keeps the frequency of a tone (zero crossings)', () => {
    const y = resample(sine(250, 44100, 1), 44100, 16000);
    let crossings = 0;
    for (let i = 1; i < y.length; i++) if ((y[i - 1] ?? 0) < 0 && (y[i] ?? 0) >= 0) crossings++;
    expect(Math.abs(crossings - 250)).toBeLessThanOrEqual(1);
  });

  it('is bit-identical across calls on the same whole buffer (one resampler or a fresh one)', () => {
    fc.assert(
      fc.property(fc.float32Array({ minLength: 0, maxLength: 3000, noNaN: true, min: -1, max: 1 }), (x) => {
        const r = createResampler(44100, 16000);
        const a = r.process(x);
        expect(r.process(x)).toEqual(a);
        expect(resample(x, 44100, 16000)).toEqual(a);
        expect(a.every((v) => Number.isFinite(v))).toBe(true);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects bad rates and non-finite input with typed errors', () => {
    expect(() => createResampler(0, 16000)).toThrow(DspInputError);
    expect(() => createResampler(44100.5, 16000)).toThrow(DspInputError);
    expect(() => createResampler(44123, 16000)).toThrow(DspInputError); // too many polyphase phases
    expect(() => resample(Float32Array.from([Number.NaN]), 48000, 16000)).toThrow(DspInputError);
  });
});
