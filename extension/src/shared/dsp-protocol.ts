// Messages between a host page and the DSP worker (ADR-0001, ADR-0022). The
// host transfers the channels (no copy); the worker answers with statistics
// and digests only, never samples (SPEC §9, AGENTS.md R1). Today the only
// host is the side panel, for local files (I-18); the offscreen will use the
// same worker for the tab and the microphone once the DSP runs there (I-06).
import type { DspInputErrorCode } from '@voicecrystal/dsp-core';
import type { PcmAnalysis } from './pcm-analysis.ts';

export interface AnalyzePcmRequest {
  type: 'ANALYZE_PCM';
  sampleRate: number;
  /** One per channel, all the same length; transferred to the worker. */
  channels: Float32Array[];
}

/** Why the worker could not analyse: dsp-core's input errors, or a malformed request. */
export type DspFailureCode = DspInputErrorCode | 'BAD_REQUEST' | 'INTERNAL';

export type DspWorkerReply =
  | { type: 'ANALYSIS_DONE'; analysis: PcmAnalysis }
  | { type: 'ANALYSIS_FAILED'; code: DspFailureCode };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isAnalyzePcmRequest(value: unknown): value is AnalyzePcmRequest {
  if (!isRecord(value) || value['type'] !== 'ANALYZE_PCM') return false;
  const channels = value['channels'];
  return (
    Number.isSafeInteger(value['sampleRate']) &&
    (value['sampleRate'] as number) > 0 &&
    Array.isArray(channels) &&
    channels.length > 0 &&
    channels.every((c) => c instanceof Float32Array)
  );
}

/** Shape check of the worker's reply: the worker is ours, but a message is still a message. */
export function isDspWorkerReply(value: unknown): value is DspWorkerReply {
  if (!isRecord(value)) return false;
  if (value['type'] === 'ANALYSIS_FAILED') return typeof value['code'] === 'string';
  if (value['type'] !== 'ANALYSIS_DONE' || !isRecord(value['analysis'])) return false;
  const a = value['analysis'];
  return (
    typeof a['version'] === 'string' &&
    Number.isSafeInteger(a['sourceSampleRate']) &&
    Number.isSafeInteger(a['channelCount']) &&
    Array.isArray(a['channels']) &&
    isRecord(a['mono']) &&
    isRecord(a['analysis']) &&
    isRecord(a['pitch'])
  );
}
