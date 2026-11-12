// I-06a: FFT, acoustic frames, six descriptors, heuristics, confidence (SPEC §7.2–§7.4).
// Pure tests with synthetic frames and a test VAD; the fixture DoD is in
// tests/unit/descriptors-fixtures.test.ts.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as config from '../src/config.ts';
import {
  ACOUSTIC_FRAMES_VERSION,
  assessMusic,
  assessSpeakers,
  bimodalityCoefficient,
  computeDescriptors,
  createRealFft,
  detectOnsets,
  DspInputError,
  EXTRACTOR_VERSION,
  extractAcousticFrames,
  extractDescriptors,
  peakAutocorrelation,
  PITCH_TRACK_VERSION,
  MUSIC_EXPOSED,
  qualitySummary,
  trackPitch,
  twoGroupSplit,
  WEBRTC_VAD_ID,
  type AcousticFrame,
  type VadEngine,
} from '../src/index.ts';
import { normalizationGainDb } from '../src/acoustic-frames.ts';

const SR = 16000;

/** A primary test VAD that calls every frame speech (the real one is tested in tests/unit). */
function alwaysSpeech(id = 'test-always-speech'): VadEngine {
  return { id, primary: true, sampleRate: 16000, frameSamples: 320, process: () => ({ speech: true, probability: null }), reset: () => undefined };
}

function frame(i: number, over: Partial<AcousticFrame> = {}): AcousticFrame {
  return {
    frameIndex: i,
    sampleStart: i * 160,
    sampleLength: 640,
    centreSeconds: (i * 160 + 320) / SR,
    vadSpeech: true,
    rmsDbfs: -20,
    f0Hz: 150,
    pitchConfidence: 0.95,
    spectralCentroidHz: 900,
    spectralFlatness: 0.2,
    periodicity: 0.97,
    envelopeEnergy: 0.01,
    clipped: false,
    spectralFlux: i === 0 ? null : 1,
    bandMagnitude: 10,
    ...over,
  };
}

describe('createRealFft', () => {
  it('finds a cosine in its bin and refuses bad sizes', () => {
    const fft = createRealFft(64);
    const out = new Float64Array(33);
    fft.magnitudes(Float64Array.from({ length: 64 }, (_, i) => Math.cos((2 * Math.PI * 5 * i) / 64)), out);
    expect(out[5]).toBeCloseTo(32, 9);
    expect(out[4]).toBeCloseTo(0, 9);
    expect(() => createRealFft(48)).toThrow(DspInputError);
    expect(() => {
      fft.magnitudes(new Float64Array(65), out);
    }).toThrow(DspInputError);
  });

  it('matches a direct DFT (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 16, maxLength: 16 }), (x) => {
        const out = new Float64Array(9);
        createRealFft(16).magnitudes(x, out);
        for (let k = 0; k <= 8; k++) {
          let re = 0;
          let im = 0;
          x.forEach((v, n) => {
            re += v * Math.cos((2 * Math.PI * k * n) / 16);
            im -= v * Math.sin((2 * Math.PI * k * n) / 16);
          });
          if (Math.abs(Math.hypot(re, im) - (out[k] ?? 0)) > 1e-9) return false;
        }
        return true;
      }),
    );
  });
});

describe('extractAcousticFrames', () => {
  const tone = Float32Array.from({ length: SR }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 1000 * i) / SR));

  it('refuses a diagnostics-only VAD (it must never gate the seed)', () => {
    const prefilter: VadEngine = { ...alwaysSpeech('prefilter'), primary: false };
    expect(() => extractAcousticFrames([tone], SR, prefilter)).toThrow(DspInputError);
  });

  it('measures the centroid of a 1 kHz tone, keeps the I-05a pitch fields and normalizes the level', () => {
    const af = extractAcousticFrames([tone], SR, alwaysSpeech());
    expect(af.version).toBe(ACOUSTIC_FRAMES_VERSION);
    const mid = af.frames[50];
    expect(mid?.spectralCentroidHz).toBeGreaterThan(980);
    expect(mid?.spectralCentroidHz).toBeLessThan(1020);
    expect(mid?.spectralFlatness).toBeLessThan(0.01);
    expect(af.frames[0]?.spectralFlux).toBeNull();
    // Level is normalized (D-V): a sine of RMS −23 dBFS is raised to −20 dBFS.
    expect(af.gainDb).toBeCloseTo(-20 - 20 * Math.log10(0.1 / Math.SQRT2), 6);
    expect(mid?.rmsDbfs).toBeCloseTo(-20, 3);
  });

  it('gives the same frames for any gain, but clipping is judged on the source', () => {
    const a = extractAcousticFrames([tone], SR, alwaysSpeech());
    const b = extractAcousticFrames([tone.map((v) => v * 0.25)], SR, alwaysSpeech());
    a.frames.forEach((f, i) => {
      const g = b.frames[i];
      expect(g?.rmsDbfs ?? 0).toBeCloseTo(f.rmsDbfs ?? 0, 4);
      expect(g?.spectralCentroidHz ?? 0).toBeCloseTo(f.spectralCentroidHz ?? 0, 6);
    });
    const loud = extractAcousticFrames([tone.map((v) => Math.max(-1, Math.min(1, v * 20)))], SR, alwaysSpeech());
    expect(loud.frames.every((f) => f.clipped)).toBe(true);
  });

  it('caps the amplification and leaves silence at 0 dB', () => {
    expect(normalizationGainDb(new Float32Array(3200))).toBe(0);
    expect(normalizationGainDb(new Float32Array(3200).fill(1e-6))).toBe(config.NORMALIZE_MAX_GAIN_DB);
  });

  it('does not change trackPitch (the I-18 E2E digests stay valid)', () => {
    expect(trackPitch([tone], SR).version).toBe(PITCH_TRACK_VERSION);
    expect(trackPitch([tone], SR).frames[10]?.rmsDbfs).toBeCloseTo(20 * Math.log10(0.1 / Math.SQRT2), 3);
  });
});

describe('computeDescriptors', () => {
  it('returns null (never 0) below the minimum amounts', () => {
    const few = Array.from({ length: 150 }, (_, i) => frame(i));
    const d = computeDescriptors(few);
    expect(d.raw.every((v) => v === null)).toBe(true);
    expect(d.missing).toHaveLength(6);
  });

  it('applies the minimums inclusively at their exact boundaries (2 s intonated, 4 s useful)', () => {
    // n intonated frames among 400 useful ones: the rest useful but unpitched.
    const mixed = (intonated: number, useful: number): AcousticFrame[] =>
      Array.from({ length: useful }, (_, i) => (i < intonated ? frame(i) : frame(i, { f0Hz: null, pitchConfidence: null })));
    expect(computeDescriptors(mixed(199, 400)).raw[0]).toBeNull();
    expect(computeDescriptors(mixed(200, 400)).raw[0]).not.toBeNull();
    // p5 needs 4 s of useful frames: 399 → null, 400 → measured.
    expect(computeDescriptors(mixed(200, 399)).raw[4]).toBeNull();
    expect(computeDescriptors(mixed(200, 400)).raw[4]).not.toBeNull();
    // p3 needs both (D-V).
    expect(computeDescriptors(mixed(200, 399)).raw[2]).toBeNull();
    expect(computeDescriptors(mixed(199, 400)).raw[2]).toBeNull();
    expect(computeDescriptors(mixed(200, 400)).raw[2]).not.toBeNull();
  });

  it('computes the SPEC §7.4 formulas on intonated frames (p3, p6 per D-V)', () => {
    // 500 intonated frames (5 s); f0 alternates 100/200 Hz; levels alternate −30/−10 dBFS; onsets every 10 frames.
    const fr = Array.from({ length: 500 }, (_, i) =>
      frame(i, { f0Hz: i % 2 === 0 ? 100 : 200, rmsDbfs: i % 2 === 0 ? -30 : -10, spectralFlux: i === 0 ? null : i % 10 === 0 ? 50 : 0.1 }),
    );
    const d = computeDescriptors(fr);
    expect(d.raw[0]).toBeCloseTo(Math.log2(Math.sqrt(100 * 200)), 12);
    expect(d.raw[1]).toBeCloseTo(12, 12);
    expect(d.raw[2]).toBeCloseTo(20, 12);
    expect(d.raw[3]).toBeCloseTo(0.03, 12);
    expect(d.raw[4]).toBeCloseTo(Math.log2(900), 12);
    expect(d.amounts.onsets).toBe(49);
    expect(d.raw[5]).toBeCloseTo(49 / 5, 12);
  });

  it('keeps onsets at least 80 ms apart, the largest first', () => {
    const fr = Array.from({ length: 40 }, (_, i) => frame(i, { spectralFlux: i === 0 ? null : 0 }));
    const set = (i: number, v: number): void => {
      const f = fr[i];
      if (f) fr[i] = { ...f, spectralFlux: v };
    };
    set(10, 50);
    set(14, 80); // 40 ms after 10: only the larger one survives
    set(22, 50); // 80 ms after 14: kept
    expect(detectOnsets(fr)).toEqual([14, 22]);
  });

  it('never yields NaN or Infinity on arbitrary finite frames (property)', () => {
    const arbFrame = fc.record({
      vadSpeech: fc.boolean(),
      rmsDbfs: fc.option(fc.double({ min: -120, max: 0, noNaN: true }), { nil: null }),
      f0Hz: fc.option(fc.double({ min: 60, max: 1100, noNaN: true }), { nil: null }),
      pitchConfidence: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null }),
      spectralCentroidHz: fc.option(fc.double({ min: 300, max: 4000, noNaN: true }), { nil: null }),
      spectralFlatness: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null }),
      periodicity: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null }),
      spectralFlux: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: null }),
      bandMagnitude: fc.double({ min: 0, max: 100, noNaN: true }),
      clipped: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(arbFrame, { minLength: 0, maxLength: 900 }), (parts) => {
        const fr = parts.map((p, i) => frame(i, p));
        const d = computeDescriptors(fr);
        const m = assessMusic(fr);
        const s = assessSpeakers(fr);
        const values = [...d.raw, m.share, s.bimodality, s.gapSemitones, s.minorGroupShare];
        return values.every((v) => v === null || Number.isFinite(v)) && m.share >= 0 && m.share <= 1;
      }),
      { numRuns: 60 },
    );
  });
});

describe('music heuristic', () => {
  it('marks stable pitch over more than 200 ms, not a moving pitch', () => {
    const stable = Array.from({ length: 100 }, (_, i) => frame(i, { f0Hz: 220 }));
    expect(assessMusic(stable).cueFrames.stablePitch).toBe(100);
    const moving = Array.from({ length: 100 }, (_, i) => frame(i, { f0Hz: 220 * 2 ** (i / 120) })); // 10 cents per frame
    expect(assessMusic(moving).cueFrames.stablePitch).toBe(0);
  });

  it('marks sustained tonal energy without a single pitch, only in runs of 200 ms', () => {
    const fr = Array.from({ length: 100 }, (_, i) =>
      frame(i, { f0Hz: null, pitchConfidence: null, spectralFlatness: 0.01, periodicity: 0.3 }),
    );
    expect(assessMusic(fr).cueFrames.harmonicUnpitched).toBe(100);
    const short = fr.map((f, i) => (i % 15 === 0 ? { ...f, spectralFlatness: 0.5 } : f));
    expect(assessMusic(short).cueFrames.harmonicUnpitched).toBe(0);
  });

  it('marks a periodic flux (a beat every 500 ms) and warns above 20%', () => {
    const fr = Array.from({ length: 800 }, (_, i) => frame(i, { f0Hz: 150 * 2 ** (Math.floor(i / 7) % 5 / 12), spectralFlux: i === 0 ? null : i % 50 === 0 ? 40 : 0.5 }));
    const m = assessMusic(fr);
    expect(m.cueFrames.periodicFlux).toBe(800);
    expect(m.mixedAudioUncertain).toBe(true);
    expect(peakAutocorrelation(new Float64Array(100).fill(3), 1, 10)).toBe(0);
  });
});

describe('several-voices heuristic', () => {
  it('bimodality coefficient: about 1/3 for uniform data, higher for two clusters, null when degenerate', () => {
    const uniform = Array.from({ length: 10000 }, (_, i) => i / 10000);
    expect(bimodalityCoefficient(uniform)).toBeCloseTo(5 / 9, 2);
    const two = Array.from({ length: 1000 }, (_, i) => (i % 2 === 0 ? 0 : 1) + (i % 7) * 0.001);
    expect(bimodalityCoefficient(two) ?? 0).toBeGreaterThan(0.9);
    expect(bimodalityCoefficient([1, 1, 1, 1, 1])).toBeNull();
    expect(bimodalityCoefficient([1, 2, 3])).toBeNull();
  });

  it('splits two groups at the gap', () => {
    expect(twoGroupSplit(Float64Array.from([1, 1.1, 1.2, 5, 5.1, 5.2, 5.3]))).toBe(3);
  });

  it('flags two well-separated pitch groups, not one voice whose pitch moves', () => {
    const two = Array.from({ length: 800 }, (_, i) => frame(i, { f0Hz: (Math.floor(i / 200) % 2 === 0 ? 120 : 210) * (1 + (i % 9) * 0.002) }));
    const s = assessSpeakers(two);
    expect(s.pitchCriterion).toBe(true);
    expect(s.gapSemitones ?? 0).toBeGreaterThan(9);
    // Sinusoidal intonation ±2 st: bimodal (b ≈ 0.66) but the groups are only ~3 st apart (D-T).
    const one = Array.from({ length: 800 }, (_, i) => frame(i, { f0Hz: 120 * 2 ** ((2 * Math.sin((2 * Math.PI * i) / 400)) / 12) }));
    const t = assessSpeakers(one);
    expect(t.bimodality ?? 0).toBeGreaterThan(config.SPEAKER_BIMODALITY);
    expect(t.pitchCriterion).toBe(false);
    expect(t.multiSpeakerSuspected).toBe(false);
  });

  it('flags repeated centroid jumps between 1 s blocks', () => {
    const fr = Array.from({ length: 800 }, (_, i) => frame(i, { f0Hz: 150, spectralCentroidHz: Math.floor(i / 100) % 2 === 0 ? 700 : 1400 }));
    const s = assessSpeakers(fr);
    expect(s.centroidJumps).toBe(7);
    expect(s.centroidCriterion).toBe(true);
  });
});

describe('extractDescriptors', () => {
  const voiceLike = (seconds: number): Float32Array => {
    // 150 Hz pulse-like harmonics with 4 Hz syllable envelope and a slow pitch glide.
    const n = seconds * SR;
    const out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const f0 = 150 * 2 ** ((3 * Math.sin(2 * Math.PI * 0.3 * t)) / 12);
      phase += f0 / SR;
      let s = 0;
      for (let k = 1; k <= 12; k++) s += Math.sin(2 * Math.PI * k * phase) / k;
      const env = Math.max(0, Math.sin(2 * Math.PI * 4 * t)) ** 2;
      out[i] = 0.05 * env * s;
    }
    return out;
  };

  it('gives extractorVersion only with the canonical VAD', () => {
    const x = extractDescriptors([voiceLike(3)], SR, alwaysSpeech());
    expect(x.extractorVersion).toBeNull();
    expect(EXTRACTOR_VERSION).toBe('extractor-0-experimental');
  });

  it('summarizes quality per SPEC §9 and always flags the experimental mapping', () => {
    const x = extractDescriptors([voiceLike(12)], SR, alwaysSpeech());
    const q = qualitySummary(x);
    // Fail closed (review M-3): a non-canonical VAD is never accepted, whatever the status.
    expect(x.extractorVersion).toBeNull();
    expect(q.accepted).toBe(false);
    expect(q.validSpeechMs).toBe(x.amounts.usefulFrames * 10);
    expect(q.droppedFrames).toBe(0);
    expect(q.warnings).toContain('EXPERIMENTAL_MAPPING');
    expect(q.confidence.every((c) => c >= 0 && c <= 1)).toBe(true);
  });
});

describe('extractor-0-experimental fingerprint', () => {
  // Every [H] threshold, window and the VAD are part of extractor-0-experimental
  // (SPEC §7.4, packages/dsp-core/CLAUDE.md). If this test fails, a value
  // changed: bump EXTRACTOR_VERSION and update the fingerprint deliberately.
  it('has not changed without a new extractorVersion', () => {
    const values = Object.fromEntries(
      Object.entries(config)
        .filter(([, v]) => typeof v === 'number')
        .sort(([a], [b]) => a.localeCompare(b)),
    );
    expect({ version: EXTRACTOR_VERSION, vad: WEBRTC_VAD_ID, musicExposed: [...MUSIC_EXPOSED], values }).toMatchInlineSnapshot(`
      {
        "musicExposed": [
          "p2_intonation",
          "p3_dynamics",
          "p4_roughness",
          "p6_rhythm",
        ],
        "vad": "webrtc-fvad-0",
        "values": {
          "ACTIVE_FRAME_DBFS": -60,
          "ANALYSIS_SAMPLE_RATE": 16000,
          "CANCELLATION_CAP_DB": 120,
          "CLIP_THRESHOLD": 0.999969482421875,
          "F0_MAX_HZ": 1100,
          "F0_MIN_HZ": 60,
          "F0_RANGE_TOLERANCE": 0.005,
          "FRAME_HOP_SECONDS": 0.01,
          "FVAD_MODE": 2,
          "INTONATED_MAX_HZ": 500,
          "INTONATED_MIN_CONFIDENCE": 0.8,
          "INTONATED_MIN_HZ": 60,
          "MAX_VEILED_PARAMETERS": 2,
          "MIN_INTONATED_SECONDS": 2,
          "MIN_ONSETS": 20,
          "MIN_USEFUL_SECONDS": 4,
          "MONO_CHECK_FRAME_SECONDS": 0.02,
          "MUSIC_FLUX_MAX_LAG_SECONDS": 2,
          "MUSIC_FLUX_MIN_LAG_SECONDS": 0.3,
          "MUSIC_FLUX_PERIODICITY": 0.5,
          "MUSIC_FLUX_WINDOW_SECONDS": 4,
          "MUSIC_HARMONIC_MAX_FLATNESS": 0.05,
          "MUSIC_HARMONIC_MIN_FRAMES": 20,
          "MUSIC_SHARE_THRESHOLD": 0.2,
          "MUSIC_STABLE_CENTS": 25,
          "MUSIC_STABLE_MIN_FRAMES": 21,
          "NORMALIZE_MAX_GAIN_DB": 40,
          "NORMALIZE_TARGET_DBFS": -20,
          "ONSET_FLUX_THRESHOLD": 0.3,
          "ONSET_MIN_DISTANCE_SECONDS": 0.08,
          "PHASE_CANCELLATION_DB": 20,
          "PITCH_FRAME_SAMPLES": 640,
          "PITCH_HOP_SAMPLES": 160,
          "PREFILTER_HIGH_HZ": 3400,
          "PREFILTER_LOW_HZ": 85,
          "PREFILTER_MIN_BAND_RATIO": 0.6,
          "PREFILTER_MIN_DBFS": -50,
          "RESAMPLE_CUTOFF": 0.9,
          "RESAMPLE_HALF_TAPS": 32,
          "RESAMPLE_KAISER_BETA": 9,
          "SPEAKER_BIMODALITY": 0.555,
          "SPEAKER_BLOCK_SECONDS": 1,
          "SPEAKER_CENTROID_JUMP_OCTAVES": 0.3,
          "SPEAKER_MIN_GAP_SEMITONES": 6,
          "SPEAKER_MIN_GROUP_SHARE": 0.2,
          "SPEAKER_MIN_JUMP_SHARE": 0.6,
          "SPEAKER_MIN_SECONDS": 4,
          "SPEAKER_MIN_TRANSITIONS": 4,
          "SPECTRAL_FFT_SIZE": 1024,
          "SPECTRAL_HIGH_HZ": 4000,
          "SPECTRAL_LOW_HZ": 300,
          "USEFUL_MIN_DBFS": -60,
          "VAD_FRAME_SAMPLES": 320,
          "VEIL_CONFIDENCE": 0.5,
          "YIN_SEARCH_MAX_HZ": 2200,
          "YIN_THRESHOLD": 0.15,
        },
        "version": "extractor-0-experimental",
      }
    `);
  });
});
