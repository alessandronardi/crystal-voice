// The DSP worker's computation on a decoded file (I-18): dsp-core outputs
// reduced to statistics and digests, never samples.
import { createHash } from 'node:crypto';
import { createResampler, mixToMono, signalSummary, trackPitch, type PitchTrack } from '@voicecrystal/dsp-core';
import { describe, expect, it } from 'vitest';
import { analyzePcm, float32Bytes, pitchFieldBytes, pitchTrackBytes, sha256Hex } from '../src/shared/pcm-analysis.ts';
import { loadFvad } from '../../tests/benchmarks/fvad-loader.ts';

const fvad = loadFvad().fvad;

function voiceLike(seconds: number, rate: number, f0: number): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => {
    const t = i / rate;
    let v = 0;
    for (let h = 1; h <= 8; h++) v += Math.sin(2 * Math.PI * f0 * h * t) / h;
    return 0.2 * v;
  });
}

describe('analyzePcm', () => {
  it('equals the dsp-core functions it wraps, and hashes with standard SHA-256', async () => {
    const rate = 44100;
    const channels = [voiceLike(1.5, rate, 140), voiceLike(1.5, rate, 140).map((v) => v * 0.5)];
    const result = await analyzePcm(channels, rate, fvad);
    expect(result.channels).toEqual(channels.map((c) => signalSummary(c, rate)));
    const mono = mixToMono(channels, rate);
    const analysis = createResampler(rate, 16000).process(mono.pcm);
    expect(result.analysis.length).toBe(analysis.length);
    expect(result.analysis.sha256).toBe(createHash('sha256').update(Buffer.from(analysis.buffer)).digest('hex'));
    const track = trackPitch(channels, rate);
    expect(result.pitch.frames).toBe(track.frames.length);
    expect(result.pitch.sha256).toBe(createHash('sha256').update(pitchTrackBytes(track)).digest('hex'));
    expect(result.pitch.medianF0Hz).toBeGreaterThan(135);
    expect(result.pitch.medianF0Hz).toBeLessThan(145);
    expect(result.mono).toMatchObject({ rule: 'average', warnings: [] });
    expect(result).toMatchObject({ sourceSampleRate: rate, channelCount: 2, sourceFrames: channels[0]?.length });
    // Per-field digests use the same encoding as the whole track.
    for (const field of ['rmsDbfs', 'f0Hz', 'pitchConfidence', 'periodicity', 'clipped'] as const) {
      expect(result.pitch.fieldSha256[field], field).toBe(createHash('sha256').update(pitchFieldBytes(track, field)).digest('hex'));
    }
    // Fields are not required to differ: on this clean signal confidence
    // (1 − d′ at the chosen τ) and periodicity (1 − min d′) coincide, because
    // the chosen τ is the global minimum.
    expect(result.pitch.fieldSha256.f0Hz).not.toBe(result.pitch.fieldSha256.rmsDbfs);
    // No sample in the result: only numbers of bounded count.
    expect(JSON.stringify(result).length).toBeLessThan(2500);
  });

  it('is deterministic and changes with a single bit of input', async () => {
    const pcm = voiceLike(0.5, 16000, 200);
    const a = await analyzePcm([pcm], 16000, fvad);
    expect(await analyzePcm([pcm.slice()], 16000, fvad)).toEqual(a);
    const flipped = pcm.slice();
    const bits = new Uint32Array(flipped.buffer);
    bits[4000] = (bits[4000] ?? 0) ^ 1;
    const b = await analyzePcm([flipped], 16000, fvad);
    expect(b.analysis.sha256).not.toBe(a.analysis.sha256);
  });

  it('rejects invalid input with dsp-core errors', async () => {
    await expect(analyzePcm([new Float32Array([0, Number.NaN])], 16000, fvad)).rejects.toMatchObject({ name: 'DspInputError' });
    await expect(analyzePcm([], 16000, fvad)).rejects.toMatchObject({ name: 'DspInputError' });
  });
});

describe('canonical bytes', () => {
  it('a null field and a 0 field give different bytes (R13)', () => {
    const frame = {
      frameIndex: 0,
      sampleStart: 0,
      sampleLength: 640,
      centreSeconds: 0.02,
      rmsDbfs: null,
      f0Hz: null,
      pitchConfidence: null,
      periodicity: null,
      clipped: false,
    };
    const track = (f0Hz: number | null): PitchTrack => ({
      version: 'pitch-yin-0',
      sourceSampleRate: 16000,
      analysisSampleRate: 16000,
      channelCount: 1,
      mono: { rule: 'single-channel', channelIndex: null, cancellationDb: null, warnings: [] },
      frames: [{ ...frame, f0Hz }],
    });
    expect(pitchTrackBytes(track(null))).not.toEqual(pitchTrackBytes(track(0)));
    expect(pitchTrackBytes(track(0))).not.toEqual(pitchTrackBytes(track(-0)));
  });

  it('Float32 bytes are little-endian and SHA-256 matches node:crypto', async () => {
    expect([...float32Bytes(new Float32Array([1]))]).toEqual([0x00, 0x00, 0x80, 0x3f]);
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
  });
});
