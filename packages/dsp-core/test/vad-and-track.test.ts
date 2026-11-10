import { describe, expect, it } from 'vitest';
import { synthVoice } from '../../../scripts/fixtures/synth/voice.ts';
import { VOICE_A } from '../../../scripts/fixtures/catalog.ts';
import { createBandEnergyPrefilter, DspInputError, PITCH_TRACK_VERSION, trackPitch, VAD_FRAME_SAMPLES } from '../src/index.ts';

const SR = 16000;
const tone = (f: number, amp: number): Float32Array =>
  Float32Array.from({ length: VAD_FRAME_SAMPLES }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / SR));

describe('band-energy pre-filter', () => {
  it('declares itself diagnostics-only (never the main VAD, SPEC §7.2)', () => {
    const v = createBandEnergyPrefilter();
    expect(v.primary).toBe(false);
    expect(v.sampleRate).toBe(16000);
    expect(v.frameSamples).toBe(320);
  });

  it('flags in-band tones, not out-of-band ones or quiet frames; probability stays null', () => {
    const v = createBandEnergyPrefilter();
    for (let i = 0; i < 5; i++) v.process(tone(500, 0.3)); // settle the filter
    expect(v.process(tone(500, 0.3))).toEqual({ speech: true, probability: null });
    v.reset();
    for (let i = 0; i < 5; i++) v.process(tone(6000, 0.3));
    expect(v.process(tone(6000, 0.3)).speech).toBe(false);
    v.reset();
    expect(v.process(tone(500, 0.0005)).speech).toBe(false);
  });

  it('rejects frames of the wrong size', () => {
    expect(() => createBandEnergyPrefilter().process(new Float32Array(10))).toThrow(DspInputError);
  });
});

describe('trackPitch', () => {
  const { signal, truth } = synthVoice(VOICE_A, 6, 48000, 1);
  const pcm = Float32Array.from(signal);
  const track = trackPitch([pcm], 48000);

  it('reports source and analysis metadata and the mono rule', () => {
    expect(track.version).toBe(PITCH_TRACK_VERSION);
    expect(track.sourceSampleRate).toBe(48000);
    expect(track.analysisSampleRate).toBe(16000);
    expect(track.channelCount).toBe(1);
    expect(track.mono.rule).toBe('single-channel');
    expect(track.frames.length).toBe(597);
  });

  it('follows the true f0 on frames voiced in both (smoke test; full M2 in pnpm bench)', () => {
    const errors: number[] = [];
    for (const fr of track.frames) {
      const truthIndex = Math.round(fr.centreSeconds * 100);
      const t = truth.f0Track.valuesHz[truthIndex];
      if (fr.f0Hz !== null && t !== null && t !== undefined) errors.push(Math.abs(fr.f0Hz / t - 1));
    }
    errors.sort((a, b) => a - b);
    expect(errors.length).toBeGreaterThan(150);
    expect(errors[Math.floor(errors.length / 2)] ?? 1).toBeLessThan(0.02);
  });

  it('is bit-for-bit deterministic', () => {
    expect(trackPitch([pcm], 48000)).toEqual(track);
  });

  it('applies the ADR-0016 fallback on antiphase stereo', () => {
    const inverted = pcm.map((v) => -v);
    const t = trackPitch([pcm, inverted], 48000);
    expect(t.mono.rule).toBe('channel-fallback');
    expect(t.mono.warnings).toEqual(['PHASE_CANCELLATION']);
    expect(t.frames.map((f) => f.f0Hz)).toEqual(track.frames.map((f) => f.f0Hz));
  });
});
