// Messages on the AudioWorklet port (offscreen ↔ processor). Counts only:
// no PCM leaves the worklet in I-02.
export const PCM_PROCESSOR_NAME = 'voicecrystal-pcm';

export interface PcmCountMessage {
  /** Samples per channel received since the processor started. */
  samples: number;
}
