// Declarative list of synthetic fixtures (I-04, BENCHMARK_PROTOCOL §2).
// Adding, removing or changing an entry changes manifest.json: regenerate with
// `pnpm fixtures` and bump FIXTURES_VERSION when a generator's output changes.

import { createPrng } from './prng.ts';
import { impulses, logSweep, pinkNoise, silence, tone, whiteNoise } from './synth/basic.ts';
import { chords, compress, hardClip, type CompressorParams } from './synth/music.ts';
import { activeRms, add, concat, dbToGain, fadeEdges, gainToDb, normalizeTo, scale, samplesFor, type Signal } from './synth/signal.ts';
import { synthVoice, type VoiceParams, type VoiceTruth } from './synth/voice.ts';

export const FIXTURES_VERSION = 'fixtures-1';

export type FixtureFamily =
  | 'silence'
  | 'tone'
  | 'sweep'
  | 'noise'
  | 'impulses'
  | 'voice'
  | 'voice-variant'
  | 'clipping'
  | 'antiphase'
  | 'compressed'
  | 'voice-music'
  | 'alternating-ab'
  | 'a-then-b';

/** JSON-serializable values only: meta files must be byte-stable. */
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export interface RenderedFixture {
  channels: readonly Signal[];
  /** Ground truth for the benchmark (what the pipeline should find). */
  expected: { readonly [key: string]: Json };
}

export interface FixtureSpec {
  name: string;
  family: FixtureFamily;
  description: string;
  sampleRate: number;
  seed: number;
  /** Generation parameters, written verbatim to the meta file. */
  params: { readonly [key: string]: Json };
  /** True only for fixtures that clip on purpose. */
  allowClipping?: true;
  render(): RenderedFixture;
}

export const VOICE_A: VoiceParams = {
  f0Hz: 120,
  intonationDepthSemitones: 2,
  intonationRateHz: 0.25,
  syllableRateHz: 3,
  syllablesPerPhrase: 6,
  phrasePauseSeconds: 0.4,
  formantScale: 1,
  jitter: 0.005,
  breathiness: 0.02,
  levelDbfs: -24,
};

export const VOICE_B: VoiceParams = {
  f0Hz: 210,
  intonationDepthSemitones: 3,
  intonationRateHz: 0.35,
  syllableRateHz: 3.6,
  syllablesPerPhrase: 7,
  phrasePauseSeconds: 0.35,
  formantScale: 1.17,
  jitter: 0.006,
  breathiness: 0.03,
  levelDbfs: -24,
};

const COMPRESSOR: CompressorParams = { thresholdDbfs: -36, ratio: 4, attackSeconds: 0.005, releaseSeconds: 0.05 };

const SR = 48000;
const NO_VOICE = { voiceExpected: false, crystalExpected: false } as const;

const voiceParamsJson = (p: VoiceParams): { [key: string]: Json } => ({ ...p });

function voiceExpected(truth: VoiceTruth, sampleRate: number): { [key: string]: Json } {
  return {
    voiceExpected: true,
    f0MedianHz: truth.f0MedianHz,
    intonationIqrSemitones: truth.intonationIqrSemitones,
    syllableCount: truth.syllableCount,
    onsetsPerVoicedSecond: truth.onsetsPerVoicedSecond,
    voicedSeconds: truth.voicedSeconds,
    onsetSamples: truth.onsetSamples,
    onsetSeconds: truth.onsetSamples.map((s) => s / sampleRate),
    f0Track: { hopSamples: truth.f0Track.hopSamples, valuesHz: truth.f0Track.valuesHz },
  };
}

function voiceFixture(
  name: string,
  family: FixtureFamily,
  description: string,
  params: VoiceParams,
  seconds: number,
  sampleRate: number,
  seed: number,
  gainDb = 0,
): FixtureSpec {
  return {
    name,
    family,
    description,
    sampleRate,
    seed,
    params: { voice: voiceParamsJson(params), seconds, gainDb },
    render() {
      const { signal, truth } = synthVoice(params, seconds, sampleRate, seed);
      return {
        channels: [gainDb === 0 ? signal : scale(signal, dbToGain(gainDb))],
        expected: { ...voiceExpected(truth, sampleRate), activeRmsDbfs: params.levelDbfs + gainDb },
      };
    },
  };
}

function voiceWithMusic(levelDb: number, variant: number, seed: number): FixtureSpec {
  const seconds = 12;
  // Chord length varies by variant (1.5, 2, 3 s, …) so variants differ in more than the seed.
  const chordSeconds = [1.5, 2, 3][(variant - 1) % 3] ?? 2;
  return {
    name: `voice-music-${Math.abs(levelDb)}db-v${variant}`,
    family: 'voice-music',
    description: `Voce A con accordi sintetici sostenuti a ${levelDb} dB rispetto al livello attivo della voce (variante ${variant}).`,
    sampleRate: SR,
    seed,
    params: { voice: voiceParamsJson(VOICE_A), seconds, musicLevelDbRelativeToVoice: levelDb, chordSeconds },
    render() {
      const { signal: voice, truth } = synthVoice(VOICE_A, seconds, SR, seed);
      const music = chords(seconds, SR, chordSeconds, createPrng((seed ^ 0x27d4eb2f) >>> 0));
      const musicScaled = normalizeTo(music.signal, gainToDb(activeRms(voice)) + levelDb);
      return {
        channels: [add(voice, musicScaled)],
        expected: {
          ...voiceExpected(truth, SR),
          musicPresent: true,
          musicLevelDbRelativeToVoice: levelDb,
          expectedWarning: 'MIXED_AUDIO_UNCERTAIN',
          chordProgressionMidi: music.truth.progression,
        },
      };
    },
  };
}

/**
 * Speaker B for the A/B alternation, from easy to hard: f0 ratio to A of 1.75,
 * 1.25 and 1.1, with formant scaling shrinking accordingly.
 */
const ALTERNATING_B: readonly VoiceParams[] = [
  VOICE_B,
  { ...VOICE_B, f0Hz: 150, formantScale: 1.08, intonationDepthSemitones: 2.5 },
  { ...VOICE_B, f0Hz: 132, formantScale: 1.03, intonationDepthSemitones: 2 },
];

function alternatingAB(variant: number, seedA: number, seedB: number): FixtureSpec {
  const voiceB = ALTERNATING_B[(variant - 1) % ALTERNATING_B.length] ?? VOICE_B;
  const seconds = 16;
  const turnSeconds = 2;
  return {
    name: `alternating-ab-v${variant}`,
    family: 'alternating-ab',
    description: `Voci sintetiche A e B alternate a turni di ${turnSeconds} s (variante ${variant}).`,
    sampleRate: SR,
    seed: seedA,
    params: { voiceA: voiceParamsJson(VOICE_A), voiceB: voiceParamsJson(voiceB), seedB, seconds, turnSeconds },
    render() {
      const a = synthVoice(VOICE_A, seconds, SR, seedA).signal;
      const b = synthVoice(voiceB, seconds, SR, seedB).signal;
      const turn = samplesFor(turnSeconds, SR);
      const parts: Signal[] = [];
      const turns: Json[] = [];
      for (let start = 0, k = 0; start < a.length; start += turn, k++) {
        const end = Math.min(a.length, start + turn);
        const speaker = k % 2 === 0 ? 'A' : 'B';
        const src = speaker === 'A' ? a : b;
        parts.push(fadeEdges(src.slice(start, end), samplesFor(0.01, SR)));
        turns.push({ speaker, startSample: start, endSample: end });
      }
      return {
        channels: [concat(...parts)],
        expected: {
          voiceExpected: true,
          speakers: 2,
          f0RatioBToA: voiceB.f0Hz / VOICE_A.f0Hz,
          turns,
          expectedWarning: 'MULTI_SPEAKER_SUSPECTED',
        },
      };
    },
  };
}

function buildCatalog(): FixtureSpec[] {
  const specs: FixtureSpec[] = [
    {
      name: 'silence',
      family: 'silence',
      description: 'Silenzio digitale.',
      sampleRate: SR,
      seed: 0,
      params: { seconds: 5 },
      render: () => ({ channels: [silence(5, SR)], expected: { ...NO_VOICE } }),
    },
    ...[100, 200, 400].map(
      (f): FixtureSpec => ({
        name: `tone-${f}hz`,
        family: 'tone',
        description: `Tono puro a ${f} Hz, −12 dBFS RMS.`,
        sampleRate: SR,
        seed: 0,
        params: { freqHz: f, seconds: 4, levelDbfs: -12 },
        render: () => ({ channels: [tone(f, 4, SR, -12)], expected: { ...NO_VOICE, f0Hz: f } }),
      }),
    ),
    {
      name: 'sweep-80-4000hz',
      family: 'sweep',
      description: 'Sweep logaritmico 80→4000 Hz in 6 s, −15 dBFS RMS.',
      sampleRate: SR,
      seed: 0,
      params: { f0Hz: 80, f1Hz: 4000, seconds: 6, levelDbfs: -15 },
      render: () => ({
        channels: [logSweep(80, 4000, 6, SR, -15)],
        expected: { ...NO_VOICE, law: 'exponential', startHz: 80, endHz: 4000, seconds: 6 },
      }),
    },
    {
      name: 'tone-step-150-300hz',
      family: 'tone',
      description: 'Cambio di frequenza: 2 s a 150 Hz poi 2 s a 300 Hz, −12 dBFS RMS.',
      sampleRate: SR,
      seed: 0,
      params: { freqsHz: [150, 300], secondsEach: 2, levelDbfs: -12 },
      render: () => ({
        channels: [concat(tone(150, 2, SR, -12), tone(300, 2, SR, -12))],
        expected: { ...NO_VOICE, f0Hz: [150, 300], changeAtSample: 2 * SR },
      }),
    },
    {
      name: 'noise-white',
      family: 'noise',
      description: 'Rumore bianco uniforme, −20 dBFS RMS.',
      sampleRate: SR,
      seed: 101,
      params: { seconds: 5, levelDbfs: -20 },
      render: () => ({ channels: [whiteNoise(5, SR, -20, createPrng(101))], expected: { ...NO_VOICE } }),
    },
    {
      name: 'noise-pink',
      family: 'noise',
      description: 'Rumore rosa (filtro di Kellet), −20 dBFS RMS.',
      sampleRate: SR,
      seed: 102,
      params: { seconds: 5, levelDbfs: -20 },
      render: () => ({ channels: [pinkNoise(5, SR, -20, createPrng(102))], expected: { ...NO_VOICE } }),
    },
    {
      name: 'impulses',
      family: 'impulses',
      description: 'Impulsi di un campione ogni 250 ms, picco −3 dBFS.',
      sampleRate: SR,
      seed: 0,
      params: { seconds: 5, intervalSeconds: 0.25, peakDbfs: -3 },
      render() {
        const { signal, positions } = impulses(5, SR, 0.25, -3);
        return { channels: [signal], expected: { ...NO_VOICE, impulseSamples: positions } };
      },
    },
    voiceFixture('voice-a', 'voice', 'Voce sintetica A (f0 120 Hz), riferimento a 48 kHz.', VOICE_A, 12, SR, 1001),
    voiceFixture('voice-a-44k', 'voice-variant', 'Voce A, stessi parametri e seed, a 44,1 kHz.', VOICE_A, 12, 44100, 1001),
    voiceFixture('voice-a-plus6db', 'voice-variant', 'Voce A con guadagno +6 dB.', VOICE_A, 12, SR, 1001, 6),
    voiceFixture('voice-a-minus6db', 'voice-variant', 'Voce A con guadagno −6 dB.', VOICE_A, 12, SR, 1001, -6),
    voiceFixture(
      'voice-a-long',
      'voice',
      'Voce A per 42 s: almeno 18 s di nuclei sillabici di un solo parlante (CONVERGED, MAX_VALID_SPEECH in I-07).',
      VOICE_A,
      42,
      SR,
      1002,
    ),
    voiceFixture('voice-b', 'voice', 'Voce sintetica B (f0 210 Hz, formanti scalate 1,17).', VOICE_B, 12, SR, 2001),
    {
      name: 'voice-a-clipped',
      family: 'clipping',
      description: 'Voce A amplificata di +24 dB e tosata a fondo scala.',
      sampleRate: SR,
      seed: 1001,
      params: { voice: voiceParamsJson(VOICE_A), seconds: 12, gainDb: 24 },
      allowClipping: true,
      render() {
        const { signal, truth } = synthVoice(VOICE_A, 12, SR, 1001);
        const clipped = hardClip(signal, 24);
        return {
          channels: [clipped.signal],
          expected: { ...voiceExpected(truth, SR), clippedFraction: clipped.clippedFraction },
        };
      },
    },
    {
      name: 'voice-a-antiphase',
      family: 'antiphase',
      description: 'Voce A stereo con il canale destro invertito: la somma mono è silenzio.',
      sampleRate: SR,
      seed: 1001,
      params: { voice: voiceParamsJson(VOICE_A), seconds: 12, channels: 2 },
      render() {
        const { signal, truth } = synthVoice(VOICE_A, 12, SR, 1001);
        return {
          channels: [signal, scale(signal, -1)],
          // Mono-mix rule: ADR-0016 (accepted 2026-11-10).
          expected: {
            ...voiceExpected(truth, SR),
            monoSumIsSilent: true,
            expectedOutcome: { voiceFound: true, warning: 'PHASE_CANCELLATION' },
          },
        };
      },
    },
    {
      name: 'voice-a-antiphase-partial',
      family: 'antiphase',
      description: 'Voce A stereo con il canale destro invertito e a metà ampiezza (R = −0,5·L): cancellazione parziale, circa 10 dB.',
      sampleRate: SR,
      seed: 1001,
      params: { voice: voiceParamsJson(VOICE_A), seconds: 12, channels: 2, rightGain: -0.5 },
      render() {
        const { signal, truth } = synthVoice(VOICE_A, 12, SR, 1001);
        return {
          channels: [signal, scale(signal, -0.5)],
          // 20·log10(√((1 + 0.25)/2) / 0.25) ≈ 10.0 dB, below PHASE_CANCELLATION_DB (ADR-0016).
          expected: {
            ...voiceExpected(truth, SR),
            cancellationDbApprox: 10,
            expectedOutcome: { voiceFound: true, warning: null },
          },
        };
      },
    },
    {
      name: 'voice-a-compressed-4to1',
      family: 'compressed',
      description: 'Voce A dopo un compressore 4:1 (soglia −36 dBFS, attacco 5 ms, rilascio 50 ms), senza guadagno di compensazione.',
      sampleRate: SR,
      seed: 1001,
      params: { voice: voiceParamsJson(VOICE_A), seconds: 12, compressor: { ...COMPRESSOR } },
      render() {
        const { signal, truth } = synthVoice(VOICE_A, 12, SR, 1001);
        return { channels: [compress(signal, SR, COMPRESSOR)], expected: { ...voiceExpected(truth, SR) } };
      },
    },
    ...[1, 2].map((v) => voiceWithMusic(-6, v, 3000 + v)),
    ...[1, 2, 3, 4, 5].map((v) => voiceWithMusic(-12, v, 3100 + v)),
    ...[1, 2].map((v) => voiceWithMusic(-18, v, 3200 + v)),
    ...[1, 2, 3].map((v) => alternatingAB(v, 4000 + v, 4100 + v)),
    {
      name: 'a-then-b',
      family: 'a-then-b',
      description: 'Voce A per 8 s seguita dalla voce B per 10 s.',
      sampleRate: SR,
      seed: 5001,
      params: { voiceA: voiceParamsJson(VOICE_A), voiceB: voiceParamsJson(VOICE_B), seedB: 5002, secondsA: 8, secondsB: 10 },
      render() {
        const a = synthVoice(VOICE_A, 8, SR, 5001);
        const b = synthVoice(VOICE_B, 10, SR, 5002);
        return {
          channels: [concat(a.signal, b.signal)],
          expected: {
            voiceExpected: true,
            speakers: 2,
            changeAtSample: a.signal.length,
            changeAtSeconds: a.signal.length / SR,
            voiceA: voiceExpected(a.truth, SR),
            voiceB: voiceExpected(b.truth, SR),
          },
        };
      },
    },
  ];
  const names = new Set<string>();
  for (const s of specs) {
    if (names.has(s.name)) throw new Error(`duplicate fixture name ${s.name}`);
    names.add(s.name);
  }
  return specs;
}

export const CATALOG: readonly FixtureSpec[] = buildCatalog();
