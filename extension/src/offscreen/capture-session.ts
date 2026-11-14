// One capture session in the offscreen document (SPEC §5, §6; ADR-0004, ADR-0011).
// It drives the capture machine, runs the heartbeat watchdog and owns the exit
// path. No chrome.* and no WebAudio here: the clock, timers, messaging and
// resource release are injected, so the whole lifecycle runs in Node tests.
import type {
  CaptureAnalysis,
  CaptureDiag,
  CaptureErrorCode,
  CaptureStability,
  CaptureState,
  CrystalSeed,
  HeartbeatMessage,
  MultiSpeakerAnswerMessage,
  MultiSpeakerState,
  OffscreenStopReason,
  PlayerEvent,
  SessionId,
} from '@voicecrystal/contracts';
import {
  CAPTURE_LIMITS,
  INITIAL_STATE,
  isTerminal,
  transition,
  type CaptureEvent,
  type FailReason,
  type MachineState,
} from './capture-machine.ts';
import { STOP_RULE_VERSION } from '@voicecrystal/dsp-core';
import type { StreamProgress } from '../shared/dsp-protocol.ts';

/** ADR-0004: no heartbeat for this long ends the session with NAVIGATED_AWAY. */
export const HEARTBEAT_TIMEOUT_MS = 3_000;

/** [H] SPEC §6.1 «AUTHORIZING → timeout → ERROR»: no stream within this time is an error. */
export const AUTHORIZING_TIMEOUT_MS = 10_000;

/** [H] SPEC §6: every terminal state is back to IDLE within 1 s; release gets this much of it. */
export const RELEASE_TIMEOUT_MS = 800;

/**
 * [H] I-17: a microphone session lives as long as the side panel that asked
 * for it. Its port must arrive within this time from the start, or the panel
 * is taken as closed (closed while the offscreen was being created).
 */
export const PANEL_ATTACH_TIMEOUT_MS = 3_000;

/**
 * What a session is bound to. A tab session is kept alive by the heartbeats
 * of that tab's content script (ADR-0004); a microphone session by its side
 * panel's port (BACKLOG I-17: stop when the panel closes).
 */
export type SessionBinding = { source: 'tab'; tabId: number } | { source: 'mic' };

export interface AudioFacts {
  sampleRate: number | null;
  baseLatency: number | null;
  outputLatency: number | null;
}

export interface SessionDeps {
  /** performance.now() in the offscreen (SPEC §6: absolute time). */
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  emit(diag: CaptureDiag): void;
  /** Stops tracks, disconnects nodes, closes the AudioContext. Must not throw past its own try/finally. */
  release(): Promise<void>;
  /** Called once the session is back to IDLE (the offscreen closes itself, ADR-0003). */
  onIdle(): void;
  /**
   * I-06b (ADR-0025): the analysis of the audio kept so far, asked once in
   * FINALIZING. Must resolve, never reject; the session bounds it with
   * ANALYSIS_TIMEOUT_MS.
   */
  finalize(): Promise<SessionAnalysis>;
  /** I-06b: keep the worklet's audio for the analysis (listening states only, no pauses). */
  setRecording(recording: boolean): void;
  /**
   * I-06b, review C-1 (R8, ADR-0004): FINALIZING captures nothing more. Stops
   * the tracks and disconnects the source at once; only the analysis of what
   * was recorded goes on. Must not throw.
   */
  endCapture(): void;
}

/** What the end-of-session analysis decided (I-06b). */
export interface SessionAnalysis {
  analysis: CaptureAnalysis;
  /** The extraction is OK and canonical (QualitySummary.accepted). */
  accepted: boolean;
  validSpeechMs: number;
}

/** [H] I-06b: the end-of-session analysis must answer within this time, or the session ends in INSUFFICIENT_DATA. */
export const ANALYSIS_TIMEOUT_MS = 15_000;

const FAILED_ANALYSIS = (failure: CaptureAnalysis['failure']): SessionAnalysis => ({
  analysis: { quality: null, seed: null, extractorVersion: null, mappingVersion: null, failure, analysedMs: null, rawMeasures: null },
  accepted: false,
  validSpeechMs: 0,
});

/**
 * Review H-1 of I-13b (SPEC §7.2: «se risponde sì il cristallo è valido e
 * porta il warning»): a several-voices notice seen while listening, answered
 * or not, stays among the result's warnings even when the analysis of the
 * whole buffer does not raise it again.
 */
export function withSessionWarnings(analysis: CaptureAnalysis, multiSpeaker: MultiSpeakerState): CaptureAnalysis {
  const quality = analysis.quality;
  if (multiSpeaker === 'NONE' || quality === null || quality.warnings.includes('MULTI_SPEAKER_SUSPECTED')) return analysis;
  return { ...analysis, quality: { ...quality, warnings: [...quality.warnings, 'MULTI_SPEAKER_SUSPECTED'] } };
}

/** States whose audio belongs to the analysed segment (SPEC §7.2: pauses are not). */
const RECORDING_STATES: readonly CaptureState[] = ['LISTENING', 'WAITING_FOR_SPEECH'];

/** Messages refused by the session, by cause (extension/CLAUDE.md: ignored and counted). */
export interface IgnoredCounts {
  wrongTab: number;
  wrongSession: number;
  staleSeq: number;
  rejectedEvent: number;
  /** I-07: a STREAM_PROGRESS that came once the session no longer listened. */
  lateProgress: number;
}

const YOUTUBE_HOST = 'www.youtube.com';

function watchVideoId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== YOUTUBE_HOST || parsed.pathname !== '/watch') return null;
  const v = parsed.searchParams.get('v');
  return v === null || v === '' ? null : v;
}

export class CaptureSession {
  private machine: MachineState = INITIAL_STATE;
  private seq = 0;
  private samples = 0;
  private lastSamples = 0;
  private activeSamples = 0;
  private audio: AudioFacts = { sampleRate: null, baseLatency: null, outputLatency: null };
  private readonly startedAt: number;
  private watchdog: unknown = null;
  private authorizing: unknown = null;
  private contentSeq = -1;
  private videoId: string | null = null;
  private finishing = false;
  private panelDeadline: unknown = null;
  private panelAttached = false;
  private authorizingTimeoutCode: CaptureErrorCode;
  private recording = false;
  /** Set when FINALIZING has its analysis; carried by the terminal diagnostic (D-Y). */
  private analysis: CaptureAnalysis | null = null;
  private analysing = false;
  private analysisTimer: unknown = null;
  /** I-07 (ADR-0026): valid speech of the latest evaluation of the audio so far. */
  private validSpeechMs = 0;
  private stability: CaptureStability | null = null;
  /** I-13a: the germ's seed (display only, SPEC §13). */
  private provisionalSeed: CrystalSeed | null = null;
  /** The rule converged while the machine could not take it (PAUSED): applied on the next LISTENING tick. */
  private convergedPending = false;
  /** I-13b: the several-voices notice (SPEC §13 D4, D-AM). */
  private multiSpeaker: MultiSpeakerState = 'NONE';
  private answerSeq = -1;
  readonly ignored: IgnoredCounts = { wrongTab: 0, wrongSession: 0, staleSeq: 0, rejectedEvent: 0, lateProgress: 0 };

  readonly id: SessionId;
  readonly binding: SessionBinding;
  private readonly deps: SessionDeps;

  constructor(id: SessionId, binding: SessionBinding, deps: SessionDeps) {
    this.id = id;
    this.binding = binding;
    this.deps = deps;
    this.startedAt = deps.now();
    this.apply({ type: 'START' });
    // A microphone that never opens is by default reported like a refusal:
    // the offscreen cannot ask, the permission page can (SPEC §5).
    this.authorizingTimeoutCode = binding.source === 'mic' ? 'MIC_PERMISSION_REQUIRED' : 'STREAM_NOT_AVAILABLE';
    this.authorizing = deps.setTimer(() => {
      this.authorizing = null;
      this.denied(this.authorizingTimeoutCode);
    }, AUTHORIZING_TIMEOUT_MS);
    if (binding.source === 'mic') {
      this.panelDeadline = deps.setTimer(() => {
        this.panelDeadline = null;
        this.apply({ type: 'STOP' });
      }, PANEL_ATTACH_TIMEOUT_MS);
    }
  }

  /** The error reported if no stream arrives in AUTHORIZING (e.g. a granted microphone that hangs). */
  setAuthorizingTimeoutCode(code: CaptureErrorCode): void {
    this.authorizingTimeoutCode = code;
  }

  /**
   * The side panel's port for this microphone session arrived. Returns false
   * when it is not wanted (tab session, already attached, or ending): the
   * caller then disconnects it.
   */
  attachPanel(): boolean {
    if (this.binding.source !== 'mic' || this.panelAttached || !this.isLive()) return false;
    this.panelAttached = true;
    this.clearPanelDeadline();
    return true;
  }

  /** The attached panel's port closed: the panel is gone, the session stops (USER_STOP). */
  detachPanel(): void {
    if (!this.panelAttached) return;
    this.panelAttached = false;
    this.apply({ type: 'STOP' });
  }

  get state(): CaptureState {
    return this.machine.state;
  }

  /** True while the session has not started to end. */
  isLive(): boolean {
    return !this.finishing && this.machine.state !== 'IDLE' && !isTerminal(this.machine.state);
  }

  acquired(audio: AudioFacts): void {
    this.clearAuthorizing();
    this.audio = audio;
    this.apply({ type: 'ACQUIRED' });
    // The first heartbeat has the same margin as the others (ADR-0004).
    // No heartbeats for the microphone: its panel port keeps it alive.
    if (this.binding.source === 'tab' && this.isLive()) this.armWatchdog();
  }

  denied(code: CaptureErrorCode): void {
    this.apply({ type: 'DENIED', code });
  }

  fail(reason: FailReason, code: CaptureErrorCode): void {
    this.apply({ type: 'FAIL', reason, code });
  }

  /** Total samples counted by the worklet. Active time grows only while listening. */
  onSamples(total: number): void {
    if (!Number.isSafeInteger(total) || total < this.samples) return;
    const delta = total - this.lastSamples;
    this.lastSamples = total;
    this.samples = total;
    if (this.machine.state === 'LISTENING' || this.machine.state === 'WAITING_FOR_SPEECH') {
      this.activeSamples += delta;
    }
  }

  /** Periodic: timeouts of SPEC §6 and a live diagnostic. */
  tick(): void {
    // FINALIZING has no timeouts of its own: the analysis has ANALYSIS_TIMEOUT_MS.
    if (!this.isLive() || this.machine.state === 'FINALIZING') return;
    this.applyConvergence();
    // applyConvergence may have moved the machine to FINALIZING.
    if (!this.isLive() || this.state === 'FINALIZING') return;
    // I-07: the valid speech of the latest evaluation (ADR-0026), so that
    // MAX_VALID_SPEECH stops the session at 18 s (SPEC §6.1).
    this.apply({ type: 'TICK', activeMs: this.activeMs(), elapsedMs: this.elapsedMs(), validSpeechMs: this.validSpeechMs });
    if (this.isLive()) this.emit();
  }

  /**
   * I-07 (ADR-0026): the worker's latest evaluation of the audio so far.
   * Taken only while the session collects audio; afterwards it is late
   * (ignored and counted). A convergence becomes SPLIT_HALF_STABLE at once
   * in LISTENING, or on the next LISTENING tick.
   */
  onProgress(progress: StreamProgress): void {
    if (!this.isLive() || !(this.machine.state === 'LISTENING' || this.machine.state === 'WAITING_FOR_SPEECH' || this.machine.state === 'PAUSED')) {
      this.ignored.lateProgress++;
      return;
    }
    // Review M-3: a failed evaluation measured nothing. The last valid speech
    // and stability stay (never 0 for «not measured», R13); the worker stops
    // evaluating, so the session goes on to its time limits.
    if (progress.failure !== null) return;
    this.validSpeechMs = progress.validSpeechMs;
    this.provisionalSeed = progress.provisionalSeed;
    // The notice is pending from the worker's first warning until the user answers (ADR-0026 point 4.3).
    if (progress.multiSpeakerPending && this.multiSpeaker === 'NONE') this.multiSpeaker = 'PENDING';
    const last = progress.last;
    this.stability = {
      stopRuleVersion: STOP_RULE_VERSION,
      evaluations: progress.evaluations,
      seconds: last?.seconds ?? null,
      s: last?.s ?? null,
      blockedBy: last?.blockedBy ?? null,
      consecutive: last?.consecutive ?? 0,
      converged: progress.converged,
      analysisMs: progress.analysisMs,
    };
    if (progress.converged) this.convergedPending = true;
    this.applyConvergence();
  }

  private applyConvergence(): void {
    if (!this.convergedPending || this.machine.state !== 'LISTENING') return;
    this.convergedPending = false;
    this.apply({ type: 'SPLIT_HALF_STABLE' });
  }

  /**
   * I-13b: the side panel's answer to the several-voices notice (SPEC §13 D4).
   * «No» ends the session (INTERRUPTED / MULTI_SPEAKER_DECLINED); «Sì» holds
   * for the rest of the session (D-AM). Returns true when the DSP worker must
   * be told that one speaker was confirmed. Answers for another session, with
   * an old seq, or with no notice pending are ignored and counted.
   */
  answerMultiSpeaker(message: MultiSpeakerAnswerMessage): boolean {
    if (message.sessionId !== this.id) {
      this.ignored.wrongSession++;
      return false;
    }
    if (message.seq <= this.answerSeq) {
      this.ignored.staleSeq++;
      return false;
    }
    if (!this.isLive() || this.machine.state === 'FINALIZING' || this.multiSpeaker !== 'PENDING') {
      this.ignored.rejectedEvent++;
      return false;
    }
    // Only an answer taken counts for the seq (review L-1): a refused one changes nothing.
    this.answerSeq = message.seq;
    if (!message.singleSpeaker) {
      this.apply({ type: 'INTERRUPT', reason: 'MULTI_SPEAKER_DECLINED' });
      return false;
    }
    this.multiSpeaker = 'CONFIRMED';
    this.emit();
    return true;
  }

  stop(reason: OffscreenStopReason): void {
    switch (reason) {
      case 'USER_STOP':
        this.apply({ type: 'STOP' });
        return;
      case 'NAVIGATED_AWAY':
        this.apply({ type: 'INTERRUPT', reason: 'NAVIGATED_AWAY' });
        return;
      case 'STREAM_ENDED':
        // FINALIZING ended the capture itself (review C-1): the tab capture's
        // own "stopped" notice that follows is that, not a capture error (D-Z).
        if (this.machine.state === 'FINALIZING') return;
        this.apply({ type: 'FAIL', reason: 'STREAM_ENDED', code: 'STREAM_NOT_AVAILABLE' });
        return;
    }
  }

  /**
   * Watchdog input from the content script. Returns whether the content script
   * should keep sending (false once the session is over or not its own).
   */
  onHeartbeat(message: HeartbeatMessage, senderTabId: number | undefined): boolean {
    const accepted = this.acceptFromContent(message.sessionId, message.seq, senderTabId);
    if (accepted === 'not-mine') return false;
    if (accepted === 'stale') return this.isLive();
    // FINALIZING captures nothing (review C-1): no watchdog, and the content script may stop.
    if (this.machine.state === 'FINALIZING') return false;
    this.armWatchdog();
    const videoId = watchVideoId(message.url);
    if (videoId === null) {
      this.apply({ type: 'INTERRUPT', reason: 'NAVIGATED_AWAY' });
    } else if (this.videoId !== null && videoId !== this.videoId) {
      this.apply({ type: 'INTERRUPT', reason: 'VIDEO_CHANGED' });
    } else if (message.playbackRate !== 1) {
      this.apply({ type: 'INTERRUPT', reason: 'PLAYBACK_RATE_CHANGED' });
    } else {
      this.videoId ??= videoId;
      if (message.paused && this.machine.state !== 'PAUSED') this.apply({ type: 'PLAYER_PAUSED' });
      if (!message.paused && this.machine.state === 'PAUSED') this.apply({ type: 'PLAYER_RESUMED' });
    }
    return this.isLive();
  }

  onPlayerEvent(message: PlayerEvent, senderTabId: number | undefined): boolean {
    const accepted = this.acceptFromContent(message.sessionId, message.seq, senderTabId);
    if (accepted === 'not-mine') return false;
    if (accepted === 'stale') return this.isLive();
    this.apply({
      type: 'INTERRUPT',
      reason: message.kind === 'seek' ? 'VIDEO_SEEK' : 'AD_OR_SOURCE_CHANGE',
    });
    return this.isLive();
  }

  /**
   * 'not-mine': another tab or session, told to stop sending; 'stale': an old
   * seq of this session, ignored; 'ok': to be acted upon.
   */
  private acceptFromContent(
    sessionId: SessionId,
    seq: number,
    senderTabId: number | undefined,
  ): 'ok' | 'stale' | 'not-mine' {
    // A microphone session has no tab: every content script is a stranger to it.
    if (this.binding.source !== 'tab' || senderTabId !== this.binding.tabId) {
      this.ignored.wrongTab++;
      return 'not-mine';
    }
    if (sessionId !== this.id) {
      this.ignored.wrongSession++;
      return 'not-mine';
    }
    if (seq <= this.contentSeq || !this.isLive()) {
      this.ignored.staleSeq++;
      return 'stale';
    }
    this.contentSeq = seq;
    return 'ok';
  }

  private clearAuthorizing(): void {
    if (this.authorizing !== null) this.deps.clearTimer(this.authorizing);
    this.authorizing = null;
  }

  private clearPanelDeadline(): void {
    if (this.panelDeadline !== null) this.deps.clearTimer(this.panelDeadline);
    this.panelDeadline = null;
  }

  private armWatchdog(): void {
    if (this.watchdog !== null) this.deps.clearTimer(this.watchdog);
    this.watchdog = this.deps.setTimer(() => {
      this.watchdog = null;
      this.apply({ type: 'INTERRUPT', reason: 'NAVIGATED_AWAY' });
    }, HEARTBEAT_TIMEOUT_MS);
  }

  private activeMs(): number {
    const rate = this.audio.sampleRate;
    return rate === null || rate <= 0 ? 0 : (this.activeSamples / rate) * 1000;
  }

  private elapsedMs(): number {
    return Math.max(0, this.deps.now() - this.startedAt);
  }

  private apply(event: CaptureEvent): void {
    if (this.finishing) return;
    const before = this.machine.state;
    const { next, accepted } = transition(this.machine, event);
    if (!accepted) {
      this.ignored.rejectedEvent++;
      return;
    }
    this.machine = next;
    const recording = RECORDING_STATES.includes(this.machine.state);
    if (recording !== this.recording) {
      this.recording = recording;
      this.deps.setRecording(recording);
    }
    if (next.state === 'FINALIZING' && !this.analysing) {
      this.analysing = true;
      // The capture ends here (R8): navigation, a lost heartbeat or a closed
      // tab during the analysis find no live capture (review C-1).
      if (this.watchdog !== null) this.deps.clearTimer(this.watchdog);
      this.watchdog = null;
      this.deps.endCapture();
      void this.analyse();
    }
    if (isTerminal(this.machine.state)) {
      void this.finish();
    } else if (this.machine.state !== before) {
      this.emit();
    }
  }

  /**
   * FINALIZING (I-06b, ADR-0025): asks for the analysis, bounded by
   * ANALYSIS_TIMEOUT_MS, then applies the existing QUALITY event. No new arc:
   * a failure or a timeout is `accepted: false` → INSUFFICIENT_DATA, with the
   * reason in `analysis.failure`. A stop that ended FINALIZING first wins.
   */
  private async analyse(): Promise<void> {
    const timeout = new Promise<SessionAnalysis>((resolve) => {
      this.analysisTimer = this.deps.setTimer(() => {
        this.analysisTimer = null;
        resolve(FAILED_ANALYSIS('ANALYSIS_TIMEOUT'));
      }, ANALYSIS_TIMEOUT_MS);
    });
    let outcome: SessionAnalysis;
    try {
      outcome = await Promise.race([this.deps.finalize(), timeout]);
    } catch {
      outcome = FAILED_ANALYSIS('ANALYSIS_FAILED');
    } finally {
      if (this.analysisTimer !== null) this.deps.clearTimer(this.analysisTimer);
      this.analysisTimer = null;
    }
    if (this.machine.state !== 'FINALIZING' || this.finishing) return;
    // Same rule as the machine's QUALITY row (SPEC §6.1: at least 8 s of valid
    // speech): a refused result keeps its measures but never shows a seed.
    const ready = outcome.accepted && outcome.validSpeechMs >= CAPTURE_LIMITS.minValidSpeechMs && outcome.analysis.seed !== null;
    this.analysis = withSessionWarnings(ready ? outcome.analysis : { ...outcome.analysis, seed: null }, this.multiSpeaker);
    this.apply({ type: 'QUALITY', accepted: ready, validSpeechMs: outcome.validSpeechMs });
  }

  /** The single exit (ADR-0004): idempotent, release in finally, final message, IDLE. */
  private async finish(): Promise<void> {
    if (this.finishing) return;
    this.finishing = true;
    if (this.watchdog !== null) this.deps.clearTimer(this.watchdog);
    this.watchdog = null;
    this.clearAuthorizing();
    this.clearPanelDeadline();
    // Review L-8: a stop that won over FINALIZING leaves no analysis timer behind.
    if (this.analysisTimer !== null) this.deps.clearTimer(this.analysisTimer);
    this.analysisTimer = null;
    try {
      // Bounded: a context.close() that hangs must not keep the session out of IDLE.
      await Promise.race([
        this.deps.release(),
        new Promise<void>((resolve) => {
          this.deps.setTimer(resolve, RELEASE_TIMEOUT_MS);
        }),
      ]);
    } catch {
      // Release is best effort; the offscreen document closing frees the rest.
    } finally {
      this.emit();
      this.machine = transition(this.machine, { type: 'RELEASED' }).next;
      this.deps.onIdle();
    }
  }

  private emit(): void {
    this.deps.emit({
      v: 1,
      type: 'CAPTURE_DIAG',
      sessionId: this.id,
      seq: this.seq++,
      state: this.machine.state,
      exitReason: isTerminal(this.machine.state) ? this.machine.exitReason : null,
      code: this.machine.state === 'ERROR' ? this.machine.code : null,
      samples: this.samples,
      sampleRate: this.audio.sampleRate,
      elapsedMs: this.elapsedMs(),
      activeMs: this.activeMs(),
      baseLatency: this.audio.baseLatency,
      outputLatency: this.audio.outputLatency,
      analysis: this.machine.state === 'RESULT_READY' || this.machine.state === 'INSUFFICIENT_DATA' ? this.analysis : null,
      validSpeechMs: this.validSpeechMs,
      stability: this.stability,
      // Only while collecting audio: a terminal diagnostic carries the result, never the germ.
      provisionalSeed: isTerminal(this.machine.state) || this.machine.state === 'FINALIZING' ? null : this.provisionalSeed,
      multiSpeaker: this.multiSpeaker,
    });
  }
}

