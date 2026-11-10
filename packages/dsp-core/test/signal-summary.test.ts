import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CLIP_THRESHOLD, DspInputError, signalSummary } from '../src/index.ts';

describe('signalSummary', () => {
  it('silence: rmsDbfs is null (not measurable), peak 0', () => {
    expect(signalSummary(new Float32Array(480), 48000)).toEqual({
      sampleRate: 48000,
      lengthSamples: 480,
      peak: 0,
      rmsDbfs: null,
      clippedSamples: 0,
    });
    expect(signalSummary(new Float32Array(0), 48000).rmsDbfs).toBeNull();
  });

  it('full-scale sine is −3.01 dBFS', () => {
    const x = Float32Array.from({ length: 48000 }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / 48000));
    expect(signalSummary(x, 48000).rmsDbfs).toBeCloseTo(-3.0103, 3);
  });

  it('counts clipped samples at int16 full scale', () => {
    const x = Float32Array.from([1, -1, CLIP_THRESHOLD, -CLIP_THRESHOLD, 0.5, 32766 / 32768]);
    expect(signalSummary(x, 8000).clippedSamples).toBe(4);
  });

  it('never emits NaN or Infinity, and halving the gain lowers RMS by 6.02 dB', () => {
    fc.assert(
      fc.property(fc.float32Array({ minLength: 1, maxLength: 500, noNaN: true, min: -1, max: 1 }), (x) => {
        const s = signalSummary(x, 16000);
        expect(Number.isFinite(s.peak)).toBe(true);
        if (s.rmsDbfs !== null) expect(Number.isFinite(s.rmsDbfs)).toBe(true);
        const half = signalSummary(x.map((v) => v / 2), 16000);
        if (s.rmsDbfs !== null && half.rmsDbfs !== null && s.rmsDbfs > -100) {
          expect(half.rmsDbfs - s.rmsDbfs).toBeCloseTo(-6.0206, 2);
        }
      }),
    );
  });

  it('throws typed errors on bad input', () => {
    expect(() => signalSummary(Float32Array.from([Number.NaN]), 48000)).toThrow(DspInputError);
    expect(() => signalSummary(new Float32Array(1), 0)).toThrow(DspInputError);
    expect(() => signalSummary(new Float32Array(1), 44100.5)).toThrow(DspInputError);
  });
});
