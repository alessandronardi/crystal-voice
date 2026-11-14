// The audio of a tab or microphone session and its split-half evaluations
// (I-07, ADR-0026). Pure: the dsp-worker drives it, the tests drive it in Node
// with a fake analyser.
//  - Blocks are kept by the PcmAccumulator of I-06b (ADR-0025).
//  - An evaluation analyses the prefix of k whole seconds of source audio,
//    k = the seconds received so far. If the worker fell behind, k jumps to
//    the latest second and the monitor catches up on the valid-speech seconds
//    in between: the evaluations never depend on the machine's speed.
//  - It stops for good after convergence, after a failure, or once the
//    stream ends (the final analysis of the whole buffer is ADR-0025's).
import { PcmAccumulator } from './pcm-accumulator.ts';
import type { DspFailureCode, StreamProgress } from './dsp-protocol.ts';
import { SplitHalfMonitor, type SplitHalfProgress } from './split-half-rule.ts';

export type PrefixAnalyser = (channels: Float32Array[], sampleRate: number, monitor: SplitHalfMonitor) => SplitHalfProgress;

export class StreamEvaluator {
  readonly accumulator: PcmAccumulator;
  readonly sampleRate: number;
  private readonly monitor = new SplitHalfMonitor();
  private analysed = 0;
  private stopped = false;
  private failed: DspFailureCode | null = null;

  constructor(maxFrames: number, sampleRate: number) {
    this.accumulator = new PcmAccumulator(maxFrames);
    this.sampleRate = sampleRate;
  }

  /** Whole seconds of audio the next evaluation should analyse, or null when none is due. */
  due(): number | null {
    if (this.stopped || this.failed !== null || this.monitor.converged) return null;
    const k = Math.floor(this.accumulator.frames / this.sampleRate);
    return k > this.analysed ? k : null;
  }

  /** Runs one evaluation of `seconds` (from due()). A throwing analyser fails the evaluator: no further evaluation. */
  evaluate(seconds: number, analyse: PrefixAnalyser, now: () => number, failureOf: (error: unknown) => DspFailureCode): StreamProgress {
    const t0 = now();
    this.analysed = seconds;
    try {
      const p = analyse(this.accumulator.snapshot(seconds * this.sampleRate), this.sampleRate, this.monitor);
      return { audioSeconds: seconds, validSpeechMs: p.validSpeechMs, evaluations: p.evaluations, last: p.last, converged: p.converged, provisionalSeed: p.provisionalSeed, analysisMs: Math.max(0, now() - t0), failure: null };
    } catch (error: unknown) {
      this.failed = failureOf(error);
      return {
        audioSeconds: seconds,
        validSpeechMs: 0,
        evaluations: this.monitor.evaluations,
        last: this.monitor.last,
        converged: false,
        provisionalSeed: null,
        analysisMs: Math.max(0, now() - t0),
        failure: this.failed,
      };
    }
  }

  /** The stream ended: no more evaluations. */
  stop(): void {
    this.stopped = true;
  }
}

export interface EvaluationLoopDeps {
  /**
   * Runs `fn` in a later task (setTimeout(0) in the worker), never in the
   * current one: the blocks already waiting on the port get in first, so the
   * evaluation analyses the latest whole second instead of the next one
   * (review H-2).
   */
  defer(fn: () => void): void;
  /** The prefix analyser once libfvad is ready; rejects when it is unavailable. */
  analyser(): Promise<PrefixAnalyser>;
  now(): number;
  failureOf(error: unknown): DspFailureCode;
  post(progress: StreamProgress): void;
}

/**
 * At most one evaluation scheduled or running at a time. kick() after every
 * kept block; an evaluation picks the seconds due when it starts, not when it
 * was scheduled.
 */
export function createEvaluationLoop(evaluator: StreamEvaluator, deps: EvaluationLoopDeps): { kick(): void } {
  let busy = false;
  const kick = (): void => {
    if (busy || evaluator.due() === null) return;
    busy = true;
    deps.defer(() => {
      deps.analyser().then(
        (analyse) => {
          busy = false;
          const seconds = evaluator.due();
          if (seconds === null) return;
          deps.post(
            evaluator.evaluate(
              seconds,
              analyse,
              () => deps.now(),
              (error) => deps.failureOf(error),
            ),
          );
          kick();
        },
        () => {
          // libfvad unavailable: reported by the worker on STREAM_BEGIN and in STREAM_RESULT.
          busy = false;
        },
      );
    });
  };
  return { kick };
}
