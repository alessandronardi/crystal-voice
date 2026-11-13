// Messages between a host page and the DSP worker (ADR-0001, ADR-0022,
// ADR-0025). The worker answers with statistics, digests and descriptors
// only, never samples (SPEC §9, AGENTS.md R1).
//  - Local file (side panel, I-18): ANALYZE_PCM with the transferred
//    channels → ANALYSIS_DONE | ANALYSIS_FAILED.
//  - Tab or microphone (offscreen, I-06b): STREAM_BEGIN hands over a
//    MessagePort on which the AudioWorklet posts PcmBlock messages while the
//    session listens; STREAM_END asks for the analysis of everything received
//    → STREAM_RESULT. The samples stay in the worker's RAM until it ends.
//  - I-07 (ADR-0026): while the stream runs, the worker analyses the audio so
//    far once per whole second and answers STREAM_PROGRESS (valid speech and
//    the split-half evaluations, numbers only).
import { isCrystalSeed, SPLIT_HALF_BLOCKS, type CrystalSeed } from '@voicecrystal/contracts';
import type { DspInputErrorCode } from '@voicecrystal/dsp-core';
import type { DescriptorAnalysis } from './descriptor-analysis.ts';
import type { PcmAnalysis } from './pcm-analysis.ts';
import type { SplitHalfEvaluation } from './split-half-rule.ts';

export interface AnalyzePcmRequest {
  type: 'ANALYZE_PCM';
  sampleRate: number;
  /** One per channel, all the same length; transferred to the worker. */
  channels: Float32Array[];
}

export interface StreamBeginRequest {
  type: 'STREAM_BEGIN';
  sampleRate: number;
  /** The worklet's end is the other port of this channel. */
  port: MessagePort;
}

export interface StreamEndRequest {
  type: 'STREAM_END';
}

export type DspWorkerRequest = AnalyzePcmRequest | StreamBeginRequest | StreamEndRequest;

/** One block from the AudioWorklet: one array per channel, all the same length (transferred). */
export interface PcmBlock {
  channels: Float32Array[];
}

/** Why the worker could not analyse: dsp-core's input errors, libfvad missing, or a malformed request. */
export type DspFailureCode = DspInputErrorCode | 'VAD_UNAVAILABLE' | 'BAD_REQUEST' | 'INTERNAL';

export interface StreamStats {
  /** Sample frames per channel kept for the analysis. */
  frames: number;
  /** Sample frames per channel refused: over the cap, or a block with another channel count or malformed. */
  droppedFrames: number;
  channelCount: number;
}

/** I-07: the latest analysis of the audio so far (ADR-0026). */
export interface StreamProgress {
  /** Whole seconds of source audio analysed. */
  audioSeconds: number;
  validSpeechMs: number;
  evaluations: number;
  last: SplitHalfEvaluation | null;
  converged: boolean;
  /** I-13a: seed of the audio so far with the current estimates (germ only); null until measurable. */
  provisionalSeed: CrystalSeed | null;
  /** Time of this analysis in the worker, ms (measured for BENCHMARK_PROTOCOL §7). */
  analysisMs: number;
  /** Set when the evaluation failed: no further evaluation runs, the session goes on to its limits. */
  failure: DspFailureCode | null;
}

export type DspWorkerReply =
  | { type: 'ANALYSIS_DONE'; analysis: PcmAnalysis }
  | { type: 'ANALYSIS_FAILED'; code: DspFailureCode }
  | { type: 'STREAM_RESULT'; analysis: DescriptorAnalysis | null; failure: DspFailureCode | null; stats: StreamStats }
  | { type: 'STREAM_PROGRESS'; progress: StreamProgress };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const positiveInteger = (v: unknown): boolean => Number.isSafeInteger(v) && (v as number) > 0;

export function isAnalyzePcmRequest(value: unknown): value is AnalyzePcmRequest {
  if (!isRecord(value) || value['type'] !== 'ANALYZE_PCM') return false;
  const channels = value['channels'];
  return (
    positiveInteger(value['sampleRate']) &&
    Array.isArray(channels) &&
    channels.length > 0 &&
    channels.every((c) => c instanceof Float32Array)
  );
}

export function isStreamBeginRequest(value: unknown): value is StreamBeginRequest {
  return isRecord(value) && value['type'] === 'STREAM_BEGIN' && positiveInteger(value['sampleRate']) && value['port'] instanceof MessagePort;
}

export function isStreamEndRequest(value: unknown): value is StreamEndRequest {
  return isRecord(value) && value['type'] === 'STREAM_END';
}

/** A block is well formed when it has 1–8 channels of one common, non-zero length. */
export function isPcmBlock(value: unknown): value is PcmBlock {
  if (!isRecord(value)) return false;
  const channels = value['channels'];
  if (!Array.isArray(channels) || channels.length === 0 || channels.length > 8) return false;
  const first: unknown = channels[0];
  if (!(first instanceof Float32Array) || first.length === 0) return false;
  return channels.every((c) => c instanceof Float32Array && c.length === first.length);
}

function isDescriptorAnalysis(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value['status'] === 'OK' || value['status'] === 'INSUFFICIENT_DATA') &&
    typeof value['mappingVersion'] === 'string' &&
    Array.isArray(value['raw']) &&
    (value['seed'] === null || Array.isArray(value['seed'])) &&
    isRecord(value['quality'])
  );
}

const nonNegative = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const count = (v: unknown): boolean => Number.isSafeInteger(v) && (v as number) >= 0;

function isEvaluation(value: unknown): value is SplitHalfEvaluation {
  if (!isRecord(value)) return false;
  const d = value['differences'];
  const blocked = value['blockedBy'];
  return (
    count(value['seconds']) &&
    Array.isArray(d) &&
    d.length === 6 &&
    d.every((x) => x === null || nonNegative(x)) &&
    (value['s'] === null || nonNegative(value['s'])) &&
    typeof value['passed'] === 'boolean' &&
    (blocked === null || (typeof blocked === 'string' && (SPLIT_HALF_BLOCKS as readonly string[]).includes(blocked))) &&
    value['passed'] === (blocked === null) &&
    count(value['consecutive'])
  );
}

export function isStreamProgress(value: unknown): value is StreamProgress {
  if (!isRecord(value)) return false;
  return (
    count(value['audioSeconds']) &&
    nonNegative(value['validSpeechMs']) &&
    count(value['evaluations']) &&
    (value['last'] === null || isEvaluation(value['last'])) &&
    typeof value['converged'] === 'boolean' &&
    (value['provisionalSeed'] === null || isCrystalSeed(value['provisionalSeed'])) &&
    nonNegative(value['analysisMs']) &&
    (value['failure'] === null || typeof value['failure'] === 'string')
  );
}

/** Shape check of the worker's reply: the worker is ours, but a message is still a message. */
export function isDspWorkerReply(value: unknown): value is DspWorkerReply {
  if (!isRecord(value)) return false;
  if (value['type'] === 'ANALYSIS_FAILED') return typeof value['code'] === 'string';
  if (value['type'] === 'STREAM_PROGRESS') return isStreamProgress(value['progress']);
  if (value['type'] === 'STREAM_RESULT') {
    const stats = value['stats'];
    return (
      (value['analysis'] === null || isDescriptorAnalysis(value['analysis'])) &&
      (value['failure'] === null || typeof value['failure'] === 'string') &&
      isRecord(stats) &&
      Number.isSafeInteger(stats['frames']) &&
      Number.isSafeInteger(stats['droppedFrames']) &&
      Number.isSafeInteger(stats['channelCount'])
    );
  }
  if (value['type'] !== 'ANALYSIS_DONE' || !isRecord(value['analysis'])) return false;
  const a = value['analysis'];
  return (
    typeof a['version'] === 'string' &&
    Number.isSafeInteger(a['sourceSampleRate']) &&
    Number.isSafeInteger(a['channelCount']) &&
    Array.isArray(a['channels']) &&
    isRecord(a['mono']) &&
    isRecord(a['analysis']) &&
    isRecord(a['pitch']) &&
    isDescriptorAnalysis(a['descriptors'])
  );
}
