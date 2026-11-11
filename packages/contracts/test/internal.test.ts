import { describe, expect, it } from 'vitest';
import {
  TERMINAL_CAPTURE_STATES,
  isCaptureDiag,
  isCaptureErrorCode,
  isCaptureExitReason,
  isCaptureState,
  isCaptureStopMessage,
  isHeartbeatMessage,
  isOffscreenStartTab,
  isOffscreenStop,
  isPlayerEvent,
  isSessionBind,
  isSessionId,
  isTerminalCaptureState,
  type CaptureDiag,
} from '../src/index.ts';

const SESSION = '3f1c2b4a-9d8e-4f7a-8b6c-5d4e3f2a1b0c';

const diag: CaptureDiag = {
  v: 1,
  type: 'CAPTURE_DIAG',
  sessionId: SESSION,
  seq: 3,
  state: 'LISTENING',
  exitReason: null,
  code: null,
  samples: 48_000,
  sampleRate: 48_000,
  elapsedMs: 1_000,
  activeMs: 1_000,
  baseLatency: 0.01,
  outputLatency: 0.02,
};

const heartbeat = {
  v: 1,
  type: 'HEARTBEAT',
  sessionId: SESSION,
  seq: 4,
  videoId: 'abc123',
  url: 'https://www.youtube.com/watch?v=abc123',
  paused: false,
  playbackRate: 1,
  muted: false,
  volume: 0.5,
};

describe('session id', () => {
  it('accepts UUID v4 only', () => {
    expect(isSessionId(SESSION)).toBe(true);
    expect(isSessionId(SESSION.toUpperCase())).toBe(false);
    expect(isSessionId('3f1c2b4a-9d8e-1f7a-8b6c-5d4e3f2a1b0c')).toBe(false);
    expect(isSessionId('')).toBe(false);
    expect(isSessionId(42)).toBe(false);
  });
});

describe('OFFSCREEN_START_TAB', () => {
  const base = { v: 1, type: 'OFFSCREEN_START_TAB', sessionId: SESSION, tabId: 7, streamId: 'abc' };
  it('accepts a well-formed message', () => {
    expect(isOffscreenStartTab(base)).toBe(true);
  });

  it('rejects bad stream ids, tab ids and sessions', () => {
    expect(isOffscreenStartTab({ ...base, streamId: '' })).toBe(false);
    expect(isOffscreenStartTab({ ...base, streamId: 'x'.repeat(513) })).toBe(false);
    expect(isOffscreenStartTab({ ...base, tabId: -1 })).toBe(false);
    expect(isOffscreenStartTab({ ...base, tabId: 1.5 })).toBe(false);
    const { tabId: _t, ...noTab } = base;
    expect(isOffscreenStartTab(noTab)).toBe(false);
    expect(isOffscreenStartTab({ ...base, sessionId: 'nope' })).toBe(false);
    expect(isOffscreenStartTab({ ...base, v: 2 })).toBe(false);
    expect(isOffscreenStartTab(null)).toBe(false);
    expect(isOffscreenStartTab([base])).toBe(false);
  });
});

describe('OFFSCREEN_STOP', () => {
  it('accepts the three service-worker reasons only', () => {
    for (const reason of ['USER_STOP', 'NAVIGATED_AWAY', 'STREAM_ENDED']) {
      expect(isOffscreenStop({ v: 1, type: 'OFFSCREEN_STOP', sessionId: SESSION, reason })).toBe(true);
    }
    expect(isOffscreenStop({ v: 1, type: 'OFFSCREEN_STOP', sessionId: SESSION, reason: 'VIDEO_SEEK' })).toBe(false);
    expect(isOffscreenStop({ v: 1, type: 'OFFSCREEN_STOP', sessionId: SESSION })).toBe(false);
    expect(isOffscreenStop({ v: 1, type: 'OFFSCREEN_STOP', sessionId: '', reason: 'USER_STOP' })).toBe(false);
  });
});

describe('SESSION_BIND and PLAYER_EVENT', () => {
  it('validate their fields', () => {
    expect(isSessionBind({ v: 1, type: 'SESSION_BIND', sessionId: SESSION })).toBe(true);
    expect(isSessionBind({ v: 1, type: 'SESSION_BIND', sessionId: 'x' })).toBe(false);
    const event = { v: 1, type: 'PLAYER_EVENT', sessionId: SESSION, seq: 2, kind: 'seek' };
    expect(isPlayerEvent(event)).toBe(true);
    expect(isPlayerEvent({ ...event, kind: 'source-change' })).toBe(true);
    expect(isPlayerEvent({ ...event, kind: 'ad' })).toBe(false);
    expect(isPlayerEvent({ ...event, seq: -1 })).toBe(false);
  });
});

describe('HEARTBEAT guard (untrusted page context)', () => {
  it('accepts a well-formed heartbeat', () => {
    expect(isHeartbeatMessage(heartbeat)).toBe(true);
    expect(isHeartbeatMessage({ ...heartbeat, videoId: '' })).toBe(true);
  });

  it('rejects malformed or oversized fields', () => {
    expect(isHeartbeatMessage({ ...heartbeat, playbackRate: 0 })).toBe(false);
    expect(isHeartbeatMessage({ ...heartbeat, playbackRate: Number.NaN })).toBe(false);
    expect(isHeartbeatMessage({ ...heartbeat, volume: 1.5 })).toBe(false);
    expect(isHeartbeatMessage({ ...heartbeat, volume: -0.1 })).toBe(false);
    expect(isHeartbeatMessage({ ...heartbeat, paused: 'no' })).toBe(false);
    expect(isHeartbeatMessage({ ...heartbeat, url: '' })).toBe(false);
    expect(isHeartbeatMessage({ ...heartbeat, url: 'x'.repeat(2049) })).toBe(false);
    expect(isHeartbeatMessage({ ...heartbeat, videoId: 'x'.repeat(65) })).toBe(false);
    expect(isHeartbeatMessage({ ...heartbeat, seq: 1.5 })).toBe(false);
    expect(isHeartbeatMessage({ ...heartbeat, sessionId: 'x' })).toBe(false);
  });
});

describe('CAPTURE_DIAG', () => {
  it('accepts live and terminal diagnostics', () => {
    expect(isCaptureDiag(diag)).toBe(true);
    expect(isCaptureDiag({ ...diag, sampleRate: null, baseLatency: null, outputLatency: null })).toBe(true);
    expect(isCaptureDiag({ ...diag, state: 'INTERRUPTED', exitReason: 'NAVIGATED_AWAY' })).toBe(true);
    expect(isCaptureDiag({ ...diag, state: 'ERROR', exitReason: 'CAPTURE_ERROR', code: 'STREAM_NOT_AVAILABLE' })).toBe(
      true,
    );
  });

  it('ties exitReason to terminal states and code to ERROR', () => {
    expect(isCaptureDiag({ ...diag, exitReason: 'USER_STOP' })).toBe(false);
    expect(isCaptureDiag({ ...diag, state: 'INTERRUPTED', exitReason: null })).toBe(false);
    expect(isCaptureDiag({ ...diag, state: 'ERROR', exitReason: 'CAPTURE_ERROR', code: null })).toBe(false);
    expect(isCaptureDiag({ ...diag, state: 'INTERRUPTED', exitReason: 'USER_STOP', code: 'CAPTURE_BUSY' })).toBe(false);
    expect(isCaptureDiag({ ...diag, code: 'CAPTURE_BUSY' })).toBe(false);
  });

  it('rejects negative, fractional or non-finite numbers (R13: no implicit zero)', () => {
    expect(isCaptureDiag({ ...diag, samples: -1 })).toBe(false);
    expect(isCaptureDiag({ ...diag, samples: 1.5 })).toBe(false);
    expect(isCaptureDiag({ ...diag, seq: -1 })).toBe(false);
    expect(isCaptureDiag({ ...diag, elapsedMs: -1 })).toBe(false);
    expect(isCaptureDiag({ ...diag, activeMs: Number.NaN })).toBe(false);
    expect(isCaptureDiag({ ...diag, baseLatency: Number.NaN })).toBe(false);
    expect(isCaptureDiag({ ...diag, outputLatency: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isCaptureDiag({ ...diag, sampleRate: 44_100.5 })).toBe(false);
    expect(isCaptureDiag({ ...diag, baseLatency: undefined })).toBe(false);
  });

  it('rejects unknown states', () => {
    expect(isCaptureDiag({ ...diag, state: 'running' })).toBe(false);
  });
});

describe('CAPTURE_STOP guard', () => {
  it('accepts the SPEC §9 stop request only', () => {
    const stop = { v: 1, type: 'CAPTURE_STOP', reason: 'USER_STOP', sessionId: SESSION, seq: 0 };
    expect(isCaptureStopMessage(stop)).toBe(true);
    expect(isCaptureStopMessage({ ...stop, reason: 'OTHER' })).toBe(false);
    expect(isCaptureStopMessage({ ...stop, seq: 0.5 })).toBe(false);
    expect(isCaptureStopMessage({ ...stop, sessionId: 'x' })).toBe(false);
  });
});

describe('enumerations', () => {
  it('recognise SPEC §9 members only', () => {
    expect(isCaptureErrorCode('NOT_YOUTUBE_WATCH')).toBe(true);
    expect(isCaptureErrorCode('toString')).toBe(false);
    expect(isCaptureExitReason('VIDEO_CHANGED')).toBe(true);
    expect(isCaptureExitReason('constructor')).toBe(false);
    expect(isCaptureState('PAUSED')).toBe(true);
    expect(isCaptureState('paused')).toBe(false);
  });

  it('names the four terminal states of SPEC §6.1', () => {
    expect([...TERMINAL_CAPTURE_STATES].sort()).toEqual(['ERROR', 'INSUFFICIENT_DATA', 'INTERRUPTED', 'RESULT_READY']);
    expect(isTerminalCaptureState('IDLE')).toBe(false);
    expect(isTerminalCaptureState('FINALIZING')).toBe(false);
  });
});
