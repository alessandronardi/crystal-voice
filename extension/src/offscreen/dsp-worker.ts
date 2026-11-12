// DSP worker (ADR-0001): runs packages/dsp-core off the page's thread. Built
// as one self-contained module, dsp-worker.js. Since I-18 the side panel
// starts one per local-file analysis (ADR-0022) and terminates it at the end;
// the offscreen will host it for the tab and the microphone with I-06.
// Input: one ANALYZE_PCM with transferred channels. Output: statistics and
// digests (shared/pcm-analysis.ts), never samples (SPEC §9, AGENTS.md R1).
// Nothing is logged: a failure is a code, never the data.
import { DspInputError } from '@voicecrystal/dsp-core';
import { isAnalyzePcmRequest, type DspWorkerReply } from '../shared/dsp-protocol.ts';
import { analyzePcm } from '../shared/pcm-analysis.ts';

/** The dedicated-worker global scope; the TS DOM lib types `self` as a Window. */
interface WorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: DspWorkerReply): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.onmessage = (event) => {
  const request = event.data;
  if (!isAnalyzePcmRequest(request)) {
    scope.postMessage({ type: 'ANALYSIS_FAILED', code: 'BAD_REQUEST' });
    return;
  }
  analyzePcm(request.channels, request.sampleRate).then(
    (analysis) => {
      scope.postMessage({ type: 'ANALYSIS_DONE', analysis });
    },
    (error: unknown) => {
      scope.postMessage({ type: 'ANALYSIS_FAILED', code: error instanceof DspInputError ? error.code : 'INTERNAL' });
    },
  );
};
