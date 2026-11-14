// I-13a: the view machine of SPEC §6.2 (HOME → LIVE → REVEALED | OUTCOME → HOME), pure.
import { isCaptureDiag, type CaptureDiag, type QualitySummary } from '@voicecrystal/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { INITIAL_VIEW, viewTransition, type ViewEvent, type ViewState } from '../src/sidepanel/view-machine.ts';

const A = '3f1c2b4a-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
const B = '00000000-0000-4000-8000-000000000000';

const QUALITY: QualitySummary = {
  accepted: true,
  validSpeechMs: 18_000,
  pitchUsableFrames: 1200,
  vadSpeechFrames: 900,
  droppedFrames: 0,
  clippedFraction: 0,
  confidence: [1, 1, 1, 1, 1, 1],
  missingFeatureKeys: [],
  warnings: ['EXPERIMENTAL_MAPPING'],
};

function diag(sessionId: string, seq: number, over: Partial<CaptureDiag> = {}): CaptureDiag {
  return {
    v: 1,
    type: 'CAPTURE_DIAG',
    sessionId,
    seq,
    state: 'LISTENING',
    exitReason: null,
    code: null,
    samples: 48_000,
    sampleRate: 48_000,
    elapsedMs: 1000,
    activeMs: 1000,
    baseLatency: null,
    outputLatency: null,
    analysis: null,
    validSpeechMs: 0,
    stability: null,
    provisionalSeed: null,
    multiSpeaker: 'NONE',
    ...over,
  };
}

const ready = (sessionId: string, seq: number): CaptureDiag =>
  diag(sessionId, seq, {
    state: 'RESULT_READY',
    exitReason: 'MAX_VALID_SPEECH',
    analysis: { quality: QUALITY, seed: [1, 2, 3, 4, 5, 6], extractorVersion: 'extractor-0-experimental', mappingVersion: 'mapping-0-experimental', failure: null, analysedMs: 30_000, rawMeasures: [7.5, 3.4, 12.1, 0.21, 10.5, 4.1] },
  });

const run = (events: ViewEvent[], from: ViewState = INITIAL_VIEW): ViewState => events.reduce(viewTransition, from);

describe('view machine (SPEC §6.2)', () => {
  it('fixtures are valid diagnostics', () => {
    expect(isCaptureDiag(diag(A, 0))).toBe(true);
    expect(isCaptureDiag(ready(A, 3))).toBe(true);
  });

  it('HOME → LIVE on the first diagnostic of a session, LIVE follows its progress', () => {
    const live = run([{ type: 'CAPTURE_DIAG', diag: diag(A, 0, { state: 'AUTHORIZING' }), source: 'tab' }, { type: 'CAPTURE_DIAG', diag: diag(A, 1, { validSpeechMs: 4200 }), source: 'tab' }]);
    expect(live).toMatchObject({ screen: 'LIVE', source: 'tab', sessionId: A });
    expect(live.screen === 'LIVE' ? live.diag?.validSpeechMs : null).toBe(4200);
  });

  it('LIVE → REVEALED on RESULT_READY with an accepted seed; DISCARD → HOME', () => {
    const revealed = run([{ type: 'CAPTURE_DIAG', diag: diag(A, 0), source: 'mic' }, { type: 'CAPTURE_DIAG', diag: ready(A, 1), source: 'mic' }]);
    expect(revealed).toMatchObject({ screen: 'REVEALED', result: { source: 'mic', seed: [1, 2, 3, 4, 5, 6], exitReason: 'MAX_VALID_SPEECH' } });
    expect(viewTransition(revealed, { type: 'DISCARD' })).toEqual({ screen: 'HOME', closed: [A] });
  });

  it('INSUFFICIENT_DATA, INTERRUPTED and ERROR → OUTCOME; DISMISS → HOME', () => {
    for (const [state, exitReason, code] of [
      ['INSUFFICIENT_DATA', 'WALL_TIMEOUT', null],
      ['INTERRUPTED', 'USER_STOP', null],
      ['ERROR', 'CAPTURE_ERROR', 'STREAM_NOT_AVAILABLE'],
    ] as const) {
      const end = run([{ type: 'CAPTURE_DIAG', diag: diag(A, 0), source: 'tab' }, { type: 'CAPTURE_DIAG', diag: diag(A, 1, { state, exitReason, code }), source: 'tab' }]);
      expect(end).toMatchObject({ screen: 'OUTCOME', outcome: { state, exitReason, code } });
      expect(viewTransition(end, { type: 'DISMISS' })).toEqual({ screen: 'HOME', closed: [A] });
    }
  });

  it('never reveals without an accepted quality and a seed (SPEC §6.2 [F])', () => {
    const notAccepted = ready(A, 1);
    if (notAccepted.analysis?.quality) notAccepted.analysis.quality = { ...notAccepted.analysis.quality, accepted: false };
    expect(run([{ type: 'CAPTURE_DIAG', diag: notAccepted, source: 'tab' }]).screen).toBe('OUTCOME');
    expect(run([{ type: 'CAPTURE_DIAG', diag: diag(A, 1, { state: 'RESULT_READY', exitReason: 'CONVERGED' }), source: 'tab' }]).screen).toBe('OUTCOME');
  });

  it('ignores old seqs, a late final message of another session, and a session already closed', () => {
    const live = run([{ type: 'CAPTURE_DIAG', diag: diag(A, 5, { validSpeechMs: 900 }), source: 'tab' }]);
    expect(viewTransition(live, { type: 'CAPTURE_DIAG', diag: diag(A, 4, { validSpeechMs: 1 }), source: 'tab' })).toBe(live);
    expect(viewTransition(live, { type: 'CAPTURE_DIAG', diag: ready(B, 9), source: 'mic' })).toBe(live);
    const closed = run([{ type: 'CAPTURE_DIAG', diag: ready(A, 6), source: 'tab' }, { type: 'DISCARD' }], live);
    // The same final diagnostic sent again after «Scarta» does not bring the crystal back.
    expect(viewTransition(closed, { type: 'CAPTURE_DIAG', diag: ready(A, 7), source: 'tab' }).screen).toBe('HOME');
  });

  it('a live session that died silently never blocks the panel (review H-1)', () => {
    const live = run([{ type: 'CAPTURE_DIAG', diag: diag(A, 5), source: 'tab' }]);
    // A new session is alive: the old one is gone (the service worker allows one at a time).
    const next = viewTransition(live, { type: 'CAPTURE_DIAG', diag: diag(B, 0, { state: 'AUTHORIZING' }), source: 'mic' });
    expect(next).toMatchObject({ screen: 'LIVE', sessionId: B, source: 'mic' });
    expect(next.closed).toContain(A);
    expect(run([{ type: 'CAPTURE_DIAG', diag: ready(B, 1), source: 'mic' }], next).screen).toBe('REVEALED');
    // Lost without a new session: an error outcome, from which «Torna all'inizio» goes home.
    const lost = viewTransition(live, { type: 'CAPTURE_LOST', sessionId: A });
    expect(lost).toMatchObject({ screen: 'OUTCOME', outcome: { state: 'ERROR', exitReason: 'OFFSCREEN_CLOSED' } });
    expect(viewTransition(lost, { type: 'DISMISS' }).screen).toBe('HOME');
    expect(viewTransition(live, { type: 'CAPTURE_LOST', sessionId: B })).toBe(live);
  });

  it('a new session replaces a revealed result or an outcome (the toolbar can start one at any time)', () => {
    const revealed = run([{ type: 'CAPTURE_DIAG', diag: ready(A, 1), source: 'tab' }]);
    expect(run([{ type: 'CAPTURE_DIAG', diag: diag(B, 0, { state: 'AUTHORIZING' }), source: 'mic' }], revealed)).toMatchObject({ screen: 'LIVE', sessionId: B });
  });

  it('local file: LIVE while analysing, then REVEALED or OUTCOME; cancel → HOME', () => {
    const live = run([{ type: 'FILE_STARTED', fileName: 'voce.wav' }]);
    expect(live).toMatchObject({ screen: 'LIVE', source: 'file', fileName: 'voce.wav' });
    const done = viewTransition(live, {
      type: 'FILE_DONE',
      result: { seed: [9, 8, 7, 6, 5, 4], quality: QUALITY, extractorVersion: 'extractor-0-experimental', mappingVersion: 'mapping-0-experimental', rawMeasures: [7.5, 3.4, 12.1, 0.21, 10.5, 4.1] },
    });
    expect(done).toMatchObject({ screen: 'REVEALED', result: { source: 'file', fileName: 'voce.wav', seed: [9, 8, 7, 6, 5, 4], rawMeasures: [7.5, 3.4, 12.1, 0.21, 10.5, 4.1] } });
    const short = viewTransition(live, { type: 'FILE_DONE', result: { seed: null, quality: { ...QUALITY, validSpeechMs: 6000 }, extractorVersion: 'extractor-0-experimental', mappingVersion: 'mapping-0-experimental', rawMeasures: null } });
    expect(short).toMatchObject({ screen: 'OUTCOME', outcome: { source: 'file', state: 'INSUFFICIENT_DATA' } });
    expect(viewTransition(live, { type: 'FILE_FAILED', code: 'FILE_DECODE_FAILED', message: 'Troppo lungo' })).toMatchObject({ screen: 'OUTCOME', outcome: { state: 'ERROR', code: 'FILE_DECODE_FAILED', message: 'Troppo lungo' } });
    expect(viewTransition(live, { type: 'FILE_CANCELLED' })).toEqual(INITIAL_VIEW);
  });

  it('a file result with less than 8 s of valid speech is never revealed (D-AA)', () => {
    const live = run([{ type: 'FILE_STARTED', fileName: 'x.wav' }]);
    const r = viewTransition(live, { type: 'FILE_DONE', result: { seed: [1, 1, 1, 1, 1, 1], quality: { ...QUALITY, validSpeechMs: 7990 }, extractorVersion: 'extractor-0-experimental', mappingVersion: 'mapping-0-experimental', rawMeasures: null } });
    expect(r.screen).toBe('OUTCOME');
  });

  it('REVEALED is reached only with an accepted seed, whatever the events (property)', () => {
    const states = ['AUTHORIZING', 'LISTENING', 'PAUSED', 'FINALIZING', 'RESULT_READY', 'INSUFFICIENT_DATA', 'INTERRUPTED', 'ERROR'] as const;
    const event = fc.oneof(
      fc.record({ s: fc.constantFrom(A, B), seq: fc.nat(20), state: fc.constantFrom(...states), accepted: fc.boolean(), seed: fc.boolean() }).map(
        (r): ViewEvent => {
          const terminal = ['RESULT_READY', 'INSUFFICIENT_DATA', 'INTERRUPTED', 'ERROR'].includes(r.state);
          return {
            type: 'CAPTURE_DIAG',
            source: 'tab',
            diag: diag(r.s, r.seq, {
              state: r.state,
              exitReason: terminal ? 'WALL_TIMEOUT' : null,
              analysis:
                r.state === 'RESULT_READY'
                  ? { quality: { ...QUALITY, accepted: r.accepted }, seed: r.seed ? [1, 2, 3, 4, 5, 6] : null, extractorVersion: 'x', mappingVersion: 'm', failure: null, analysedMs: 1, rawMeasures: [1, 1, 1, 1, 1, 1] }
                  : null,
            }),
          };
        },
      ),
      fc.constantFrom<ViewEvent>({ type: 'DISCARD' }, { type: 'DISMISS' }, { type: 'FILE_CANCELLED' }, { type: 'FILE_STARTED', fileName: 'f.wav' }),
    );
    fc.assert(
      fc.property(fc.array(event, { maxLength: 30 }), (events) => {
        let v: ViewState = INITIAL_VIEW;
        for (const e of events) {
          v = viewTransition(v, e);
          if (v.screen === 'REVEALED' && !(v.result.quality.accepted && v.result.quality.validSpeechMs >= 8000)) return false;
        }
        return true;
      }),
    );
  });
});
