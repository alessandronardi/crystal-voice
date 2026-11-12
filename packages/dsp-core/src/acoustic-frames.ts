// Acoustic frames (SPEC §7.3, I-06): one per pitch frame (40 ms every 10 ms
// at 16 kHz), with the I-05a pitch fields, the spectral fields of a Hann-
// windowed FFT in SPECTRAL_LOW_HZ–SPECTRAL_HIGH_HZ, and the decision of the
// primary VAD.
//
// Level (D-V, ADR-0024): before the VAD and the frames, the 16 kHz analysis
// signal is multiplied by one gain for the whole buffer (normalizationGainDb),
// so levels, the VAD and the useful-frame floor do not depend on the
// recording gain. rmsDbfs is therefore the normalized level. Clipping is
// judged on the source samples.
//
// VAD: the engine runs on consecutive 20 ms frames of the same 16 kHz signal
// (SPEC §7.2). A pitch frame takes the decision of the VAD frame that
// contains its centre; a centre inside the incomplete tail has no decision and
// counts as not speech. The VAD only says "a sound is present" (ADR-0023): it
// is a necessary condition for a useful frame, never a sufficient one.
//
// Spectral fields, on the magnitude spectrum |X_k| of the band bins:
//   centroid = Σ f_k|X_k| / Σ |X_k|                    (null if the band is silent)
//   flatness = geometric / arithmetic mean of |X_k|²   (null if the band is silent)
//   flux     = Σ max(0, |X_k|_t − |X_k|_{t−1})         (null on the first frame)
//   bandMagnitude = Σ |X_k|                            (for the gain-free flux scale)
// `null` means "not measurable" and is never turned into 0 (SPEC §7.3, R13).

import {
  ANALYSIS_SAMPLE_RATE,
  PITCH_FRAME_SAMPLES,
  PITCH_HOP_SAMPLES,
  NORMALIZE_MAX_GAIN_DB,
  NORMALIZE_TARGET_DBFS,
  SPECTRAL_FFT_SIZE,
  SPECTRAL_HIGH_HZ,
  SPECTRAL_LOW_HZ,
  VAD_FRAME_SAMPLES,
} from './config.ts';
import { DspInputError } from './errors.ts';
import { quantile } from './stats.ts';
import { createRealFft } from './fft.ts';
import { frameCount } from './frames.ts';
import type { MonoMix } from './mono.ts';
import { analysisInput, pitchFrameAt } from './pitch-track.ts';
import type { VadEngine } from './vad.ts';

export const ACOUSTIC_FRAMES_VERSION = 'acoustic-frames-0';

export interface AcousticFrame {
  frameIndex: number;
  /** First sample at ANALYSIS_SAMPLE_RATE. */
  sampleStart: number;
  sampleLength: number;
  centreSeconds: number;
  vadSpeech: boolean;
  rmsDbfs: number | null;
  f0Hz: number | null;
  pitchConfidence: number | null;
  spectralCentroidHz: number | null;
  spectralFlatness: number | null;
  periodicity: number | null;
  /** Mean square of the frame (linear), 0 on digital silence. */
  envelopeEnergy: number;
  clipped: boolean;
  spectralFlux: number | null;
  bandMagnitude: number;
}

export interface AcousticFrames {
  version: typeof ACOUSTIC_FRAMES_VERSION;
  sourceSampleRate: number;
  channelCount: number;
  mono: Omit<MonoMix, 'pcm'>;
  vadId: string;
  /** Normalization gain applied to the analysis signal (D-V), dB. */
  gainDb: number;
  /** Number of 20 ms frames the VAD decided, and how many it called speech. */
  vadFrames: number;
  vadSpeechFrames: number;
  frames: AcousticFrame[];
}

const BIN_HZ = ANALYSIS_SAMPLE_RATE / SPECTRAL_FFT_SIZE;
const BAND_FROM = Math.ceil(SPECTRAL_LOW_HZ / BIN_HZ);
const BAND_TO = Math.floor(SPECTRAL_HIGH_HZ / BIN_HZ);

/** Periodic Hann window over the pitch frame, built once. */
const HANN = Float64Array.from({ length: PITCH_FRAME_SAMPLES }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / PITCH_FRAME_SAMPLES));

/**
 * Level normalization (D-V): gain in dB that brings the P95 of the 20 ms frame
 * RMS (frames with energy) of the analysis signal to NORMALIZE_TARGET_DBFS,
 * capped at +NORMALIZE_MAX_GAIN_DB. 0 dB when no frame has energy.
 */
export function normalizationGainDb(analysis: Float32Array): number {
  const n = Math.floor(analysis.length / VAD_FRAME_SAMPLES);
  const levels: number[] = [];
  for (let k = 0; k < n; k++) {
    let e = 0;
    for (let i = k * VAD_FRAME_SAMPLES; i < (k + 1) * VAD_FRAME_SAMPLES; i++) e += (analysis[i] ?? 0) ** 2;
    if (e > 0) levels.push(10 * Math.log10(e / VAD_FRAME_SAMPLES));
  }
  const p95 = quantile(levels, 0.95);
  if (p95 === null) return 0;
  return Math.min(NORMALIZE_MAX_GAIN_DB, NORMALIZE_TARGET_DBFS - p95);
}

export function extractAcousticFrames(channels: readonly Float32Array[], sampleRate: number, vad: VadEngine): AcousticFrames {
  if (!vad.primary) throw new DspInputError('BAD_VAD', `${vad.id} is diagnostics-only and must not gate the analysis`);
  const raw = analysisInput(channels, sampleRate);
  const gainDb = normalizationGainDb(raw.analysis);
  const gain = 10 ** (gainDb / 20);
  const analysis = raw.analysis.map((v) => v * gain);
  // Clipping is still judged on the source channels (pitchFrameAt), never on the normalized signal.
  const input = { ...raw, analysis };

  vad.reset();
  const vadCount = Math.floor(analysis.length / VAD_FRAME_SAMPLES);
  const decisions = new Uint8Array(vadCount);
  let vadSpeechFrames = 0;
  for (let j = 0; j < vadCount; j++) {
    const speech = vad.process(analysis.subarray(j * VAD_FRAME_SAMPLES, (j + 1) * VAD_FRAME_SAMPLES)).speech;
    decisions[j] = speech ? 1 : 0;
    if (speech) vadSpeechFrames++;
  }

  const fft = createRealFft(SPECTRAL_FFT_SIZE);
  const windowed = new Float64Array(PITCH_FRAME_SAMPLES);
  let mags = new Float64Array(SPECTRAL_FFT_SIZE / 2 + 1);
  let prev: Float64Array<ArrayBuffer> | null = null;

  const frames: AcousticFrame[] = [];
  const count = frameCount(analysis.length, PITCH_FRAME_SAMPLES, PITCH_HOP_SAMPLES);
  for (let k = 0; k < count; k++) {
    const { pitch, energy, frame } = pitchFrameAt(input, channels, sampleRate, k);
    for (let i = 0; i < PITCH_FRAME_SAMPLES; i++) windowed[i] = (frame[i] ?? 0) * (HANN[i] ?? 0);
    fft.magnitudes(windowed, mags);

    let sum = 0;
    let weighted = 0;
    let power = 0;
    let logPower = 0;
    let zeroBin = false;
    let flux = 0;
    for (let b = BAND_FROM; b <= BAND_TO; b++) {
      const m = mags[b] ?? 0;
      sum += m;
      weighted += m * b * BIN_HZ;
      const p = m * m;
      power += p;
      if (p > 0) logPower += Math.log(p);
      else zeroBin = true;
      if (prev !== null) {
        const d = m - (prev[b] ?? 0);
        if (d > 0) flux += d;
      }
    }
    const bins = BAND_TO - BAND_FROM + 1;
    const silent = sum === 0;
    const flatness = silent ? null : zeroBin ? 0 : Math.exp(logPower / bins) / (power / bins);

    const centreSample = k * PITCH_HOP_SAMPLES + PITCH_FRAME_SAMPLES / 2;
    const vadIndex = Math.floor(centreSample / VAD_FRAME_SAMPLES);
    frames.push({
      frameIndex: k,
      sampleStart: pitch.sampleStart,
      sampleLength: pitch.sampleLength,
      centreSeconds: pitch.centreSeconds,
      vadSpeech: vadIndex < vadCount && decisions[vadIndex] === 1,
      rmsDbfs: pitch.rmsDbfs,
      f0Hz: pitch.f0Hz,
      pitchConfidence: pitch.pitchConfidence,
      spectralCentroidHz: silent ? null : weighted / sum,
      spectralFlatness: flatness === null ? null : Math.min(1, flatness),
      periodicity: pitch.periodicity,
      envelopeEnergy: energy,
      clipped: pitch.clipped,
      spectralFlux: prev === null ? null : flux,
      bandMagnitude: sum,
    });
    // Swap buffers: the current spectrum becomes the previous one.
    const next = prev ?? new Float64Array(SPECTRAL_FFT_SIZE / 2 + 1);
    prev = mags;
    mags = next;
  }
  const { pcm: _pcm, ...monoInfo } = input.mono;
  return {
    version: ACOUSTIC_FRAMES_VERSION,
    sourceSampleRate: sampleRate,
    channelCount: channels.length,
    mono: monoInfo,
    vadId: vad.id,
    gainDb,
    vadFrames: vadCount,
    vadSpeechFrames,
    frames,
  };
}
