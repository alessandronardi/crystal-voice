// Internal messages between the service worker, the offscreen document and the
// side panel (I-02). NOT part of SPEC §9 `CaptureMessage`: like PING/PONG they
// are plumbing for the capture PoC and carry no audio.
//
// `OFFSCREEN_START_TAB` carries the tabCapture stream ID. It is sent once,
// service worker → offscreen, immediately after `getMediaStreamId`; it must
// never be logged, persisted or forwarded (AGENTS.md R1, SPEC §5).
// chrome.runtime.sendMessage reaches every open extension context, not only
// the offscreen: the side panel and other pages receive it too and ignore it
// (they only accept CAPTURE_DIAG and storage changes).

import type { CaptureErrorCode, CaptureMessage, SessionId } from './messages.ts';

export interface OffscreenStartTab {
  v: 1;
  type: 'OFFSCREEN_START_TAB';
  sessionId: SessionId;
  streamId: string;
}

export interface OffscreenStop {
  v: 1;
  type: 'OFFSCREEN_STOP';
  sessionId: SessionId;
}

export type CaptureDiagState = 'starting' | 'running' | 'stopped' | 'failed';

/** Offscreen → side panel, about twice a second while capturing. No PCM. */
export interface CaptureDiag {
  v: 1;
  type: 'CAPTURE_DIAG';
  sessionId: SessionId;
  /** Strictly increasing per session. */
  seq: number;
  state: CaptureDiagState;
  /** Samples (per channel) counted by the AudioWorklet since the start. */
  samples: number;
  sampleRate: number | null;
  /** `AudioContext.baseLatency`, seconds; null when not available. */
  baseLatency: number | null;
  /** `AudioContext.outputLatency`, seconds; null when not available. */
  outputLatency: number | null;
  /** Set only when `state` is 'failed'. */
  code: CaptureErrorCode | null;
}

export type InternalMessage = OffscreenStartTab | OffscreenStop | CaptureDiag;

export type CaptureStopMessage = Extract<CaptureMessage, { type: 'CAPTURE_STOP' }>;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Chrome stream IDs are short opaque strings; the bound only rejects junk. */
const MAX_STREAM_ID_LENGTH = 512;
const DIAG_STATES: readonly string[] = ['starting', 'running', 'stopped', 'failed'];
// A Record keyed by the union: the compiler rejects a missing or extra code.
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
const ERROR_CODES: readonly string[] = Object.keys(ERROR_CODE_SET);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isSessionId(value: unknown): value is SessionId {
  return typeof value === 'string' && UUID_V4.test(value);
}

export function isCaptureErrorCode(value: unknown): value is CaptureErrorCode {
  return typeof value === 'string' && ERROR_CODES.includes(value);
}

function isNonNegativeIntOrNull(value: unknown): boolean {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
}

function isNonNegativeFiniteOrNull(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

export function isOffscreenStartTab(value: unknown): value is OffscreenStartTab {
  return (
    isRecord(value) &&
    value['v'] === 1 &&
    value['type'] === 'OFFSCREEN_START_TAB' &&
    isSessionId(value['sessionId']) &&
    typeof value['streamId'] === 'string' &&
    value['streamId'].length > 0 &&
    value['streamId'].length <= MAX_STREAM_ID_LENGTH
  );
}

export function isOffscreenStop(value: unknown): value is OffscreenStop {
  return (
    isRecord(value) &&
    value['v'] === 1 &&
    value['type'] === 'OFFSCREEN_STOP' &&
    isSessionId(value['sessionId'])
  );
}

export function isCaptureDiag(value: unknown): value is CaptureDiag {
  if (!isRecord(value)) return false;
  const state = value['state'];
  const code = value['code'];
  return (
    value['v'] === 1 &&
    value['type'] === 'CAPTURE_DIAG' &&
    isSessionId(value['sessionId']) &&
    Number.isSafeInteger(value['seq']) &&
    (value['seq'] as number) >= 0 &&
    typeof state === 'string' &&
    DIAG_STATES.includes(state) &&
    Number.isSafeInteger(value['samples']) &&
    (value['samples'] as number) >= 0 &&
    isNonNegativeIntOrNull(value['sampleRate']) &&
    isNonNegativeFiniteOrNull(value['baseLatency']) &&
    isNonNegativeFiniteOrNull(value['outputLatency']) &&
    (state === 'failed' ? isCaptureErrorCode(code) : code === null)
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
    Number.isSafeInteger(value['seq']) &&
    (value['seq'] as number) >= 0
  );
}
