// CaptureSession: watchdog (ADR-0004), machine wiring, single exit. Fake clock
// and timers: the real offscreen injects performance.now() and setTimeout.
import { isCaptureDiag, type CaptureDiag, type HeartbeatMessage } from '@voicecrystal/contracts';
import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_TIMEOUT_MS,
  AUTHORIZING_TIMEOUT_MS,
  CaptureSession,
  HEARTBEAT_TIMEOUT_MS,
  PANEL_ATTACH_TIMEOUT_MS,
  RELEASE_TIMEOUT_MS,
  type SessionAnalysis,
  type SessionBinding,
} from '../src/offscreen/capture-session.ts';
import type { StreamProgress } from '../src/shared/dsp-protocol.ts';
import type { QualitySummary } from '@voicecrystal/contracts';

const NO_VOICE_QUALITY: QualitySummary = {
  accepted: false,
  validSpeechMs: 0,
  pitchUsableFrames: 0,
  vadSpeechFrames: 0,
  droppedFrames: 0,
  clippedFraction: 0,
  confidence: [0, 0, 0, 0, 0, 0],
  missingFeatureKeys: ['p1_pitch', 'p2_intonation', 'p3_dynamics', 'p4_roughness', 'p5_brightness', 'p6_rhythm'],
  warnings: ['EXPERIMENTAL_MAPPING'],
};

/** What the fake worker answers in FINALIZING: by default the tone of the E2E pages (no crystal). */
const NO_VOICE: SessionAnalysis = {
  analysis: {
    quality: NO_VOICE_QUALITY,
    seed: null,
    extractorVersion: 'extractor-0-experimental',
    mappingVersion: 'mapping-0-experimental',
    failure: null,
    analysedMs: 45_000,
  },
  accepted: false,
  validSpeechMs: 0,
};

function voice(validSpeechMs: number): SessionAnalysis {
  return {
    analysis: {
      ...NO_VOICE.analysis,
      quality: { ...NO_VOICE_QUALITY, accepted: true, validSpeechMs, missingFeatureKeys: [], confidence: [1, 1, 1, 1, 1, 0.8] },
      seed: [4000, 5000, 3000, 0, 2500, 6000],
    },
    accepted: true,
    validSpeechMs,
  };
}

const SESSION = '3f1c2b4a-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
const OTHER = '00000000-0000-4000-8000-000000000000';
const TAB = 7;
const RATE = 48_000;

class Harness {
  now = 0;
  diags: CaptureDiag[] = [];
  releases = 0;
  idles = 0;
  releaseThrows = false;
  releaseHangs = false;
  /** The worker's answer in FINALIZING; 'hang' never answers, 'reject' breaks the contract. */
  analysisOutcome: SessionAnalysis | 'hang' | 'reject' = NO_VOICE;
  finalizations = 0;
  recording: boolean[] = [];
  captureEnded = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  private nextId = 1;
  readonly session: CaptureSession;
  private hbSeq = 0;

  constructor(binding: SessionBinding = { source: 'tab', tabId: TAB }) {
    this.session = new CaptureSession(SESSION, binding, {
      now: () => this.now,
      setTimer: (fn, ms) => {
        const id = this.nextId++;
        this.timers.set(id, { at: this.now + ms, fn });
        return id;
      },
      clearTimer: (handle) => {
        this.timers.delete(handle as number);
      },
      emit: (diag) => {
        this.diags.push(diag);
      },
      release: () => {
        this.releases++;
        if (this.releaseHangs) return new Promise<void>(() => undefined);
        return this.releaseThrows ? Promise.reject(new Error('boom')) : Promise.resolve();
      },
      onIdle: () => {
        this.idles++;
      },
      finalize: () => {
        this.finalizations++;
        const o = this.analysisOutcome;
        if (o === 'hang') return new Promise<SessionAnalysis>(() => undefined);
        if (o === 'reject') return Promise.reject(new Error('worker gone'));
        return Promise.resolve(o);
      },
      setRecording: (record) => {
        this.recording.push(record);
      },
      endCapture: () => {
        this.captureEnded++;
      },
    });
  }

  /** Moves the clock, firing due timers, and feeds the worklet count at RATE. */
  async advance(ms: number, samplesFlow = true): Promise<void> {
    const step = 100;
    for (let t = 0; t < ms; t += step) {
      this.now += step;
      if (samplesFlow) this.samples += (RATE * step) / 1000;
      this.session.onSamples(this.samples);
      for (const [id, timer] of [...this.timers]) {
        if (timer.at <= this.now) {
          this.timers.delete(id);
          timer.fn();
        }
      }
      if (this.now % 500 === 0) this.session.tick();
    }
    await flush();
  }

  samples = 0;

  /** `tab` null means a sender without a tab. */
  heartbeat(overrides: Partial<HeartbeatMessage> = {}, tab: number | null = TAB): boolean {
    return this.session.onHeartbeat(
      {
        v: 1,
        type: 'HEARTBEAT',
        sessionId: SESSION,
        seq: this.hbSeq++,
        videoId: 'abc',
        url: 'https://www.youtube.com/watch?v=abc',
        paused: false,
        playbackRate: 1,
        muted: false,
        volume: 1,
        ...overrides,
      },
      tab ?? undefined,
    );
  }

  get last(): CaptureDiag | undefined {
    return this.diags.at(-1);
  }

  start(): void {
    this.session.acquired({ sampleRate: RATE, baseLatency: 0.01, outputLatency: 0.02 });
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function listening(): Harness {
  const h = new Harness();
  h.start();
  h.heartbeat();
  return h;
}

describe('CaptureSession lifecycle', () => {
  it('goes AUTHORIZING → LISTENING and every diagnostic is valid with increasing seq', async () => {
    const h = new Harness();
    expect(h.diags.map((d) => d.state)).toEqual(['AUTHORIZING']);
    h.start();
    h.heartbeat();
    await h.advance(2_000);
    expect(h.last?.state).toBe('LISTENING');
    for (const [i, d] of h.diags.entries()) {
      expect(isCaptureDiag(d)).toBe(true);
      expect(d.seq).toBe(i);
    }
  });

  it('an error while acquiring ends in ERROR with its code, released once', async () => {
    const h = new Harness();
    h.session.denied('STREAM_NOT_AVAILABLE');
    await flush();
    expect(h.last).toMatchObject({ state: 'ERROR', exitReason: 'CAPTURE_ERROR', code: 'STREAM_NOT_AVAILABLE' });
    expect(h.releases).toBe(1);
    expect(h.idles).toBe(1);
    expect(h.session.state).toBe('IDLE');
  });

  it('stop is idempotent: one release, one final message, one IDLE', async () => {
    const h = listening();
    h.session.stop('USER_STOP');
    h.session.stop('USER_STOP');
    h.session.stop('NAVIGATED_AWAY');
    await flush();
    expect(h.releases).toBe(1);
    expect(h.idles).toBe(1);
    expect(h.diags.filter((d) => d.state === 'INTERRUPTED')).toHaveLength(1);
    expect(h.last).toMatchObject({ state: 'INTERRUPTED', exitReason: 'USER_STOP' });
    expect(h.heartbeat()).toBe(false);
  });

  it('a failing release still emits the final message and returns to IDLE', async () => {
    const h = listening();
    h.releaseThrows = true;
    h.session.stop('USER_STOP');
    await flush().catch(() => undefined);
    expect(h.last?.state).toBe('INTERRUPTED');
    expect(h.idles).toBe(1);
  });

  it(`a stream that never arrives ends AUTHORIZING with ERROR after ${AUTHORIZING_TIMEOUT_MS} ms (review M-2)`, async () => {
    const h = new Harness();
    await h.advance(AUTHORIZING_TIMEOUT_MS - 100, false);
    expect(h.session.state).toBe('AUTHORIZING');
    await h.advance(200, false);
    expect(h.last).toMatchObject({ state: 'ERROR', exitReason: 'CAPTURE_ERROR', code: 'STREAM_NOT_AVAILABLE' });
    expect(h.idles).toBe(1);
  });

  it('acquiring in time cancels the authorization timeout', async () => {
    const h = listening();
    for (let i = 0; i < 12; i++) {
      await h.advance(1_000);
      h.heartbeat();
    }
    expect(h.session.state).toBe('LISTENING');
  });

  it(`a release that hangs still reaches IDLE after ${RELEASE_TIMEOUT_MS} ms (review L-4)`, async () => {
    const h = listening();
    h.releaseHangs = true;
    h.session.stop('USER_STOP');
    await flush();
    expect(h.idles).toBe(0);
    await h.advance(RELEASE_TIMEOUT_MS + 100, false);
    expect(h.idles).toBe(1);
    expect(h.session.state).toBe('IDLE');
    expect(h.last?.state).toBe('INTERRUPTED');
  });

  it('a stream that ends is an ERROR with STREAM_ENDED', async () => {
    const h = listening();
    h.session.stop('STREAM_ENDED');
    await flush();
    expect(h.last).toMatchObject({ state: 'ERROR', exitReason: 'STREAM_ENDED', code: 'STREAM_NOT_AVAILABLE' });
  });
});

describe('heartbeat watchdog (ADR-0004)', () => {
  it(`interrupts with NAVIGATED_AWAY after ${HEARTBEAT_TIMEOUT_MS} ms without heartbeat`, async () => {
    const h = listening();
    await h.advance(2_900);
    expect(h.session.state).toBe('LISTENING');
    await h.advance(200);
    expect(h.last).toMatchObject({ state: 'INTERRUPTED', exitReason: 'NAVIGATED_AWAY' });
    expect(h.idles).toBe(1);
  });

  it('heartbeats keep the session alive', async () => {
    const h = listening();
    for (let i = 0; i < 10; i++) {
      await h.advance(1_000);
      expect(h.heartbeat()).toBe(true);
    }
    expect(h.session.state).toBe('LISTENING');
  });

  it('the first heartbeat has the same 3 s margin from the start', async () => {
    const h = new Harness();
    h.start();
    await h.advance(3_100);
    expect(h.last?.exitReason).toBe('NAVIGATED_AWAY');
  });

  it('ignores and counts heartbeats from another tab, another session or with an old seq', async () => {
    const h = listening();
    await h.advance(1_000);
    h.heartbeat({}, 8);
    h.heartbeat({}, null);
    h.heartbeat({ sessionId: OTHER });
    h.session.onHeartbeat(
      {
        v: 1,
        type: 'HEARTBEAT',
        sessionId: SESSION,
        seq: 0,
        videoId: 'abc',
        url: 'https://www.youtube.com/watch?v=abc',
        paused: false,
        playbackRate: 1,
        muted: false,
        volume: 1,
      },
      TAB,
    );
    expect(h.session.ignored).toMatchObject({ wrongTab: 2, wrongSession: 1, staleSeq: 1 });
    // None of them reset the watchdog.
    await h.advance(2_100);
    expect(h.last?.exitReason).toBe('NAVIGATED_AWAY');
  });

  it('a URL off /watch interrupts at once with NAVIGATED_AWAY', async () => {
    const h = listening();
    expect(h.heartbeat({ url: 'https://www.youtube.com/', videoId: '' })).toBe(false);
    await flush();
    expect(h.last).toMatchObject({ state: 'INTERRUPTED', exitReason: 'NAVIGATED_AWAY' });
  });

  it('another host interrupts with NAVIGATED_AWAY', async () => {
    const h = listening();
    h.heartbeat({ url: 'https://evil.example/watch?v=abc' });
    await flush();
    expect(h.last?.exitReason).toBe('NAVIGATED_AWAY');
  });

  it('a different video id interrupts with VIDEO_CHANGED (SPEC §6.1)', async () => {
    const h = listening();
    h.heartbeat({ url: 'https://www.youtube.com/watch?v=xyz', videoId: 'xyz' });
    await flush();
    expect(h.last?.exitReason).toBe('VIDEO_CHANGED');
  });

  it('a playback rate other than 1 interrupts with PLAYBACK_RATE_CHANGED', async () => {
    const h = listening();
    h.heartbeat({ playbackRate: 1.5 });
    await flush();
    expect(h.last?.exitReason).toBe('PLAYBACK_RATE_CHANGED');
  });

  it('seek and source-change events interrupt with their reasons', async () => {
    for (const [kind, reason] of [
      ['seek', 'VIDEO_SEEK'],
      ['source-change', 'AD_OR_SOURCE_CHANGE'],
    ] as const) {
      const h = listening();
      expect(h.session.onPlayerEvent({ v: 1, type: 'PLAYER_EVENT', sessionId: SESSION, seq: 99, kind }, TAB)).toBe(
        false,
      );
      await flush();
      expect(h.last?.exitReason).toBe(reason);
    }
  });

  it('tells senders from another tab or session to stop; an old seq of its own session does not (review L-3)', () => {
    const h = listening();
    expect(h.heartbeat({}, 8)).toBe(false);
    expect(h.heartbeat({ sessionId: OTHER })).toBe(false);
    expect(
      h.session.onHeartbeat(
        {
          v: 1,
          type: 'HEARTBEAT',
          sessionId: SESSION,
          seq: 0,
          videoId: 'abc',
          url: 'https://www.youtube.com/watch?v=abc',
          paused: false,
          playbackRate: 1,
          muted: false,
          volume: 1,
        },
        TAB,
      ),
    ).toBe(true);
  });

  it('a player event from another tab is ignored', async () => {
    const h = listening();
    h.session.onPlayerEvent({ v: 1, type: 'PLAYER_EVENT', sessionId: SESSION, seq: 99, kind: 'seek' }, 8);
    await flush();
    expect(h.session.state).toBe('LISTENING');
  });
});

describe('microphone sessions (I-17)', () => {
  const MIC: SessionBinding = { source: 'mic' };

  /** A microphone session with its panel attached, listening. */
  function micListening(): Harness {
    const h = new Harness(MIC);
    expect(h.session.attachPanel()).toBe(true);
    h.start();
    return h;
  }

  it('has no heartbeat watchdog: it keeps listening with no content script at all', async () => {
    const h = micListening();
    await h.advance(HEARTBEAT_TIMEOUT_MS * 5);
    expect(h.session.state).toBe('LISTENING');
    expect(h.last?.activeMs).toBeGreaterThan(14_000);
  });

  it('rejects every heartbeat and player event as not its own', () => {
    const h = micListening();
    expect(h.heartbeat()).toBe(false);
    expect(h.heartbeat({}, null)).toBe(false);
    expect(h.session.onPlayerEvent({ v: 1, type: 'PLAYER_EVENT', sessionId: SESSION, seq: 99, kind: 'seek' }, TAB)).toBe(
      false,
    );
    expect(h.session.ignored.wrongTab).toBe(3);
    // Not even a paused player can pause it (SPEC §6.1: PAUSED is for the tab only).
    expect(h.session.state).toBe('LISTENING');
  });

  it('closing the panel stops the session with USER_STOP, once', async () => {
    const h = micListening();
    await h.advance(1_000);
    h.session.detachPanel();
    h.session.detachPanel();
    await flush();
    expect(h.last).toMatchObject({ state: 'INTERRUPTED', exitReason: 'USER_STOP' });
    expect(h.releases).toBe(1);
    expect(h.idles).toBe(1);
  });

  it('closing the panel while authorizing also stops it', async () => {
    const h = new Harness(MIC);
    h.session.attachPanel();
    h.session.detachPanel();
    await flush();
    expect(h.last).toMatchObject({ state: 'INTERRUPTED', exitReason: 'USER_STOP' });
  });

  it(`with no panel port within ${PANEL_ATTACH_TIMEOUT_MS} ms the session stops (panel closed during the start)`, async () => {
    const h = new Harness(MIC);
    h.start();
    await h.advance(PANEL_ATTACH_TIMEOUT_MS - 100);
    expect(h.session.state).toBe('LISTENING');
    await h.advance(200);
    expect(h.last).toMatchObject({ state: 'INTERRUPTED', exitReason: 'USER_STOP' });
  });

  it('accepts one panel only, and none for a tab session or after the end', async () => {
    const h = micListening();
    expect(h.session.attachPanel()).toBe(false);
    expect(new Harness().session.attachPanel()).toBe(false);
    h.session.stop('USER_STOP');
    await flush();
    expect(h.session.attachPanel()).toBe(false);
  });

  it('a detach without an attached panel changes nothing', async () => {
    const h = new Harness(MIC);
    h.session.detachPanel();
    h.start();
    await flush();
    expect(h.session.state).toBe('LISTENING');
  });

  it(`a microphone that never opens ends with MIC_PERMISSION_REQUIRED after ${AUTHORIZING_TIMEOUT_MS} ms`, async () => {
    const h = new Harness(MIC);
    h.session.attachPanel();
    await h.advance(AUTHORIZING_TIMEOUT_MS + 100, false);
    expect(h.last).toMatchObject({ state: 'ERROR', exitReason: 'CAPTURE_ERROR', code: 'MIC_PERMISSION_REQUIRED' });
  });

  it('with a grant, a microphone that never opens ends with STREAM_NOT_AVAILABLE (review L-1)', async () => {
    const h = new Harness(MIC);
    h.session.attachPanel();
    h.session.setAuthorizingTimeoutCode('STREAM_NOT_AVAILABLE');
    await h.advance(AUTHORIZING_TIMEOUT_MS + 100, false);
    expect(h.last).toMatchObject({ state: 'ERROR', code: 'STREAM_NOT_AVAILABLE' });
  });

  it('45 s of listening ends in INSUFFICIENT_DATA / WALL_TIMEOUT, as for the tab', async () => {
    const h = micListening();
    await h.advance(46_000);
    expect(h.last).toMatchObject({ state: 'INSUFFICIENT_DATA', exitReason: 'WALL_TIMEOUT' });
  });

  it('stop() is accepted from every state of a microphone session', async () => {
    for (const step of ['authorizing', 'listening', 'ended'] as const) {
      const h = new Harness(MIC);
      h.session.attachPanel();
      if (step !== 'authorizing') h.start();
      if (step === 'ended') {
        h.session.stop('USER_STOP');
        await flush();
      }
      h.session.stop('USER_STOP');
      await flush();
      expect(h.session.state).toBe('IDLE');
      expect(h.idles).toBe(1);
    }
  });
});

describe('pause and times [H] (SPEC §6)', () => {
  it('pause → PAUSED with active time frozen; resume → LISTENING', async () => {
    const h = listening();
    await h.advance(1_000);
    h.heartbeat();
    h.heartbeat({ paused: true });
    expect(h.session.state).toBe('PAUSED');
    const frozen = h.last?.activeMs ?? -1;
    for (let i = 0; i < 5; i++) {
      await h.advance(1_000);
      h.heartbeat({ paused: true });
    }
    expect(h.session.state).toBe('PAUSED');
    expect(h.last?.activeMs).toBeCloseTo(frozen, 0);
    expect(h.last?.elapsedMs).toBeGreaterThan(5_000);
    h.heartbeat({ paused: false });
    expect(h.session.state).toBe('LISTENING');
  });

  it('45 s of listening without voice ends in INSUFFICIENT_DATA / WALL_TIMEOUT, with the analysis', async () => {
    const h = listening();
    for (let i = 0; i < 46 && h.session.isLive(); i++) {
      await h.advance(1_000);
      h.heartbeat();
    }
    expect(h.last).toMatchObject({ state: 'INSUFFICIENT_DATA', exitReason: 'WALL_TIMEOUT' });
    expect(h.last?.activeMs).toBeGreaterThanOrEqual(45_000);
    expect(h.diags.some((d) => d.state === 'RESULT_READY')).toBe(false);
    expect(h.finalizations).toBe(1);
    expect(h.last?.analysis?.quality?.missingFeatureKeys).toHaveLength(6);
    expect(isCaptureDiag(h.last)).toBe(true);
  });

  it('paused sessions end at 120 s from the start, pauses included', async () => {
    const h = listening();
    await h.advance(1_000);
    h.heartbeat({ paused: true });
    for (let i = 0; i < 121 && h.session.isLive(); i++) {
      await h.advance(1_000);
      h.heartbeat({ paused: true });
    }
    expect(h.last).toMatchObject({ state: 'INSUFFICIENT_DATA', exitReason: 'ABSOLUTE_TIMEOUT' });
    expect(h.last?.elapsedMs).toBeGreaterThanOrEqual(120_000);
  });
});

describe('FINALIZING and the end-of-session analysis (I-06b, ADR-0025)', () => {
  async function toWallTimeout(h: Harness): Promise<void> {
    for (let i = 0; i < 46 && h.session.isLive(); i++) {
      await h.advance(1_000);
      h.heartbeat();
    }
  }

  it('a voice with at least 8 s of valid speech gives RESULT_READY with its seed', async () => {
    const h = listening();
    h.analysisOutcome = voice(9_000);
    await toWallTimeout(h);
    await h.advance(100);
    expect(h.last).toMatchObject({ state: 'RESULT_READY', exitReason: 'WALL_TIMEOUT' });
    expect(h.last?.analysis?.seed).toEqual([4000, 5000, 3000, 0, 2500, 6000]);
    expect(h.diags.some((d) => d.state === 'FINALIZING' && d.analysis === null)).toBe(true);
    for (const d of h.diags) expect(isCaptureDiag(d), d.state).toBe(true);
    expect(h.session.state).toBe('IDLE');
  });

  it('an accepted analysis under 8 s of valid speech is INSUFFICIENT_DATA and shows no seed (SPEC §6.1)', async () => {
    const h = listening();
    h.analysisOutcome = voice(7_990);
    await toWallTimeout(h);
    await h.advance(100);
    expect(h.last?.state).toBe('INSUFFICIENT_DATA');
    expect(h.last?.analysis?.seed).toBeNull();
    expect(h.last?.analysis?.quality?.validSpeechMs).toBe(7_990);
    expect(isCaptureDiag(h.last)).toBe(true);
  });

  it('a worker that never answers ends in INSUFFICIENT_DATA after the timeout, with the reason', async () => {
    const h = listening();
    h.analysisOutcome = 'hang';
    await toWallTimeout(h);
    expect(h.session.state).toBe('FINALIZING');
    await h.advance(ANALYSIS_TIMEOUT_MS + 200);
    expect(h.last).toMatchObject({ state: 'INSUFFICIENT_DATA', exitReason: 'WALL_TIMEOUT' });
    expect(h.last?.analysis).toEqual({ quality: null, seed: null, extractorVersion: null, mappingVersion: null, failure: 'ANALYSIS_TIMEOUT', analysedMs: null });
    expect(isCaptureDiag(h.last)).toBe(true);
    expect(h.session.state).toBe('IDLE');
  });

  it('a finalize that rejects is ANALYSIS_FAILED, never a crash', async () => {
    const h = listening();
    h.analysisOutcome = 'reject';
    await toWallTimeout(h);
    await h.advance(100);
    expect(h.last?.analysis?.failure).toBe('ANALYSIS_FAILED');
    expect(h.last?.state).toBe('INSUFFICIENT_DATA');
  });

  it('a stop during FINALIZING wins: INTERRUPTED without analysis, the timeout then changes nothing', async () => {
    const h = listening();
    h.analysisOutcome = 'hang';
    await toWallTimeout(h);
    expect(h.session.state).toBe('FINALIZING');
    h.session.stop('USER_STOP');
    await h.advance(100);
    expect(h.last).toMatchObject({ state: 'INTERRUPTED', exitReason: 'USER_STOP', analysis: null });
    const count = h.diags.length;
    await h.advance(ANALYSIS_TIMEOUT_MS + 200);
    expect(h.diags).toHaveLength(count);
    expect(h.diags.some((d) => d.state === 'RESULT_READY' || d.state === 'INSUFFICIENT_DATA')).toBe(false);
  });

  it('records only while listening: on at the start, off in a pause, on again, off in FINALIZING', async () => {
    const h = listening();
    await h.advance(1_000);
    h.heartbeat({ paused: true });
    await h.advance(1_000);
    h.heartbeat({ paused: false });
    await toWallTimeout(h);
    expect(h.recording).toEqual([true, false, true, false]);
  });
});

describe('FINALIZING captures nothing (review C-1, R8, ADR-0004)', () => {
  async function finalizing(): Promise<Harness> {
    const h = listening();
    h.analysisOutcome = 'hang';
    for (let i = 0; i < 46 && h.session.isLive() && h.session.state !== 'FINALIZING'; i++) {
      await h.advance(1_000);
      h.heartbeat();
    }
    expect(h.session.state).toBe('FINALIZING');
    return h;
  }

  it('the capture ends on entering FINALIZING, before the analysis answers', async () => {
    const h = await finalizing();
    expect(h.captureEnded).toBe(1);
    expect(h.finalizations).toBe(1);
  });

  it('the "stream ended" that follows its own end of capture is not an error (E2E regression, tab)', async () => {
    const h = await finalizing();
    h.session.stop('STREAM_ENDED');
    h.session.stop('NAVIGATED_AWAY');
    await h.advance(100);
    expect(h.session.state).toBe('FINALIZING');
    await h.advance(ANALYSIS_TIMEOUT_MS);
    expect(h.last).toMatchObject({ state: 'INSUFFICIENT_DATA', exitReason: 'WALL_TIMEOUT' });
  });

  it('navigation away during the analysis finds no capture: the content script is told to stop, nothing is re-armed', async () => {
    const h = await finalizing();
    expect(h.heartbeat({ url: 'https://example.com/' })).toBe(false);
    const ignoredBefore = h.session.ignored.rejectedEvent;
    await h.advance(HEARTBEAT_TIMEOUT_MS + 1_000, false);
    // No watchdog in FINALIZING: no INTERRUPT queued against the analysis.
    expect(h.session.ignored.rejectedEvent).toBe(ignoredBefore);
    expect(h.captureEnded).toBe(1);
    // The analysis then decides; the timeout gives INSUFFICIENT_DATA and everything is released.
    await h.advance(ANALYSIS_TIMEOUT_MS);
    expect(h.last?.state).toBe('INSUFFICIENT_DATA');
    expect(h.releases).toBe(1);
  });
});

describe('split-half progress from the worker (I-07, ADR-0026)', () => {
  function progress(over: Partial<StreamProgress> = {}): StreamProgress {
    return { audioSeconds: 14, validSpeechMs: 8_410, evaluations: 0, last: null, converged: false, provisionalSeed: null, analysisMs: 200, failure: null, ...over };
  }
  const passed = (seconds: number, consecutive: number): StreamProgress['last'] => ({
    seconds,
    differences: [1, 1, 1, 1, 1, 1],
    s: 1,
    passed: true,
    blockedBy: null,
    consecutive,
  });

  it('a converged evaluation stops the session at once with CONVERGED, and the seed comes from the final analysis', async () => {
    const h = listening();
    h.analysisOutcome = voice(12_000);
    await h.advance(2_000);
    h.heartbeat();
    h.session.onProgress(progress({ validSpeechMs: 10_200, evaluations: 3, last: passed(10, 3), converged: true }));
    expect(h.session.state).toBe('FINALIZING');
    expect(h.captureEnded).toBe(1);
    expect(h.finalizations).toBe(1);
    await h.advance(100);
    expect(h.last).toMatchObject({ state: 'RESULT_READY', exitReason: 'CONVERGED', validSpeechMs: 10_200 });
    expect(h.last?.stability).toEqual({ stopRuleVersion: 'split-half-0', evaluations: 3, seconds: 10, s: 1, blockedBy: null, consecutive: 3, converged: true, analysisMs: 200 });
    expect(h.last?.analysis?.seed).toEqual([4000, 5000, 3000, 0, 2500, 6000]);
    for (const d of h.diags) expect(isCaptureDiag(d), d.state).toBe(true);
  });

  it('the valid speech of the evaluations reaches the TICK: 18 s ends with MAX_VALID_SPEECH (SPEC §6.1)', async () => {
    const h = listening();
    h.analysisOutcome = voice(18_000);
    h.session.onProgress(progress({ validSpeechMs: 17_990 }));
    await h.advance(1_000);
    h.heartbeat();
    expect(h.session.state).toBe('LISTENING');
    expect(h.last?.validSpeechMs).toBe(17_990);
    h.session.onProgress(progress({ validSpeechMs: 18_000 }));
    await h.advance(500);
    expect(h.session.state).not.toBe('LISTENING');
    await h.advance(100);
    expect(h.last).toMatchObject({ state: 'RESULT_READY', exitReason: 'MAX_VALID_SPEECH' });
  });

  it('a convergence that arrives in a pause is applied when listening resumes, not lost', async () => {
    const h = listening();
    h.analysisOutcome = voice(12_000);
    h.heartbeat({ paused: true });
    expect(h.session.state).toBe('PAUSED');
    h.session.onProgress(progress({ evaluations: 3, last: passed(10, 3), converged: true }));
    await h.advance(1_000);
    h.heartbeat({ paused: true });
    expect(h.session.state).toBe('PAUSED');
    h.heartbeat({ paused: false });
    await h.advance(500);
    expect(h.diags.some((d) => d.state === 'FINALIZING')).toBe(true);
    await h.advance(100);
    expect(h.last).toMatchObject({ state: 'RESULT_READY', exitReason: 'CONVERGED' });
  });

  it('a progress after FINALIZING or after the end is late: ignored and counted', async () => {
    const h = listening();
    h.analysisOutcome = 'hang';
    h.session.onProgress(progress({ evaluations: 3, last: passed(10, 3), converged: true }));
    expect(h.session.state).toBe('FINALIZING');
    h.session.onProgress(progress({ validSpeechMs: 30_000 }));
    expect(h.session.ignored.lateProgress).toBe(1);
    await h.advance(ANALYSIS_TIMEOUT_MS + 500);
    expect(h.last?.state).toBe('INSUFFICIENT_DATA');
    expect(h.last?.validSpeechMs).toBe(8_410);
    h.session.onProgress(progress());
    expect(h.session.ignored.lateProgress).toBe(2);
  });

  it('a failed evaluation keeps the last valid speech (review M-3): the 18 s limit still works afterwards', async () => {
    const h = listening();
    h.analysisOutcome = voice(18_000);
    h.session.onProgress(progress({ validSpeechMs: 17_990 }));
    h.session.onProgress(progress({ validSpeechMs: 0, failure: 'INTERNAL' }));
    await h.advance(500);
    expect(h.last?.validSpeechMs).toBe(17_990);
    expect(h.session.state).toBe('LISTENING');
    h.session.onProgress(progress({ validSpeechMs: 18_010 }));
    await h.advance(500);
    await h.advance(100);
    expect(h.last).toMatchObject({ state: 'RESULT_READY', exitReason: 'MAX_VALID_SPEECH' });
  });

  it('carries the germ\'s seed while listening and drops it at the end (I-13a)', async () => {
    const h = listening();
    h.analysisOutcome = voice(12_000);
    h.session.onProgress(progress({ provisionalSeed: [4000, 5000, 3000, 0, 2500, 6000] }));
    await h.advance(500);
    expect(h.last?.provisionalSeed).toEqual([4000, 5000, 3000, 0, 2500, 6000]);
    h.session.onProgress(progress({ evaluations: 3, last: passed(10, 3), converged: true, provisionalSeed: [1, 1, 1, 1, 1, 1] }));
    await h.advance(100);
    expect(h.last?.state).toBe('RESULT_READY');
    expect(h.last?.provisionalSeed).toBeNull();
    for (const d of h.diags) expect(isCaptureDiag(d), d.state).toBe(true);
  });

  it('without evaluations the diagnostic says so: no valid speech, no stability', async () => {
    const h = listening();
    await h.advance(1_000);
    expect(h.last).toMatchObject({ validSpeechMs: 0, stability: null });
  });
});
