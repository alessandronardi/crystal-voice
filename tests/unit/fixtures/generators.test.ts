import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildFixture, FixtureBuildError } from '../../../scripts/fixtures/build.ts';
import { CATALOG, VOICE_A, VOICE_B, type FixtureSpec } from '../../../scripts/fixtures/catalog.ts';
import { createPrng } from '../../../scripts/fixtures/prng.ts';
import { pinkNoise, silence, tone, whiteNoise } from '../../../scripts/fixtures/synth/basic.ts';
import { chords, compress, hardClip } from '../../../scripts/fixtures/synth/music.ts';
import { activeRms, gainToDb, peak, rms } from '../../../scripts/fixtures/synth/signal.ts';
import { synthVoice } from '../../../scripts/fixtures/synth/voice.ts';
import { decodeWav } from '../../../scripts/fixtures/wav.ts';

const spec = (name: string): FixtureSpec => {
  const s = CATALOG.find((x) => x.name === name);
  if (s === undefined) throw new Error(`missing ${name}`);
  return s;
};

function zeroCrossingHz(x: Float64Array, sampleRate: number): number {
  let crossings = 0;
  for (let i = 1; i < x.length; i++) if ((x[i - 1] ?? 0) < 0 && (x[i] ?? 0) >= 0) crossings++;
  return crossings / (x.length / sampleRate);
}

describe('basic generators', () => {
  it('tones have the requested frequency and RMS', () => {
    fc.assert(
      fc.property(fc.integer({ min: 100, max: 400 }), fc.integer({ min: -30, max: -6 }), (f, db) => {
        const x = tone(f, 1, 48000, db);
        expect(Math.abs(zeroCrossingHz(x, 48000) - f)).toBeLessThanOrEqual(1);
        expect(gainToDb(rms(x, 4800, 43200))).toBeCloseTo(db, 1);
      }),
      { numRuns: 20 },
    );
  });

  it('noise hits the target RMS and is seed-deterministic', () => {
    for (const gen of [whiteNoise, pinkNoise]) {
      const a = gen(1, 48000, -20, createPrng(5));
      expect(gainToDb(rms(a))).toBeCloseTo(-20, 6);
      expect(a).toEqual(gen(1, 48000, -20, createPrng(5)));
      expect(a).not.toEqual(gen(1, 48000, -20, createPrng(6)));
    }
  });

  it('silence is all zeros with the exact length', () => {
    const s = silence(2, 44100);
    expect(s).toHaveLength(88200);
    expect(peak(s)).toBe(0);
  });
});

describe('synthetic voice', () => {
  it('truth matches the parameters', () => {
    for (const p of [VOICE_A, VOICE_B]) {
      const { signal, truth } = synthVoice(p, 12, 48000, 1);
      // Jitter and the finite contour move the median slightly: within 3%.
      expect(Math.abs(truth.f0MedianHz / p.f0Hz - 1)).toBeLessThan(0.03);
      // IQR of A·sin(φ) over uniform phase is A·√2; the voiced subset is not uniform, so loose bounds.
      expect(truth.intonationIqrSemitones).toBeGreaterThan(0.5 * p.intonationDepthSemitones);
      expect(truth.intonationIqrSemitones).toBeLessThan(2.5 * p.intonationDepthSemitones);
      expect(truth.syllableCount).toBeGreaterThan(20);
      expect(truth.onsetSamples).toEqual([...truth.onsetSamples].sort((a, b) => a - b));
      expect(truth.onsetSamples.every((s) => s > 0 && s < signal.length)).toBe(true);
      expect(gainToDb(activeRms(signal))).toBeCloseTo(p.levelDbfs, 6);
      expect(signal.every((v) => Number.isFinite(v))).toBe(true);
    }
  });

  it('is equivalent at 44.1 and 48 kHz (same plan, same truth within rounding)', () => {
    const a = synthVoice(VOICE_A, 12, 48000, 9).truth;
    const b = synthVoice(VOICE_A, 12, 44100, 9).truth;
    expect(b.syllableCount).toBe(a.syllableCount);
    expect(b.f0MedianHz).toBeCloseTo(a.f0MedianHz, 1);
    expect(b.intonationIqrSemitones).toBeCloseTo(a.intonationIqrSemitones, 2);
    b.onsetSamples.forEach((s, i) => {
      expect(Math.abs(s / 44100 - (a.onsetSamples[i] ?? 0) / 48000)).toBeLessThan(1 / 44100);
    });
  });

  it('the per-frame f0 track agrees with the reported median and uses null, not 0, when unvoiced', () => {
    const { truth } = synthVoice(VOICE_A, 12, 48000, 1);
    expect(truth.f0Track.hopSamples).toBe(480);
    const voiced = truth.f0Track.valuesHz.filter((v): v is number => v !== null).sort((a, b) => a - b);
    expect(truth.f0Track.valuesHz).toHaveLength(1200);
    expect(truth.f0Track.valuesHz).not.toContain(0);
    expect(voiced.length).toBeGreaterThan(300);
    const mid = voiced[Math.floor(voiced.length / 2)] ?? 0;
    expect(Math.abs(mid / truth.f0MedianHz - 1)).toBeLessThan(0.005);
    // f0 stays within the contour range (± depth semitones, ± jitter).
    const lo = VOICE_A.f0Hz * 2 ** (-VOICE_A.intonationDepthSemitones / 12) * (1 - VOICE_A.jitter);
    const hi = VOICE_A.f0Hz * 2 ** (VOICE_A.intonationDepthSemitones / 12) * (1 + VOICE_A.jitter);
    expect(voiced[0]).toBeGreaterThanOrEqual(lo - 1e-9);
    expect(voiced[voiced.length - 1]).toBeLessThanOrEqual(hi + 1e-9);
  });

  it('rhythm truth sits inside the mapping-0 p6 anchors (2–7 onset/s), not at the edge', () => {
    for (const p of [VOICE_A, VOICE_B]) {
      const r = synthVoice(p, 12, 48000, 1).truth.onsetsPerVoicedSecond;
      expect(r).toBeGreaterThan(3);
      expect(r).toBeLessThan(6);
    }
  });

  it('different seeds give different voices', () => {
    expect(synthVoice(VOICE_A, 3, 48000, 1).signal).not.toEqual(synthVoice(VOICE_A, 3, 48000, 2).signal);
  });
});

describe('effects', () => {
  it('hard clipping reports the clipped fraction and never exceeds full scale', () => {
    const x = tone(200, 1, 48000, -3);
    const { signal, clippedFraction } = hardClip(x, 12);
    expect(peak(signal)).toBe(1);
    expect(clippedFraction).toBeGreaterThan(0.3);
  });

  it('the 4:1 compressor reduces loud parts and leaves parts below threshold untouched', () => {
    const p = { thresholdDbfs: -36, ratio: 4, attackSeconds: 0.005, releaseSeconds: 0.05 };
    const loud = tone(200, 1, 48000, -10);
    const quiet = tone(200, 1, 48000, -50);
    const loudDrop = gainToDb(rms(loud, 9600)) - gainToDb(rms(compress(loud, 48000, p), 9600));
    const quietDrop = gainToDb(rms(quiet, 9600)) - gainToDb(rms(compress(quiet, 48000, p), 9600));
    expect(loudDrop).toBeGreaterThan(15);
    expect(quietDrop).toBeCloseTo(0, 6);
  });

  it('chords are sustained and seed-deterministic', () => {
    const a = chords(4, 48000, 2, createPrng(3));
    expect(a.truth.progression).toHaveLength(2);
    expect(a.signal).toEqual(chords(4, 48000, 2, createPrng(3)).signal);
  });
});

describe('catalog fixtures', () => {
  it('cover every family required by BENCHMARK_PROTOCOL §2', () => {
    const families = new Set(CATALOG.map((s) => s.family));
    const required = [
      'silence', 'tone', 'sweep', 'noise', 'impulses', 'voice', 'voice-variant',
      'clipping', 'antiphase', 'compressed', 'voice-music', 'alternating-ab', 'a-then-b',
    ] as const;
    for (const f of required) expect(families.has(f)).toBe(true);
    const levels = CATALOG.filter((s) => s.family === 'voice-music').map((s) => s.params['musicLevelDbRelativeToVoice']);
    expect(new Set(levels)).toEqual(new Set([-6, -12, -18]));
    expect(CATALOG.some((s) => s.sampleRate === 44100)).toBe(true);
  });

  it('antiphase quantizes to exact opposites (mono sum is digital silence)', () => {
    const { channels } = decodeWav(buildFixture(spec('voice-a-antiphase')).wav);
    const [l, r] = channels;
    if (l === undefined || r === undefined) throw new Error('expected two channels');
    let maxSum = 0;
    l.forEach((v, i) => {
      maxSum = Math.max(maxSum, Math.abs(v + (r[i] ?? 0)));
    });
    expect(maxSum).toBe(0);
    expect(peak(Float64Array.from(l))).toBeGreaterThan(0.01);
  });

  it('voice + music declares the relative music level and the expected warning', () => {
    const out = spec('voice-music-12db-v1').render();
    expect(out.expected['musicLevelDbRelativeToVoice']).toBe(-12);
    expect(out.expected['expectedWarning']).toBe('MIXED_AUDIO_UNCERTAIN');
  });

  it('a single-speaker voice has at least 18 s of syllable nuclei (positive control for I-07)', () => {
    const e = spec('voice-a-long').render().expected;
    expect(e['voicedSeconds']).toBeGreaterThanOrEqual(18);
  });

  it('A/B alternation variants use different speaker pairs, easy to hard', () => {
    const ratios = CATALOG.filter((s) => s.family === 'alternating-ab').map((s) => s.render().expected['f0RatioBToA']);
    expect(ratios).toEqual([1.75, 1.25, 1.1]);
  });

  it('antiphase expected outcomes follow ADR-0016', () => {
    expect(spec('voice-a-antiphase').render().expected['expectedOutcome']).toEqual({ voiceFound: true, warning: 'PHASE_CANCELLATION' });
    expect(spec('voice-a-antiphase-partial').render().expected['expectedOutcome']).toEqual({ voiceFound: true, warning: null });
  });

  it('a-then-b places the change at 8 s', () => {
    expect(spec('a-then-b').render().expected['changeAtSample']).toBe(8 * 48000);
  });

  it('buildFixture rejects unintended clipping with a typed error', () => {
    const bad: FixtureSpec = { ...spec('tone-100hz'), name: 'bad', render: () => ({ channels: [tone(100, 0.1, 48000, 3)], expected: {} }) };
    expect(() => buildFixture(bad)).toThrow(FixtureBuildError);
  });
});
