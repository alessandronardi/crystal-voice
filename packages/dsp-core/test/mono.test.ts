import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CANCELLATION_CAP_DB, DspInputError, mixToMono, PHASE_CANCELLATION_DB } from '../src/index.ts';
import { VOICE_A } from '../../../scripts/fixtures/catalog.ts';
import { synthVoice } from '../../../scripts/fixtures/synth/voice.ts';

const SR = 48000;
const sine = (f: number, seconds: number, amp = 0.3): Float32Array =>
  Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / SR));
const scaled = (x: Float32Array, g: number): Float32Array => x.map((v) => v * g);

describe('mixToMono (ADR-0016)', () => {
  it('passes a mono input through unchanged', () => {
    const x = sine(200, 0.5);
    const r = mixToMono([x], SR);
    expect(r.pcm).toEqual(x);
    expect(r.rule).toBe('single-channel');
    expect(r.warnings).toEqual([]);
    expect(r.cancellationDb).toBeNull();
  });

  it('averages in-phase stereo: identical channels give the channel itself, no warning', () => {
    const x = sine(200, 0.5);
    const r = mixToMono([x, x.slice()], SR);
    expect(r.rule).toBe('average');
    expect(r.pcm).toEqual(x);
    expect(r.warnings).toEqual([]);
    expect(r.cancellationDb).toBeCloseTo(0, 6);
  });

  it('synthetic voice duplicated in phase: mono equals the channel, no warning (ADR-0016 verification)', () => {
    const v = Float32Array.from(synthVoice(VOICE_A, 3, SR, 1).signal);
    const r = mixToMono([v, v.slice()], SR);
    expect(r.pcm).toEqual(v);
    expect(r.rule).toBe('average');
    expect(r.warnings).toEqual([]);
  });

  it('full antiphase: falls back to the louder channel with PHASE_CANCELLATION', () => {
    const x = sine(200, 0.5);
    // L = 0.9·x, R = −x: mono = −0.05·x, channels ≈ 0.951·a → ≈ 25.6 dB of cancellation.
    const r = mixToMono([scaled(x, 0.9), scaled(x, -1)], SR);
    expect(r.cancellationDb).toBeCloseTo(25.56, 1);
    expect(r.rule).toBe('channel-fallback');
    expect(r.channelIndex).toBe(1);
    expect(r.warnings).toEqual(['PHASE_CANCELLATION']);
    expect(r.pcm).toEqual(scaled(x, -1));
  });

  it('exact antiphase (mono is digital silence) counts as cancellation; ties pick channel 0', () => {
    const x = sine(200, 0.5);
    const r = mixToMono([x, scaled(x, -1)], SR);
    expect(r.rule).toBe('channel-fallback');
    expect(r.channelIndex).toBe(0);
    // A silent mono frame is capped (never Infinity in output, R13 / dsp-core rules).
    expect(r.cancellationDb).toBe(CANCELLATION_CAP_DB);
    expect(CANCELLATION_CAP_DB).toBeGreaterThan(PHASE_CANCELLATION_DB);
  });

  it('partial antiphase (R = −0.5·L) is measured but below the threshold', () => {
    const x = sine(200, 0.5);
    const r = mixToMono([x, scaled(x, -0.5)], SR);
    // mean-square channel RMS = sqrt((1 + 0.25)/2)·a, mono = 0.25·a → 20·log10(0.7906/0.25) ≈ 10.0 dB
    expect(r.cancellationDb).toBeCloseTo(10.0, 1);
    expect(r.rule).toBe('average');
    expect(r.warnings).toEqual([]);
  });

  it('silent stereo: no active frames, average rule, cancellation not measurable (null)', () => {
    const z = new Float32Array(SR / 10);
    const r = mixToMono([z, z.slice()], SR);
    expect(r.rule).toBe('average');
    expect(r.cancellationDb).toBeNull();
  });

  it('is deterministic and never emits non-finite samples', () => {
    fc.assert(
      fc.property(fc.float32Array({ minLength: 960, maxLength: 4000, noNaN: true, min: -1, max: 1 }), fc.double({ min: -1, max: 1, noNaN: true }), (l, g) => {
        const r1 = mixToMono([l, scaled(l, g)], SR);
        const r2 = mixToMono([l, scaled(l, g)], SR);
        expect(r1).toEqual(r2);
        expect(r1.pcm.every((v) => Number.isFinite(v))).toBe(true);
      }),
      { numRuns: 30 },
    );
  });

  it('rejects inconsistent input with typed errors', () => {
    expect(() => mixToMono([], SR)).toThrow(DspInputError);
    expect(() => mixToMono([new Float32Array(10), new Float32Array(11)], SR)).toThrow(DspInputError);
    expect(() => mixToMono([new Float32Array(10)], 0)).toThrow(DspInputError);
    // Review I-05a (L4): a single channel with NaN used to pass through.
    expect(() => mixToMono([Float32Array.from([Number.NaN, 0])], SR)).toThrow(DspInputError);
    expect(() => mixToMono([Float32Array.from([Infinity]), Float32Array.from([0])], SR)).toThrow(DspInputError);
  });
});
