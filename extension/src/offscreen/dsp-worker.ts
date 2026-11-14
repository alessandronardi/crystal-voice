// DSP worker (ADR-0001): runs packages/dsp-core off the page's thread. Built
// as one self-contained module, dsp-worker.js, next to fvad.wasm.
//  - Side panel, one worker per local file (ADR-0022): ANALYZE_PCM.
//  - Offscreen, one worker per tab or microphone session (ADR-0025):
//    STREAM_BEGIN, blocks from the AudioWorklet on a MessagePort, STREAM_END.
//    I-07 (ADR-0026): while the stream runs, one split-half evaluation of the
//    audio so far per whole second (STREAM_PROGRESS); one at a time.
// libfvad is loaded once per worker, through the checked loader (I-06b).
// Output: statistics, digests and descriptors, never samples (SPEC §9, R1).
// Nothing is logged: a failure is a code, never the data.
import { DspInputError, type FvadModule } from '@voicecrystal/dsp-core';
import { analyzeDescriptors } from '../shared/descriptor-analysis.ts';
import {
  isAnalyzePcmRequest,
  isPcmBlock,
  isSpeakerConfirmedRequest,
  isStreamBeginRequest,
  isStreamEndRequest,
  type DspFailureCode,
  type DspWorkerReply,
} from '../shared/dsp-protocol.ts';
import { FvadLoadError, loadBundledFvad } from '../shared/fvad-loader.ts';
import { analyzePcm } from '../shared/pcm-analysis.ts';
import { observePrefix } from '../shared/split-half-rule.ts';
import { createEvaluationLoop, StreamEvaluator } from '../shared/stream-evaluator.ts';

/** [H] Most audio a session may keep: 125 s per channel, above the 120 s absolute timeout (SPEC §6.1). */
export const STREAM_MAX_SECONDS = 125;

/** The dedicated-worker global scope; the TS DOM lib types `self` as a Window. */
interface WorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: DspWorkerReply): void;
  location: { href: string };
}

const scope = globalThis as unknown as WorkerScope;

let fvadPromise: Promise<FvadModule> | null = null;
const fvad = (): Promise<FvadModule> => (fvadPromise ??= loadBundledFvad(scope.location.href));

function failureOf(error: unknown): DspFailureCode {
  if (error instanceof FvadLoadError) return 'VAD_UNAVAILABLE';
  if (error instanceof DspInputError) return error.code;
  return 'INTERNAL';
}

let stream: { evaluator: StreamEvaluator; port: MessagePort; sampleRate: number; loop: { kick(): void } } | null = null;

scope.onmessage = (event) => {
  const request = event.data;
  if (isAnalyzePcmRequest(request)) {
    fvad()
      .then((module) => analyzePcm(request.channels, request.sampleRate, module))
      .then(
        (analysis) => {
          scope.postMessage({ type: 'ANALYSIS_DONE', analysis });
        },
        (error: unknown) => {
          scope.postMessage({ type: 'ANALYSIS_FAILED', code: failureOf(error) });
        },
      );
    return;
  }
  if (isStreamBeginRequest(request) && stream === null) {
    const evaluator = new StreamEvaluator(Math.round(STREAM_MAX_SECONDS * request.sampleRate), request.sampleRate);
    // One evaluation at a time, in a later task (review H-2): see createEvaluationLoop.
    const loop = createEvaluationLoop(evaluator, {
      defer: (fn) => {
        setTimeout(fn, 0);
      },
      analyser: () => fvad().then((module) => (channels, sampleRate, monitor) => observePrefix(channels, sampleRate, module, monitor)),
      now: () => performance.now(),
      failureOf,
      post: (progress) => {
        scope.postMessage({ type: 'STREAM_PROGRESS', progress });
      },
    });
    stream = { evaluator, port: request.port, sampleRate: request.sampleRate, loop };
    request.port.onmessage = (message: MessageEvent<unknown>) => {
      // The worklet sends STREAM_END on this same port after its last block (ordering).
      if (isStreamEndRequest(message.data)) {
        endStream();
        return;
      }
      // A malformed block is refused like an over-the-cap one: counted by push(), never thrown.
      if (isPcmBlock(message.data) && evaluator.accumulator.push(message.data.channels)) loop.kick();
    };
    // Load now; a failure is reported at once (review M-4) and again in STREAM_RESULT.
    void fvad().catch(() => {
      scope.postMessage({ type: 'ANALYSIS_FAILED', code: 'VAD_UNAVAILABLE' });
    });
    return;
  }
  if (isStreamEndRequest(request) && stream !== null) {
    endStream();
    return;
  }
  if (isSpeakerConfirmedRequest(request)) {
    // I-13b (D-AM): a late answer after the stream ended has nothing left to unblock.
    stream?.evaluator.confirmSingleSpeaker();
    stream?.loop.kick();
    return;
  }
  scope.postMessage({ type: 'ANALYSIS_FAILED', code: 'BAD_REQUEST' });
};

/** Ends the stream once: analyses everything kept and answers STREAM_RESULT to the host. */
function endStream(): void {
  if (stream === null) return;
  {
    const { evaluator, port, sampleRate } = stream;
    const accumulator = evaluator.accumulator;
    evaluator.stop();
    port.onmessage = null;
    port.close();
    const stats = { frames: accumulator.frames, droppedFrames: accumulator.droppedFrames, channelCount: accumulator.channelCount };
    const channels = accumulator.take();
    stream = null;
    if (channels.length === 0 || stats.frames === 0) {
      scope.postMessage({ type: 'STREAM_RESULT', analysis: null, failure: 'BAD_REQUEST', stats });
      return;
    }
    fvad()
      .then((module) => analyzeDescriptors(channels, sampleRate, module))
      .then(
        (analysis) => {
          scope.postMessage({ type: 'STREAM_RESULT', analysis, failure: null, stats });
        },
        (error: unknown) => {
          scope.postMessage({ type: 'STREAM_RESULT', analysis: null, failure: failureOf(error), stats });
        },
      );
  }
}
