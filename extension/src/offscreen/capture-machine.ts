// Capture machine of SPEC §6.1 as a typed transition table (ADR-0011).
// Pure: no chrome.*, no timers, no clock. The offscreen feeds it events and
// the times it measured (sample clock for active time, performance.now() for
// the absolute time) and acts on the resulting state.
import type { CaptureErrorCode, CaptureExitReason, CaptureState } from '@voicecrystal/contracts';

/** [H] times of SPEC §6. */
export const CAPTURE_LIMITS = {
  minValidSpeechMs: 8_000,
  maxValidSpeechMs: 18_000,
  maxActiveMs: 45_000,
  absoluteTimeoutMs: 120_000,
} as const;

export type InterruptReason = Extract<
  CaptureExitReason,
  | 'VIDEO_SEEK'
  | 'VIDEO_CHANGED'
  | 'PLAYBACK_RATE_CHANGED'
  | 'AD_OR_SOURCE_CHANGE'
  | 'NAVIGATED_AWAY'
  | 'USER_STOP'
  | 'MULTI_SPEAKER_DECLINED'
>;

export type FailReason = Extract<CaptureExitReason, 'STREAM_ENDED' | 'CAPTURE_ERROR' | 'OFFSCREEN_CLOSED'>;

export type FinalizeReason = Extract<
  CaptureExitReason,
  'CONVERGED' | 'MAX_VALID_SPEECH' | 'WALL_TIMEOUT' | 'ABSOLUTE_TIMEOUT'
>;

export type CaptureEvent =
  | { type: 'START' }
  | { type: 'ACQUIRED' }
  | { type: 'DENIED'; code: CaptureErrorCode }
  /** Emitted by the VAD (not wired before I-05b/I-06). */
  | { type: 'VAD_PAUSE' }
  | { type: 'VOICE_RESUMES' }
  | { type: 'PLAYER_PAUSED' }
  | { type: 'PLAYER_RESUMED' }
  /** Emitted by the split-half stopping rule (SPEC §8, not wired yet). */
  | { type: 'SPLIT_HALF_STABLE' }
  | { type: 'TICK'; activeMs: number; elapsedMs: number; validSpeechMs: number }
  | { type: 'INTERRUPT'; reason: InterruptReason }
  | { type: 'FAIL'; reason: FailReason; code: CaptureErrorCode }
  | { type: 'QUALITY'; accepted: boolean; validSpeechMs: number }
  /** Resources released and final message emitted: terminal → IDLE. */
  | { type: 'RELEASED' }
  /** User stop: accepted from every state (SPEC §6 invariant). */
  | { type: 'STOP' };

export type CaptureEventType = CaptureEvent['type'];

export interface MachineState {
  readonly state: CaptureState;
  /** Set in FINALIZING and in terminal states. */
  readonly exitReason: CaptureExitReason | null;
  /** Set in ERROR only. */
  readonly code: CaptureErrorCode | null;
}

export interface Transition {
  readonly next: MachineState;
  /** False when the event is not in the table for this state: the state is unchanged. */
  readonly accepted: boolean;
}

export const INITIAL_STATE: MachineState = { state: 'IDLE', exitReason: null, code: null };

const TERMINAL: readonly CaptureState[] = ['RESULT_READY', 'INSUFFICIENT_DATA', 'INTERRUPTED', 'ERROR'];

export function isTerminal(state: CaptureState): boolean {
  return TERMINAL.includes(state);
}

/** States where the session is still collecting audio. */
const ACTIVE: readonly CaptureState[] = ['LISTENING', 'WAITING_FOR_SPEECH', 'PAUSED'];

function to(
  state: CaptureState,
  exitReason: CaptureExitReason | null = null,
  code: CaptureErrorCode | null = null,
): MachineState {
  return { state, exitReason, code };
}

type EventOf<T extends CaptureEventType> = Extract<CaptureEvent, { type: T }>;

/** A handler returns the next state, or null when the event is a no-op here (accepted, unchanged). */
type Handlers = { readonly [T in CaptureEventType]?: (event: EventOf<T>, current: MachineState) => MachineState | null };

const unchanged = (): null => null;

/** Exits shared by LISTENING, WAITING_FOR_SPEECH and PAUSED. */
const COMMON_EXITS = {
  INTERRUPT: (event) => to('INTERRUPTED', event.reason),
  FAIL: (event) => to('ERROR', event.reason, event.code),
  STOP: () => to('INTERRUPTED', 'USER_STOP'),
} satisfies Handlers;

const TERMINAL_HANDLERS = {
  RELEASED: () => to('IDLE'),
  // Already ending: a stop is accepted and changes nothing.
  STOP: unchanged,
} satisfies Handlers;

function timeouts(event: EventOf<'TICK'>, withSpeechLimit: boolean): MachineState | null {
  if (withSpeechLimit && event.validSpeechMs >= CAPTURE_LIMITS.maxValidSpeechMs) {
    return to('FINALIZING', 'MAX_VALID_SPEECH');
  }
  if (event.activeMs >= CAPTURE_LIMITS.maxActiveMs) return to('FINALIZING', 'WALL_TIMEOUT');
  if (event.elapsedMs >= CAPTURE_LIMITS.absoluteTimeoutMs) return to('FINALIZING', 'ABSOLUTE_TIMEOUT');
  return null;
}

/** SPEC §6.1, one row per state. An event missing from a row is not a transition. */
const TABLE: Readonly<Record<CaptureState, Handlers>> = {
  IDLE: {
    START: () => to('AUTHORIZING'),
    // stop() is idempotent: accepted, nothing to do.
    STOP: unchanged,
  },
  AUTHORIZING: {
    ACQUIRED: () => to('LISTENING'),
    DENIED: (event) => to('ERROR', 'CAPTURE_ERROR', event.code),
    ...COMMON_EXITS,
  },
  LISTENING: {
    VAD_PAUSE: () => to('WAITING_FOR_SPEECH'),
    PLAYER_PAUSED: () => to('PAUSED'),
    SPLIT_HALF_STABLE: () => to('FINALIZING', 'CONVERGED'),
    TICK: (event) => timeouts(event, true),
    ...COMMON_EXITS,
  },
  WAITING_FOR_SPEECH: {
    VOICE_RESUMES: () => to('LISTENING'),
    PLAYER_PAUSED: () => to('PAUSED'),
    TICK: (event) => timeouts(event, false),
    ...COMMON_EXITS,
  },
  PAUSED: {
    PLAYER_RESUMED: () => to('LISTENING'),
    // Active time is frozen while paused; only the absolute timeout runs.
    TICK: (event) =>
      event.elapsedMs >= CAPTURE_LIMITS.absoluteTimeoutMs ? to('FINALIZING', 'ABSOLUTE_TIMEOUT') : null,
    ...COMMON_EXITS,
  },
  FINALIZING: {
    // Less than 8 s of valid speech is always INSUFFICIENT_DATA (SPEC §6.1).
    QUALITY: (event, current) =>
      event.accepted && event.validSpeechMs >= CAPTURE_LIMITS.minValidSpeechMs
        ? to('RESULT_READY', current.exitReason)
        : to('INSUFFICIENT_DATA', current.exitReason),
    FAIL: (event) => to('ERROR', event.reason, event.code),
    STOP: () => to('INTERRUPTED', 'USER_STOP'),
  },
  RESULT_READY: TERMINAL_HANDLERS,
  INSUFFICIENT_DATA: TERMINAL_HANDLERS,
  INTERRUPTED: TERMINAL_HANDLERS,
  ERROR: TERMINAL_HANDLERS,
};

/**
 * Applies one event. An event outside the table leaves the state as is and
 * reports `accepted: false` (no undeclared transition).
 */
export function transition(current: MachineState, event: CaptureEvent): Transition {
  const handler = TABLE[current.state][event.type] as
    | ((e: CaptureEvent, c: MachineState) => MachineState | null)
    | undefined;
  if (handler === undefined) return { next: current, accepted: false };
  return { next: handler(event, current) ?? current, accepted: true };
}

export function isActive(state: CaptureState): boolean {
  return ACTIVE.includes(state);
}
