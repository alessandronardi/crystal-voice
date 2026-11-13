// What the DSP worker computes on a decoded file: the same dsp-core functions
// as the offline harness, reduced to statistics and digests, and since I-06b
// the descriptors and seed of extractor-0 (descriptor-analysis.ts). No sample ever leaves this function's
// result (SPEC §9, AGENTS.md R1): the analysis signal is returned as a
// SHA-256, the pitch track as a SHA-256 of a canonical byte layout.
//
// Used by dsp-worker.ts in the browser and, unchanged, by the E2E test in
// Node to compute the reference: equal digests mean bit-identical results
// (BACKLOG I-18, decision D4 of 2026-11-12). Only dsp-core and the standard
// WebCrypto API, available in workers and in Node.
import {
  ANALYSIS_SAMPLE_RATE,
  PITCH_TRACK_VERSION,
  SIGNAL_SUMMARY_VERSION,
  createResampler,
  median,
  mixToMono,
  signalSummary,
  trackPitch,
  type FvadModule,
  type MonoRule,
  type PitchTrack,
  type SignalSummary,
} from '@voicecrystal/dsp-core';
import type { QualityWarning } from '@voicecrystal/contracts';
import { analyzeDescriptors, type DescriptorAnalysis } from './descriptor-analysis.ts';

/** Layout version of the digests below: change it if the byte layout changes. */
export const PCM_ANALYSIS_VERSION = 'pcm-analysis-1';

export interface PcmAnalysis {
  version: typeof PCM_ANALYSIS_VERSION;
  analyzers: [typeof SIGNAL_SUMMARY_VERSION, typeof PITCH_TRACK_VERSION];
  sourceSampleRate: number;
  channelCount: number;
  /** Frames per channel at the source rate. */
  sourceFrames: number;
  /** One per source channel, at the source rate. */
  channels: SignalSummary[];
  mono: { rule: MonoRule; channelIndex: number | null; cancellationDb: number | null; warnings: QualityWarning[] };
  /** The mono signal resampled to the analysis rate (ADR-0016, SPEC §7.1). */
  analysis: { sampleRate: number; length: number; sha256: string };
  pitch: {
    frames: number;
    voicedFrames: number;
    medianF0Hz: number | null;
    /** Median of the per-frame levels, dBFS. */
    medianRmsDbfs: number | null;
    sha256: string;
    /**
     * One digest per field, same encoding: tells which field differs when the
     * whole-track digest does. `rmsDbfs` goes through Math.log10, which is not
     * bit-identical across V8 versions (BENCHMARK_PROTOCOL §7, I-18); the
     * others are arithmetic only.
     */
    fieldSha256: Record<PitchField, string>;
  };
  /** extractor-0-experimental with libfvad and the mapping-0 seed (I-06b). */
  descriptors: DescriptorAnalysis;
}

export type PitchField = 'rmsDbfs' | 'f0Hz' | 'pitchConfidence' | 'periodicity' | 'clipped';
const PITCH_FIELDS: readonly PitchField[] = ['rmsDbfs', 'f0Hz', 'pitchConfidence', 'periodicity', 'clipped'];

/** Canonical bytes of one field of a pitch track, with the same null flag as pitchTrackBytes. */
export function pitchFieldBytes(track: PitchTrack, field: PitchField): Uint8Array {
  const out = new Uint8Array(track.frames.length * 9);
  const view = new DataView(out.buffer);
  track.frames.forEach((frame, i) => {
    const value = field === 'clipped' ? (frame.clipped ? 1 : 0) : frame[field];
    view.setUint8(i * 9, value === null ? 0 : 1);
    view.setFloat64(i * 9 + 1, value ?? 0, true);
  });
  return out;
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // A copy into a plain ArrayBuffer: subtle.digest refuses shared memory views.
  return hex(await crypto.subtle.digest('SHA-256', bytes.slice()));
}

/** Little-endian bytes of a Float32 signal, independent of the platform's byte order. */
export function float32Bytes(pcm: Float32Array): Uint8Array {
  const out = new Uint8Array(pcm.length * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < pcm.length; i++) view.setFloat32(i * 4, pcm[i] ?? 0, true);
  return out;
}

/** Per frame: index, start (uint32), then rms, f0, confidence, periodicity as (flag byte, float64), then clipped. */
const FRAME_BYTES = 4 + 4 + 4 * 9 + 1;

/**
 * Canonical bytes of a pitch track. A null value is a flag byte 0 followed by
 * eight zero bytes; a number is flag 1 and its float64. So null and 0 differ
 * (AGENTS.md R13).
 */
export function pitchTrackBytes(track: PitchTrack): Uint8Array {
  const out = new Uint8Array(track.frames.length * FRAME_BYTES);
  const view = new DataView(out.buffer);
  let p = 0;
  const nullable = (value: number | null): void => {
    view.setUint8(p, value === null ? 0 : 1);
    view.setFloat64(p + 1, value ?? 0, true);
    p += 9;
  };
  for (const frame of track.frames) {
    view.setUint32(p, frame.frameIndex, true);
    view.setUint32(p + 4, frame.sampleStart, true);
    p += 8;
    nullable(frame.rmsDbfs);
    nullable(frame.f0Hz);
    nullable(frame.pitchConfidence);
    nullable(frame.periodicity);
    view.setUint8(p, frame.clipped ? 1 : 0);
    p += 1;
  }
  return out;
}

/** Runs the analysis; throws dsp-core's DspInputError on invalid input. */
export async function analyzePcm(channels: readonly Float32Array[], sampleRate: number, fvad: FvadModule): Promise<PcmAnalysis> {
  const summaries = channels.map((ch) => signalSummary(ch, sampleRate));
  const mono = mixToMono(channels, sampleRate);
  const analysis = createResampler(sampleRate, ANALYSIS_SAMPLE_RATE).process(mono.pcm);
  const track = trackPitch(channels, sampleRate);
  const voiced = track.frames.flatMap((f) => (f.f0Hz === null ? [] : [f.f0Hz]));
  const levels = track.frames.flatMap((f) => (f.rmsDbfs === null ? [] : [f.rmsDbfs]));
  const fieldSha256 = {} as Record<PitchField, string>;
  for (const field of PITCH_FIELDS) fieldSha256[field] = await sha256Hex(pitchFieldBytes(track, field));
  return {
    version: PCM_ANALYSIS_VERSION,
    analyzers: [SIGNAL_SUMMARY_VERSION, PITCH_TRACK_VERSION],
    sourceSampleRate: sampleRate,
    channelCount: channels.length,
    sourceFrames: channels[0]?.length ?? 0,
    channels: summaries,
    mono: {
      rule: mono.rule,
      channelIndex: mono.channelIndex,
      cancellationDb: mono.cancellationDb,
      warnings: [...mono.warnings],
    },
    analysis: { sampleRate: ANALYSIS_SAMPLE_RATE, length: analysis.length, sha256: await sha256Hex(float32Bytes(analysis)) },
    pitch: {
      frames: track.frames.length,
      voicedFrames: voiced.length,
      medianF0Hz: median(voiced),
      medianRmsDbfs: median(levels),
      sha256: await sha256Hex(pitchTrackBytes(track)),
      fieldSha256,
    },
    descriptors: await analyzeDescriptors(channels, sampleRate, fvad),
  };
}
