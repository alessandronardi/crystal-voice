import { describe, expect, it } from 'vitest';
import {
  PANEL_PORT_PREFIX,
  TERMINAL_CAPTURE_STATES,
  isCaptureDiag,
  isCaptureStability,
  isQualitySummary,
  isCaptureStartMessage,
  isOffscreenStartMic,
  isFileSessionEnd,
  isFileSessionPing,
  isFileSessionPong,
  panelPortSessionId,
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
  analysis: null,

  validSpeechMs: 0,

  stability: null,
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

describe('OFFSCREEN_START_MIC and the panel port', () => {
  it('accepts a well-formed start, with no stream ID', () => {
    expect(isOffscreenStartMic({ v: 1, type: 'OFFSCREEN_START_MIC', sessionId: SESSION })).toBe(true);
    expect(isOffscreenStartMic({ v: 1, type: 'OFFSCREEN_START_MIC', sessionId: 'x' })).toBe(false);
    expect(isOffscreenStartMic({ v: 2, type: 'OFFSCREEN_START_MIC', sessionId: SESSION })).toBe(false);
    expect(isOffscreenStartMic({ v: 1, type: 'OFFSCREEN_START_TAB', sessionId: SESSION })).toBe(false);
    expect(isOffscreenStartMic(null)).toBe(false);
  });

  it('reads the session id of a panel port name', () => {
    expect(panelPortSessionId(`${PANEL_PORT_PREFIX}${SESSION}`)).toBe(SESSION);
    expect(panelPortSessionId(`${PANEL_PORT_PREFIX}nope`)).toBeNull();
    expect(panelPortSessionId(SESSION)).toBeNull();
    expect(panelPortSessionId('')).toBeNull();
  });
});

describe('FILE_SESSION_END (I-18, ADR-0022)', () => {
  it('accepts a well-formed end and nothing else', () => {
    expect(isFileSessionEnd({ v: 1, type: 'FILE_SESSION_END', sessionId: SESSION })).toBe(true);
    expect(isFileSessionEnd({ v: 1, type: 'FILE_SESSION_END', sessionId: 'x' })).toBe(false);
    expect(isFileSessionEnd({ v: 2, type: 'FILE_SESSION_END', sessionId: SESSION })).toBe(false);
    expect(isFileSessionEnd({ v: 1, type: 'OFFSCREEN_STOP', sessionId: SESSION })).toBe(false);
    expect(isFileSessionEnd([{ v: 1, type: 'FILE_SESSION_END', sessionId: SESSION }])).toBe(false);
    expect(isFileSessionEnd(null)).toBe(false);
  });

  it('ping and pong are distinct well-formed messages', () => {
    const ping = { v: 1, type: 'FILE_SESSION_PING', sessionId: SESSION };
    const pong = { v: 1, type: 'FILE_SESSION_PONG', sessionId: SESSION };
    expect(isFileSessionPing(ping)).toBe(true);
    expect(isFileSessionPong(pong)).toBe(true);
    expect(isFileSessionPing(pong)).toBe(false);
    expect(isFileSessionPong(ping)).toBe(false);
    expect(isFileSessionPong({ ...pong, sessionId: 'x' })).toBe(false);
    expect(isFileSessionPong(undefined)).toBe(false);
    expect(isFileSessionPong(true)).toBe(false);
  });
});

describe('CAPTURE_START guard', () => {
  const mic = { v: 1, type: 'CAPTURE_START', source: 'mic', tabId: null, sessionId: SESSION, seq: 0 };
  it('accepts tab starts with a tab and mic or file starts without one', () => {
    expect(isCaptureStartMessage(mic)).toBe(true);
    expect(isCaptureStartMessage({ ...mic, source: 'file' })).toBe(true);
    expect(isCaptureStartMessage({ ...mic, source: 'tab', tabId: 7 })).toBe(true);
  });

  it('rejects a mismatched tab id, unknown sources and bad envelopes', () => {
    expect(isCaptureStartMessage({ ...mic, tabId: 7 })).toBe(false);
    expect(isCaptureStartMessage({ ...mic, source: 'tab' })).toBe(false);
    expect(isCaptureStartMessage({ ...mic, source: 'tab', tabId: -1 })).toBe(false);
    expect(isCaptureStartMessage({ ...mic, source: 'screen' })).toBe(false);
    const { tabId: _t, ...noTab } = mic;
    expect(isCaptureStartMessage(noTab)).toBe(false);
    expect(isCaptureStartMessage({ ...mic, sessionId: 'x' })).toBe(false);
    expect(isCaptureStartMessage({ ...mic, seq: -1 })).toBe(false);
    expect(isCaptureStartMessage({ ...mic, v: 2 })).toBe(false);
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

describe('CAPTURE_DIAG analysis (I-06b, D-Y)', () => {
  const quality = {
    accepted: true,
    validSpeechMs: 9_000,
    pitchUsableFrames: 700,
    vadSpeechFrames: 450,
    droppedFrames: 0,
    clippedFraction: 0,
    confidence: [1, 1, 0.9, 1, 1, 0.6],
    missingFeatureKeys: [],
    warnings: ['EXPERIMENTAL_MAPPING'],
  };
  const ok = { quality, seed: [1, 2, 3, 4, 5, 6], extractorVersion: 'extractor-0-experimental', mappingVersion: 'mapping-0-experimental', failure: null, analysedMs: 45_000 };
  const ready = { ...diag, state: 'RESULT_READY', exitReason: 'WALL_TIMEOUT', analysis: ok };

  it('accepts a result with a seed, and a refusal with its measures', () => {
    expect(isCaptureDiag(ready)).toBe(true);
    expect(isQualitySummary(quality)).toBe(true);
    const refused = { ...ok, seed: null, quality: { ...quality, accepted: false, missingFeatureKeys: ['p6_rhythm'] } };
    expect(isCaptureDiag({ ...ready, state: 'INSUFFICIENT_DATA', analysis: refused })).toBe(true);
    const failed = { quality: null, seed: null, extractorVersion: null, mappingVersion: null, failure: 'ANALYSIS_TIMEOUT', analysedMs: null };
    expect(isCaptureDiag({ ...ready, state: 'INSUFFICIENT_DATA', analysis: failed })).toBe(true);
  });

  it('ties the analysis to the states FINALIZING leads to', () => {
    expect(isCaptureDiag({ ...ready, analysis: null })).toBe(false); // RESULT_READY without analysis
    expect(isCaptureDiag({ ...diag, analysis: ok })).toBe(false); // LISTENING with analysis
    expect(isCaptureDiag({ ...ready, state: 'INTERRUPTED', exitReason: 'USER_STOP' })).toBe(false);
    expect(isCaptureDiag({ ...ready, analysis: { ...ok, seed: null } })).toBe(false);
    expect(isCaptureDiag({ ...ready, analysis: { ...ok, extractorVersion: null } })).toBe(false);
    expect(isCaptureDiag({ ...ready, analysis: { ...ok, failure: 'ANALYSIS_FAILED' } })).toBe(false);
    // Review M-1: the guard holds the invariants the panel relies on.
    expect(isCaptureDiag({ ...ready, analysis: { ...ok, quality: { ...quality, accepted: false } } })).toBe(false);
    expect(isCaptureDiag({ ...ready, state: 'INSUFFICIENT_DATA', analysis: ok })).toBe(false); // a seed outside RESULT_READY
    const empty = { quality: null, seed: null, extractorVersion: null, mappingVersion: null, failure: null, analysedMs: null };
    expect(isCaptureDiag({ ...ready, state: 'INSUFFICIENT_DATA', analysis: empty })).toBe(false);
  });

  it('rejects malformed seeds, confidences, keys and warnings', () => {
    expect(isCaptureDiag({ ...ready, analysis: { ...ok, seed: [1, 2, 3, 4, 5, 6.5] } })).toBe(false);
    expect(isCaptureDiag({ ...ready, analysis: { ...ok, seed: [1, 2, 3, 4, 5, 10_001] } })).toBe(false);
    expect(isQualitySummary({ ...quality, confidence: [1, 1, 1, 1, 1] })).toBe(false);
    expect(isQualitySummary({ ...quality, confidence: [1, 1, 1, 1, 1, 1.5] })).toBe(false);
    expect(isQualitySummary({ ...quality, missingFeatureKeys: ['p7'] })).toBe(false);
    expect(isQualitySummary({ ...quality, warnings: ['LOUD'] })).toBe(false);
    expect(isQualitySummary({ ...quality, validSpeechMs: Number.NaN })).toBe(false);
    expect(isCaptureDiag({ ...ready, analysis: { ...ok, failure: 'OOPS' } })).toBe(false);
    expect(isCaptureDiag({ ...ready, analysis: { ...ok, analysedMs: -1 } })).toBe(false);
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

describe('CAPTURE_DIAG valid speech and stability (I-07)', () => {
  const stability = { stopRuleVersion: 'split-half-0', evaluations: 4, seconds: 11, s: 3.2, blockedBy: null, consecutive: 2, converged: false, analysisMs: 240 };

  it('accepts a live diagnostic with the split-half state', () => {
    expect(isCaptureDiag({ ...diag, validSpeechMs: 11_240, stability })).toBe(true);
    expect(isCaptureStability({ stopRuleVersion: 'split-half-0', evaluations: 0, seconds: null, s: null, blockedBy: null, consecutive: 0, converged: false, analysisMs: null })).toBe(true);
    expect(isCaptureStability({ ...stability, s: null, blockedBy: 'HALF_INCOMPLETE', consecutive: 0 })).toBe(true);
  });

  it('refuses inconsistent or malformed values', () => {
    expect(isCaptureDiag({ ...diag, validSpeechMs: -1 })).toBe(false);
    expect(isCaptureDiag({ ...diag, validSpeechMs: undefined })).toBe(false);
    expect(isCaptureDiag({ ...diag, stability: undefined })).toBe(false);
    // A failed evaluation resets the run; a passed one belongs to it.
    expect(isCaptureStability({ ...stability, blockedBy: 'UNSTABLE' })).toBe(false);
    expect(isCaptureStability({ ...stability, consecutive: 0 })).toBe(false);
    expect(isCaptureStability({ ...stability, consecutive: 5 })).toBe(false);
    expect(isCaptureStability({ ...stability, blockedBy: 'SOMETHING' })).toBe(false);
    expect(isCaptureStability({ ...stability, s: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isCaptureStability({ ...stability, analysisMs: -1 })).toBe(false);
    expect(isCaptureStability({ ...stability, stopRuleVersion: '' })).toBe(false);
    // Nothing set before the first evaluation.
    expect(isCaptureStability({ stopRuleVersion: 'split-half-0', evaluations: 0, seconds: 8, s: null, blockedBy: null, consecutive: 0, converged: false, analysisMs: null })).toBe(false);
    expect(isCaptureStability({ stopRuleVersion: 'split-half-0', evaluations: 0, seconds: null, s: null, blockedBy: null, consecutive: 0, converged: true, analysisMs: null })).toBe(false);
  });
});
