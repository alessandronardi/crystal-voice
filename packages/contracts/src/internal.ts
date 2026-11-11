// Internal messages between the service worker, the offscreen document, the
// content script and the side panel (I-02, I-03, I-17). NOT part of SPEC §9
// `CaptureMessage`: like PING/PONG they are plumbing until the DSP exists, and
// carry no audio. `CAPTURE_DIAG` stands in for CAPTURE_PROGRESS / CAPTURE_RESULT
// / CAPTURE_FAILED until then (product owner decision, 2026-11-11).
//
// `OFFSCREEN_START_TAB` carries the tabCapture stream ID. It is sent once,
// service worker → offscreen, immediately after `getMediaStreamId`; it must
// never be logged, persisted or forwarded (AGENTS.md R1, SPEC §5).
// chrome.runtime.sendMessage reaches every open extension context, not only
// the offscreen: the side panel and other pages receive it too and ignore it.

import type {
  CaptureErrorCode,
  CaptureExitReason,
  CaptureMessage,
  CaptureState,
  SessionId,
} from './messages.ts';

export interface OffscreenStartTab {
  v: 1;
  type: 'OFFSCREEN_START_TAB';
  sessionId: SessionId;
  /** The captured tab: heartbeats are accepted only from it (ADR-0004). */
  tabId: number;
  streamId: string;
}

/**
 * Service worker → offscreen: start a microphone session (I-17, ADR-0009).
 * No stream ID: the offscreen opens the microphone itself with the permission
 * the user granted to the extension's origin in permission.html.
 */
export interface OffscreenStartMic {
  v: 1;
  type: 'OFFSCREEN_START_MIC';
  sessionId: SessionId;
}

/**
 * Name prefix of the port the side panel opens to the offscreen for a
 * microphone session (`vc-panel:<sessionId>`). The port closes with the panel
 * document, and the session stops with it (BACKLOG I-17).
 */
export const PANEL_PORT_PREFIX = 'vc-panel:';

/** Exit reasons the service worker may ask for. */
export type OffscreenStopReason = Extract<CaptureExitReason, 'USER_STOP' | 'NAVIGATED_AWAY' | 'STREAM_ENDED'>;

export interface OffscreenStop {
  v: 1;
  type: 'OFFSCREEN_STOP';
  sessionId: SessionId;
  reason: OffscreenStopReason;
}

/** Service worker → content script of the captured tab (tabs.sendMessage). */
export interface SessionBind {
  v: 1;
  type: 'SESSION_BIND';
  sessionId: SessionId;
}

export type PlayerEventKind = 'seek' | 'source-change';

/** Content script → offscreen: a player event that interrupts the session (SPEC §6). */
export interface PlayerEvent {
  v: 1;
  type: 'PLAYER_EVENT';
  sessionId: SessionId;
  /** Shares the content script's sequence with HEARTBEAT. */
  seq: number;
  kind: PlayerEventKind;
}

/** Reply of the offscreen to HEARTBEAT and PLAYER_EVENT: false tells the content script to stop. */
export interface HeartbeatReply {
  active: boolean;
}

/** Offscreen → side panel and service worker, about twice a second and once at the end. No PCM. */
export interface CaptureDiag {
  v: 1;
  type: 'CAPTURE_DIAG';
  sessionId: SessionId;
  /** Strictly increasing per session. */
  seq: number;
  state: CaptureState;
  /** Set exactly when `state` is terminal. */
  exitReason: CaptureExitReason | null;
  /** Set exactly when `state` is 'ERROR'. */
  code: CaptureErrorCode | null;
  /** Samples (per channel) counted by the AudioWorklet since the start. */
  samples: number;
  sampleRate: number | null;
  /** Wall time since the start, from performance.now(). */
  elapsedMs: number;
  /** Listening time from the sample clock, pauses excluded. */
  activeMs: number;
  /** `AudioContext.baseLatency`, seconds; null when not available. */
  baseLatency: number | null;
  /** `AudioContext.outputLatency`, seconds; null when not available. */
  outputLatency: number | null;
}

export type InternalMessage =
  | OffscreenStartTab
  | OffscreenStartMic
  | OffscreenStop
  | SessionBind
  | PlayerEvent
  | CaptureDiag;

export type CaptureStartMessage = Extract<CaptureMessage, { type: 'CAPTURE_START' }>;
export type CaptureStopMessage = Extract<CaptureMessage, { type: 'CAPTURE_STOP' }>;
export type HeartbeatMessage = Extract<CaptureMessage, { type: 'HEARTBEAT' }>;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Chrome stream IDs are short opaque strings; the bound only rejects junk. */
const MAX_STREAM_ID_LENGTH = 512;
const MAX_VIDEO_ID_LENGTH = 64;
const MAX_URL_LENGTH = 2048;

// Records keyed by the unions: the compiler rejects a missing or extra member.
const ERROR_CODE_SET: Readonly<Record<CaptureErrorCode, true>> = {
  NOT_YOUTUBE_WATCH: true,
  CAPTURE_BUSY: true,
  PERMISSION_DENIED: true,
  MIC_PERMISSION_REQUIRED: true,
  FILE_DECODE_FAILED: true,
  FILE_TOO_LONG: true,
  STREAM_ID_EXPIRED: true,
  STREAM_NOT_AVAILABLE: true,
  OFFSCREEN_FAILED: true,
  AUDIO_CONTEXT_FAILED: true,
  PROCESSING_OVERRUN: true,
  PLAYBACK_ROUTING_FAILED: true,
  VIDEO_UNSUPPORTED: true,
  INTERNAL_ERROR: true,
};
const EXIT_REASON_SET: Readonly<Record<CaptureExitReason, true>> = {
  CONVERGED: true,
  MAX_VALID_SPEECH: true,
  WALL_TIMEOUT: true,
  ABSOLUTE_TIMEOUT: true,
  USER_STOP: true,
  VIDEO_SEEK: true,
  VIDEO_CHANGED: true,
  PLAYBACK_RATE_CHANGED: true,
  AD_OR_SOURCE_CHANGE: true,
  NAVIGATED_AWAY: true,
  MULTI_SPEAKER_DECLINED: true,
  STREAM_ENDED: true,
  OFFSCREEN_CLOSED: true,
  QUALITY_REJECTED: true,
  CAPTURE_ERROR: true,
};
const CAPTURE_STATE_SET: Readonly<Record<CaptureState, true>> = {
  IDLE: true,
  AUTHORIZING: true,
  LISTENING: true,
  WAITING_FOR_SPEECH: true,
  PAUSED: true,
  FINALIZING: true,
  RESULT_READY: true,
  INSUFFICIENT_DATA: true,
  INTERRUPTED: true,
  ERROR: true,
};
const ERROR_CODES: readonly string[] = Object.keys(ERROR_CODE_SET);
const EXIT_REASONS: readonly string[] = Object.keys(EXIT_REASON_SET);
const CAPTURE_STATES: readonly string[] = Object.keys(CAPTURE_STATE_SET);

/** SPEC §6.1 terminal states: resources released, final message, then IDLE. */
export const TERMINAL_CAPTURE_STATES: readonly CaptureState[] = [
  'RESULT_READY',
  'INSUFFICIENT_DATA',
  'INTERRUPTED',
  'ERROR',
];

export function isTerminalCaptureState(state: CaptureState): boolean {
  return TERMINAL_CAPTURE_STATES.includes(state);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSeq(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function isSessionId(value: unknown): value is SessionId {
  return typeof value === 'string' && UUID_V4.test(value);
}

export function isCaptureErrorCode(value: unknown): value is CaptureErrorCode {
  return typeof value === 'string' && ERROR_CODES.includes(value);
}

export function isCaptureExitReason(value: unknown): value is CaptureExitReason {
  return typeof value === 'string' && EXIT_REASONS.includes(value);
}

export function isCaptureState(value: unknown): value is CaptureState {
  return typeof value === 'string' && CAPTURE_STATES.includes(value);
}

function isNonNegativeIntOrNull(value: unknown): boolean {
  return value === null || isSeq(value);
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonNegativeFiniteOrNull(value: unknown): boolean {
  return value === null || isNonNegativeFinite(value);
}

export function isOffscreenStartTab(value: unknown): value is OffscreenStartTab {
  return (
    isRecord(value) &&
    value['v'] === 1 &&
    value['type'] === 'OFFSCREEN_START_TAB' &&
    isSessionId(value['sessionId']) &&
    isSeq(value['tabId']) &&
    typeof value['streamId'] === 'string' &&
    value['streamId'].length > 0 &&
    value['streamId'].length <= MAX_STREAM_ID_LENGTH
  );
}

export function isOffscreenStartMic(value: unknown): value is OffscreenStartMic {
  return (
    isRecord(value) && value['v'] === 1 && value['type'] === 'OFFSCREEN_START_MIC' && isSessionId(value['sessionId'])
  );
}

/** The session id of a panel port name, or null when the name is not one. */
export function panelPortSessionId(name: string): SessionId | null {
  if (!name.startsWith(PANEL_PORT_PREFIX)) return null;
  const id = name.slice(PANEL_PORT_PREFIX.length);
  return isSessionId(id) ? id : null;
}

export function isOffscreenStop(value: unknown): value is OffscreenStop {
  if (!isRecord(value)) return false;
  const reason = value['reason'];
  return (
    value['v'] === 1 &&
    value['type'] === 'OFFSCREEN_STOP' &&
    isSessionId(value['sessionId']) &&
    (reason === 'USER_STOP' || reason === 'NAVIGATED_AWAY' || reason === 'STREAM_ENDED')
  );
}

export function isSessionBind(value: unknown): value is SessionBind {
  return (
    isRecord(value) && value['v'] === 1 && value['type'] === 'SESSION_BIND' && isSessionId(value['sessionId'])
  );
}

export function isPlayerEvent(value: unknown): value is PlayerEvent {
  return (
    isRecord(value) &&
    value['v'] === 1 &&
    value['type'] === 'PLAYER_EVENT' &&
    isSessionId(value['sessionId']) &&
    isSeq(value['seq']) &&
    (value['kind'] === 'seek' || value['kind'] === 'source-change')
  );
}

/** Guard for the SPEC §9 HEARTBEAT sent by the content script (untrusted page context). */
export function isHeartbeatMessage(value: unknown): value is HeartbeatMessage {
  if (!isRecord(value)) return false;
  const videoId = value['videoId'];
  const url = value['url'];
  const rate = value['playbackRate'];
  const volume = value['volume'];
  return (
    value['v'] === 1 &&
    value['type'] === 'HEARTBEAT' &&
    isSessionId(value['sessionId']) &&
    isSeq(value['seq']) &&
    typeof videoId === 'string' &&
    videoId.length <= MAX_VIDEO_ID_LENGTH &&
    typeof url === 'string' &&
    url.length > 0 &&
    url.length <= MAX_URL_LENGTH &&
    typeof value['paused'] === 'boolean' &&
    typeof value['muted'] === 'boolean' &&
    typeof rate === 'number' &&
    Number.isFinite(rate) &&
    rate > 0 &&
    isNonNegativeFinite(volume) &&
    volume <= 1
  );
}

export function isCaptureDiag(value: unknown): value is CaptureDiag {
  if (!isRecord(value)) return false;
  const state = value['state'];
  const code = value['code'];
  const exitReason = value['exitReason'];
  if (!isCaptureState(state)) return false;
  const terminal = isTerminalCaptureState(state);
  return (
    value['v'] === 1 &&
    value['type'] === 'CAPTURE_DIAG' &&
    isSessionId(value['sessionId']) &&
    isSeq(value['seq']) &&
    (terminal ? isCaptureExitReason(exitReason) : exitReason === null) &&
    (state === 'ERROR' ? isCaptureErrorCode(code) : code === null) &&
    isSeq(value['samples']) &&
    isNonNegativeIntOrNull(value['sampleRate']) &&
    isNonNegativeFinite(value['elapsedMs']) &&
    isNonNegativeFinite(value['activeMs']) &&
    isNonNegativeFiniteOrNull(value['baseLatency']) &&
    isNonNegativeFiniteOrNull(value['outputLatency'])
  );
}

/**
 * Guard for the SPEC §9 start request. A tab start names its tab; microphone
 * and file starts have `tabId: null`. Which sources a context may start is the
 * receiver's decision (SPEC §5: the tab starts only from the toolbar).
 */
export function isCaptureStartMessage(value: unknown): value is CaptureStartMessage {
  if (!isRecord(value)) return false;
  const source = value['source'];
  const tabId = value['tabId'];
  const sourceOk =
    source === 'tab' ? isSeq(tabId) : (source === 'mic' || source === 'file') && tabId === null;
  return (
    value['v'] === 1 &&
    value['type'] === 'CAPTURE_START' &&
    isSessionId(value['sessionId']) &&
    isSeq(value['seq']) &&
    sourceOk
  );
}

/** Guard for the SPEC §9 stop request sent by the side panel. */
export function isCaptureStopMessage(value: unknown): value is CaptureStopMessage {
  return (
    isRecord(value) &&
    value['v'] === 1 &&
    value['type'] === 'CAPTURE_STOP' &&
    value['reason'] === 'USER_STOP' &&
    isSessionId(value['sessionId']) &&
    isSeq(value['seq'])
  );
}
