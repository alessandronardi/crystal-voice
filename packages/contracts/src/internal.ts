// Internal messages between the service worker, the offscreen document, the
// content script and the side panel (I-02, I-03, I-17, I-18). NOT part of SPEC §9
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
  QualitySummary,
  QualityWarning,
  SessionId,
} from './messages.ts';
import { DESCRIPTOR_KEYS, isCrystalSeed, type CrystalSeed } from './seed.ts';

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

/**
 * Side panel → service worker: the file analysis this panel started is over,
 * however it ended (I-18, ADR-0022). The service worker then clears the
 * routing state of that session. A file session never touches the offscreen:
 * its decoding and DSP run in the panel, and no PCM leaves it.
 */
export interface FileSessionEnd {
  v: 1;
  type: 'FILE_SESSION_END';
  sessionId: SessionId;
}

/**
 * Service worker → side panels: is this file session still running? Only the
 * panel running it answers, with FileSessionPong. No answer means its panel
 * is gone (closed mid-analysis) and the routing state is stale (ADR-0022).
 * Measured in Chromium 156: `MessageSender.documentId` is not set for a side
 * panel, so the session cannot be tied to its document.
 */
export interface FileSessionPing {
  v: 1;
  type: 'FILE_SESSION_PING';
  sessionId: SessionId;
}

/** The reply (sendResponse) of the panel running the session. */
export interface FileSessionPong {
  v: 1;
  type: 'FILE_SESSION_PONG';
  sessionId: SessionId;
}

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
  /**
   * The analysis at the end of a tab or microphone session (I-06b, D-Y,
   * ADR-0025): set only in RESULT_READY and INSUFFICIENT_DATA reached through
   * FINALIZING, null otherwise. Numbers and the seed only, never audio.
   */
  analysis: CaptureAnalysis | null;
  /**
   * I-07 (ADR-0026): valid speech of the latest analysis of the audio so far,
   * ms; 0 before the first one. Drives MAX_VALID_SPEECH (SPEC §6.1).
   */
  validSpeechMs: number;
  /** I-07: the split-half stopping rule (SPEC §8); null before its first analysis. */
  stability: CaptureStability | null;
  /**
   * I-13a: seed of the audio so far with the current estimates, for the
   * growing germ labelled «provvisorio» (SPEC §9, §13). Only while the
   * session collects audio; null otherwise and until measurable. Never the
   * result: the result is `analysis.seed` (RESULT_READY).
   */
  provisionalSeed: CrystalSeed | null;
  /**
   * I-13b (SPEC §13 D4, ADR-0026 point 4.3, D-AM): the several-voices notice.
   * PENDING from the first warning until the user answers; CONFIRMED after
   * «Sì, continua», for the rest of the session. Never a judgement on a person.
   */
  multiSpeaker: MultiSpeakerState;
}

export type MultiSpeakerState = 'NONE' | 'PENDING' | 'CONFIRMED';

export const MULTI_SPEAKER_STATES: readonly MultiSpeakerState[] = ['NONE', 'PENDING', 'CONFIRMED'];

/** The six raw measures x_i (SPEC §7.4 units), null when not measurable (R13: never 0). */
export type RawMeasureTuple = readonly [number | null, number | null, number | null, number | null, number | null, number | null];

/** Why a split-half evaluation did not pass: the first SPEC §8 condition that failed (I-07). */
export type SplitHalfBlock = 'TOO_SHORT' | 'MISSING_DESCRIPTOR' | 'MULTI_SPEAKER' | 'HALF_INCOMPLETE' | 'UNSTABLE';

export const SPLIT_HALF_BLOCKS: readonly SplitHalfBlock[] = ['TOO_SHORT', 'MISSING_DESCRIPTOR', 'MULTI_SPEAKER', 'HALF_INCOMPLETE', 'UNSTABLE'];

/** The split-half stopping rule as the panel shows it (I-07, technical rows). */
export interface CaptureStability {
  /** The rule that decided (review L-1): `split-half-0` (dsp-core STOP_RULE_VERSION). */
  stopRuleVersion: string;
  /** Evaluations so far, one per second of valid speech from 8 s. */
  evaluations: number;
  /** Second of valid speech of the latest evaluation; null before the first. */
  seconds: number | null;
  /** s_t of the latest evaluation, points; null when a half cannot measure a descriptor or before the first. */
  s: number | null;
  /** Why the latest evaluation did not pass; null when it passed or before the first. */
  blockedBy: SplitHalfBlock | null;
  /** Passing evaluations in a row (3 converge, SPEC §8). */
  consecutive: number;
  converged: boolean;
  /** Time of the latest analysis of the audio so far in the worker, ms (BENCHMARK_PROTOCOL §7); null before the first. */
  analysisMs: number | null;
}

/** Why the end-of-session analysis gave no measure (I-06b). */
export type CaptureAnalysisFailure = 'VAD_UNAVAILABLE' | 'ANALYSIS_FAILED' | 'ANALYSIS_TIMEOUT';

export interface CaptureAnalysis {
  /** Quality of the analysed audio (SPEC §9); null when the analysis failed. */
  quality: QualitySummary | null;
  /** mapping-0 seed; non-null exactly when the session is RESULT_READY. */
  seed: CrystalSeed | null;
  /** null when the run did not use the canonical extractor; such a run is never accepted. */
  extractorVersion: string | null;
  mappingVersion: string | null;
  failure: CaptureAnalysisFailure | null;
  /** Audio kept for the analysis, ms (pauses excluded); null when nothing reached the worker. */
  analysedMs: number | null;
  /** I-13b: raw measures for the live legend (SPEC §9 `AnalysisResult.rawMeasures`); null exactly when the analysis failed. */
  rawMeasures: RawMeasureTuple | null;
}

export type InternalMessage =
  | OffscreenStartTab
  | OffscreenStartMic
  | FileSessionEnd
  | FileSessionPing
  | FileSessionPong
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
const WARNING_SET: Readonly<Record<QualityWarning, true>> = {
  MIXED_AUDIO_UNCERTAIN: true,
  MULTI_SPEAKER_SUSPECTED: true,
  LOW_CONFIDENCE_PARAMETER: true,
  CLIPPING: true,
  LOW_LEVEL: true,
  PLAYER_MUTED: true,
  EXPERIMENTAL_MAPPING: true,
  PHASE_CANCELLATION: true,
};
const ANALYSIS_FAILURE_SET: Readonly<Record<CaptureAnalysisFailure, true>> = {
  VAD_UNAVAILABLE: true,
  ANALYSIS_FAILED: true,
  ANALYSIS_TIMEOUT: true,
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

export function isFileSessionEnd(value: unknown): value is FileSessionEnd {
  return isRecord(value) && value['v'] === 1 && value['type'] === 'FILE_SESSION_END' && isSessionId(value['sessionId']);
}

export function isFileSessionPing(value: unknown): value is FileSessionPing {
  return isRecord(value) && value['v'] === 1 && value['type'] === 'FILE_SESSION_PING' && isSessionId(value['sessionId']);
}

export function isFileSessionPong(value: unknown): value is FileSessionPong {
  return isRecord(value) && value['v'] === 1 && value['type'] === 'FILE_SESSION_PONG' && isSessionId(value['sessionId']);
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
    isNonNegativeFiniteOrNull(value['outputLatency']) &&
    isAnalysisFor(state, value['analysis']) &&
    isNonNegativeFinite(value['validSpeechMs']) &&
    (value['stability'] === null || isCaptureStability(value['stability'])) &&
    (value['provisionalSeed'] === null || (isCrystalSeed(value['provisionalSeed']) && !terminal)) &&
    typeof value['multiSpeaker'] === 'string' &&
    (MULTI_SPEAKER_STATES as readonly string[]).includes(value['multiSpeaker'])
  );
}

export function isRawMeasureTuple(value: unknown): value is RawMeasureTuple {
  return Array.isArray(value) && value.length === 6 && value.every((x) => x === null || (typeof x === 'number' && Number.isFinite(x)));
}

/** Structural guard of CaptureStability; the fields must agree with each other. */
export function isCaptureStability(value: unknown): value is CaptureStability {
  if (!isRecord(value)) return false;
  const seconds = value['seconds'];
  const s = value['s'];
  const blocked = value['blockedBy'];
  const consecutive = value['consecutive'];
  const evaluations = value['evaluations'];
  const shapeOk =
    typeof value['stopRuleVersion'] === 'string' &&
    value['stopRuleVersion'].length > 0 &&
    isSeq(evaluations) &&
    (seconds === null || isSeq(seconds)) &&
    isNonNegativeFiniteOrNull(s) &&
    (blocked === null || (typeof blocked === 'string' && (SPLIT_HALF_BLOCKS as readonly string[]).includes(blocked))) &&
    isSeq(consecutive) &&
    typeof value['converged'] === 'boolean' &&
    isNonNegativeFiniteOrNull(value['analysisMs']);
  if (!shapeOk) return false;
  // Before the first evaluation nothing is set; afterwards a run never exceeds the evaluations.
  if (evaluations === 0) return seconds === null && s === null && blocked === null && consecutive === 0 && value['converged'] === false;
  // A failed evaluation resets the run; a passed one is part of it.
  return seconds !== null && consecutive <= evaluations && (blocked === null ? consecutive >= 1 : consecutive === 0);
}

const probability = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** Structural guard for SPEC §9 QualitySummary (I-06b: it now crosses contexts in CAPTURE_DIAG). */
export function isQualitySummary(value: unknown): value is QualitySummary {
  if (!isRecord(value)) return false;
  const confidence = value['confidence'];
  const missing = value['missingFeatureKeys'];
  const warnings = value['warnings'];
  return (
    typeof value['accepted'] === 'boolean' &&
    isNonNegativeFinite(value['validSpeechMs']) &&
    isSeq(value['pitchUsableFrames']) &&
    isSeq(value['vadSpeechFrames']) &&
    isSeq(value['droppedFrames']) &&
    probability(value['clippedFraction']) &&
    Array.isArray(confidence) &&
    confidence.length === 6 &&
    confidence.every(probability) &&
    Array.isArray(missing) &&
    missing.every((k) => typeof k === 'string' && (DESCRIPTOR_KEYS as readonly string[]).includes(k)) &&
    Array.isArray(warnings) &&
    warnings.every((w) => typeof w === 'string' && Object.hasOwn(WARNING_SET, w))
  );
}

/**
 * `analysis` is present only in the two states FINALIZING can lead to with a
 * result decision; RESULT_READY always carries a seed and no failure.
 */
function isAnalysisFor(state: CaptureState, value: unknown): boolean {
  if (value === null) return state !== 'RESULT_READY';
  if (state !== 'RESULT_READY' && state !== 'INSUFFICIENT_DATA') return false;
  if (!isRecord(value)) return false;
  const failure = value['failure'];
  const seed = value['seed'];
  const quality = value['quality'];
  const shapeOk =
    (quality === null || isQualitySummary(quality)) &&
    (seed === null || isCrystalSeed(seed)) &&
    (value['extractorVersion'] === null || typeof value['extractorVersion'] === 'string') &&
    (value['mappingVersion'] === null || typeof value['mappingVersion'] === 'string') &&
    (failure === null || (typeof failure === 'string' && Object.hasOwn(ANALYSIS_FAILURE_SET, failure))) &&
    isNonNegativeFiniteOrNull(value['analysedMs']) &&
    (value['rawMeasures'] === null || isRawMeasureTuple(value['rawMeasures']));
  if (!shapeOk) return false;
  if (failure !== null) return seed === null && quality === null && value['rawMeasures'] === null && state === 'INSUFFICIENT_DATA';
  if (value['rawMeasures'] === null) return false;
  // Review M-1: a measured analysis always has its quality; the seed and the acceptance follow the state.
  if (!isQualitySummary(quality)) return false;
  if (state === 'RESULT_READY') return seed !== null && quality.accepted && value['extractorVersion'] !== null;
  return seed === null;
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

export type MultiSpeakerAnswerMessage = Extract<CaptureMessage, { type: 'MULTI_SPEAKER_ANSWER' }>;

/** Guard for the SPEC §9 answer to the several-voices notice, sent by the side panel (I-13b). */
export function isMultiSpeakerAnswer(value: unknown): value is MultiSpeakerAnswerMessage {
  return (
    isRecord(value) &&
    value['v'] === 1 &&
    value['type'] === 'MULTI_SPEAKER_ANSWER' &&
    typeof value['singleSpeaker'] === 'boolean' &&
    isSessionId(value['sessionId']) &&
    isSeq(value['seq'])
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
