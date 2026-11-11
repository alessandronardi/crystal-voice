import { describe, expect, it } from 'vitest';
import {
  isCaptureDiag,
  isCaptureErrorCode,
  isCaptureStopMessage,
  isOffscreenStartTab,
  isOffscreenStop,
  isSessionId,
  type CaptureDiag,
} from '../src/index.ts';

const SESSION = '3f1c2b4a-9d8e-4f7a-8b6c-5d4e3f2a1b0c';

const diag: CaptureDiag = {
  v: 1,
  type: 'CAPTURE_DIAG',
  sessionId: SESSION,
  seq: 3,
  state: 'running',
  samples: 48_000,
  sampleRate: 48_000,
  baseLatency: 0.01,
  outputLatency: 0.02,
  code: null,
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
  it('accepts a well-formed message', () => {
    expect(isOffscreenStartTab({ v: 1, type: 'OFFSCREEN_START_TAB', sessionId: SESSION, streamId: 'abc' })).toBe(true);
  });

  it('rejects empty, oversized or missing stream ids and bad sessions', () => {
    const base = { v: 1, type: 'OFFSCREEN_START_TAB', sessionId: SESSION };
    expect(isOffscreenStartTab({ ...base, streamId: '' })).toBe(false);
    expect(isOffscreenStartTab({ ...base, streamId: 'x'.repeat(513) })).toBe(false);
    expect(isOffscreenStartTab(base)).toBe(false);
    expect(isOffscreenStartTab({ ...base, streamId: 'abc', sessionId: 'nope' })).toBe(false);
    expect(isOffscreenStartTab({ ...base, streamId: 'abc', v: 2 })).toBe(false);
    expect(isOffscreenStartTab(null)).toBe(false);
    expect(isOffscreenStartTab([base])).toBe(false);
  });
});

describe('OFFSCREEN_STOP', () => {
  it('accepts a well-formed message and rejects a bad session', () => {
    expect(isOffscreenStop({ v: 1, type: 'OFFSCREEN_STOP', sessionId: SESSION })).toBe(true);
    expect(isOffscreenStop({ v: 1, type: 'OFFSCREEN_STOP', sessionId: '' })).toBe(false);
    expect(isOffscreenStop({ v: 1, type: 'OFFSCREEN_START_TAB', sessionId: SESSION })).toBe(false);
  });
});

describe('CAPTURE_DIAG', () => {
  it('accepts running and failed diagnostics', () => {
    expect(isCaptureDiag(diag)).toBe(true);
    expect(isCaptureDiag({ ...diag, sampleRate: null, baseLatency: null, outputLatency: null })).toBe(true);
    expect(isCaptureDiag({ ...diag, state: 'failed', code: 'STREAM_NOT_AVAILABLE' })).toBe(true);
  });

  it('ties code to the failed state', () => {
    expect(isCaptureDiag({ ...diag, state: 'failed', code: null })).toBe(false);
    expect(isCaptureDiag({ ...diag, state: 'failed', code: 'NOPE' })).toBe(false);
    expect(isCaptureDiag({ ...diag, code: 'CAPTURE_BUSY' })).toBe(false);
  });

  it('rejects negative, fractional or non-finite numbers (R13: no implicit zero)', () => {
    expect(isCaptureDiag({ ...diag, samples: -1 })).toBe(false);
    expect(isCaptureDiag({ ...diag, samples: 1.5 })).toBe(false);
    expect(isCaptureDiag({ ...diag, seq: -1 })).toBe(false);
    expect(isCaptureDiag({ ...diag, baseLatency: Number.NaN })).toBe(false);
    expect(isCaptureDiag({ ...diag, outputLatency: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isCaptureDiag({ ...diag, sampleRate: 44_100.5 })).toBe(false);
    expect(isCaptureDiag({ ...diag, baseLatency: undefined })).toBe(false);
  });

  it('rejects unknown states', () => {
    expect(isCaptureDiag({ ...diag, state: 'LISTENING' })).toBe(false);
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

describe('error codes', () => {
  it('recognises SPEC §9 codes only', () => {
    expect(isCaptureErrorCode('NOT_YOUTUBE_WATCH')).toBe(true);
    expect(isCaptureErrorCode('INTERNAL_ERROR')).toBe(true);
    expect(isCaptureErrorCode('toString')).toBe(false);
    expect(isCaptureErrorCode('')).toBe(false);
  });
});
