// CaptureSession: watchdog (ADR-0004), machine wiring, single exit. Fake clock
// and timers: the real offscreen injects performance.now() and setTimeout.
import { isCaptureDiag, type CaptureDiag, type HeartbeatMessage } from '@voicecrystal/contracts';
import { describe, expect, it } from 'vitest';
import {
  AUTHORIZING_TIMEOUT_MS,
  CaptureSession,
  HEARTBEAT_TIMEOUT_MS,
  RELEASE_TIMEOUT_MS,
} from '../src/offscreen/capture-session.ts';

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
  private timers = new Map<number, { at: number; fn: () => void }>();
  private nextId = 1;
  readonly session: CaptureSession;
  private hbSeq = 0;

  constructor() {
    this.session = new CaptureSession(SESSION, TAB, {
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

  it('45 s of listening ends in INSUFFICIENT_DATA / WALL_TIMEOUT (no speech detector yet)', async () => {
    const h = listening();
    for (let i = 0; i < 46 && h.session.isLive(); i++) {
      await h.advance(1_000);
      h.heartbeat();
    }
    expect(h.last).toMatchObject({ state: 'INSUFFICIENT_DATA', exitReason: 'WALL_TIMEOUT' });
    expect(h.last?.activeMs).toBeGreaterThanOrEqual(45_000);
    expect(h.diags.some((d) => d.state === 'RESULT_READY')).toBe(false);
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
