// Messages on the AudioWorklet port (offscreen ↔ processor). The processor
// reports counts; the offscreen attaches the DSP worker's port and switches
// recording on and off (I-06b, ADR-0025). Audio goes from the processor to
// the worker directly, never through this port.
export const PCM_PROCESSOR_NAME = 'voicecrystal-pcm';

export interface PcmCountMessage {
  /** Samples per channel received since the processor started. */
  samples: number;
}

export type WorkletCommand =
  | { type: 'ATTACH_WORKER'; port: MessagePort }
  | { type: 'RECORD'; record: boolean }
  /** Flush the last block, then send STREAM_END on the worker port: same channel, so nothing arrives after it. */
  | { type: 'END' };

export function isWorkletCommand(value: unknown): value is WorkletCommand {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v['type'] === 'ATTACH_WORKER') return v['port'] instanceof MessagePort;
  if (v['type'] === 'END') return true;
  return v['type'] === 'RECORD' && typeof v['record'] === 'boolean';
}
