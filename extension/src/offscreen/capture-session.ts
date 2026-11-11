// One capture session in the offscreen document (SPEC §5, §6; ADR-0004, ADR-0011).
// It drives the capture machine, runs the heartbeat watchdog and owns the exit
// path. No chrome.* and no WebAudio here: the clock, timers, messaging and
// resource release are injected, so the whole lifecycle runs in Node tests.
import type {
  CaptureDiag,
  CaptureErrorCode,
  CaptureState,
  HeartbeatMessage,
  OffscreenStopReason,
  PlayerEvent,
  SessionId,
} from '@voicecrystal/contracts';
import {
  INITIAL_STATE,
  isTerminal,
  transition,
  type CaptureEvent,
  type FailReason,
  type MachineState,
} from './capture-machine.ts';

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
}

/** Messages refused by the session, by cause (extension/CLAUDE.md: ignored and counted). */
export interface IgnoredCounts {
  wrongTab: number;
  wrongSession: number;
  staleSeq: number;
  rejectedEvent: number;
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
  readonly ignored: IgnoredCounts = { wrongTab: 0, wrongSession: 0, staleSeq: 0, rejectedEvent: 0 };

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
    if (!this.isLive()) return;
    // No speech detector before I-05b/I-06: valid speech stays 0 ms.
    this.apply({ type: 'TICK', activeMs: this.activeMs(), elapsedMs: this.elapsedMs(), validSpeechMs: 0 });
    if (this.isLive()) this.emit();
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
    if (next.state === 'FINALIZING') {
      // No analyzer before the DSP issues: quality cannot be accepted, and with
      // 0 ms of valid speech the machine yields INSUFFICIENT_DATA anyway.
      this.machine = transition(this.machine, { type: 'QUALITY', accepted: false, validSpeechMs: 0 }).next;
    }
    if (isTerminal(this.machine.state)) {
      void this.finish();
    } else if (this.machine.state !== before) {
      this.emit();
    }
  }

  /** The single exit (ADR-0004): idempotent, release in finally, final message, IDLE. */
  private async finish(): Promise<void> {
    if (this.finishing) return;
    this.finishing = true;
    if (this.watchdog !== null) this.deps.clearTimer(this.watchdog);
    this.watchdog = null;
    this.clearAuthorizing();
    this.clearPanelDeadline();
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
    });
  }
}

