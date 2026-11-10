// Pitch track (I-05a): mono mix (ADR-0016) → resampling to 16 kHz → 40 ms
// frames every 10 ms → YIN. Frame positions are in analysis-rate samples;
// `sourceStartSample` maps a frame back to the input rate. Per-frame level and
// clipping are measured on the analysis signal and on the source respectively.
// The full AcousticFrame (centroid, flatness, VAD) is assembled in I-06.

import { ANALYSIS_SAMPLE_RATE, CLIP_THRESHOLD, PITCH_FRAME_SAMPLES, PITCH_HOP_SAMPLES } from './config.ts';
import { frameAt, frameCount } from './frames.ts';
import { mixToMono, validateChannels, type MonoMix } from './mono.ts';
import { createResampler } from './resample.ts';
import { yinFrame } from './yin.ts';

export const PITCH_TRACK_VERSION = 'pitch-yin-0';

export interface PitchFrame {
  frameIndex: number;
  /** First sample of the frame at ANALYSIS_SAMPLE_RATE. */
  sampleStart: number;
  sampleLength: number;
  /** Frame centre in seconds from the start of the input. */
  centreSeconds: number;
  /** null on digital silence (−∞ is never emitted). */
  rmsDbfs: number | null;
  f0Hz: number | null;
  pitchConfidence: number | null;
  periodicity: number | null;
  /** Any source sample of the frame's span at or above CLIP_THRESHOLD, on any channel. */
  clipped: boolean;
}

export interface PitchTrack {
  version: typeof PITCH_TRACK_VERSION;
  sourceSampleRate: number;
  analysisSampleRate: typeof ANALYSIS_SAMPLE_RATE;
  channelCount: number;
  mono: Omit<MonoMix, 'pcm'>;
  frames: PitchFrame[];
}

export function trackPitch(channels: readonly Float32Array[], sampleRate: number): PitchTrack {
  const sourceLength = validateChannels(channels, sampleRate);
  const mono = mixToMono(channels, sampleRate);
  const analysis = createResampler(sampleRate, ANALYSIS_SAMPLE_RATE).process(mono.pcm);
  const ratio = sampleRate / ANALYSIS_SAMPLE_RATE;

  const frames: PitchFrame[] = [];
  const count = frameCount(analysis.length, PITCH_FRAME_SAMPLES, PITCH_HOP_SAMPLES);
  for (let k = 0; k < count; k++) {
    const frame = frameAt(analysis, k, PITCH_FRAME_SAMPLES, PITCH_HOP_SAMPLES);
    let energy = 0;
    for (const v of frame) energy += v * v;
    const rms = Math.sqrt(energy / frame.length);

    const srcFrom = Math.floor(k * PITCH_HOP_SAMPLES * ratio);
    const srcTo = Math.min(sourceLength, Math.ceil((k * PITCH_HOP_SAMPLES + PITCH_FRAME_SAMPLES) * ratio));
    let clipped = false;
    for (const ch of channels) {
      for (let i = srcFrom; i < srcTo && !clipped; i++) if (Math.abs(ch[i] ?? 0) >= CLIP_THRESHOLD) clipped = true;
    }

    const yin = yinFrame(frame, ANALYSIS_SAMPLE_RATE);
    frames.push({
      frameIndex: k,
      sampleStart: k * PITCH_HOP_SAMPLES,
      sampleLength: PITCH_FRAME_SAMPLES,
      centreSeconds: (k * PITCH_HOP_SAMPLES + PITCH_FRAME_SAMPLES / 2) / ANALYSIS_SAMPLE_RATE,
      rmsDbfs: rms > 0 ? 20 * Math.log10(rms) : null,
      f0Hz: yin.f0Hz,
      pitchConfidence: yin.pitchConfidence,
      periodicity: yin.periodicity,
      clipped,
    });
  }
  const { pcm: _pcm, ...monoInfo } = mono;
  return {
    version: PITCH_TRACK_VERSION,
    sourceSampleRate: sampleRate,
    analysisSampleRate: ANALYSIS_SAMPLE_RATE,
    channelCount: channels.length,
    mono: monoInfo,
    frames,
  };
}
