// Model tests of the capture machine (SPEC §6.1, ADR-0011, I-03 DoD).
import fc from 'fast-check';
import type { CaptureState } from '@voicecrystal/contracts';
import { describe, expect, it } from 'vitest';
import {
  CAPTURE_LIMITS,
  INITIAL_STATE,
  isTerminal,
  transition,
  type CaptureEvent,
  type MachineState,
} from '../src/offscreen/capture-machine.ts';

const ALL_STATES: readonly CaptureState[] = [
  'IDLE',
  'AUTHORIZING',
  'LISTENING',
  'WAITING_FOR_SPEECH',
  'PAUSED',
  'FINALIZING',
  'RESULT_READY',
  'INSUFFICIENT_DATA',
  'INTERRUPTED',
  'ERROR',
];

// Independent oracle: the edges of SPEC §6.1, written out by hand (self-loops
// for accepted no-op events such as TICK below the limits are allowed too).
const SPEC_EDGES: Readonly<Record<CaptureState, readonly CaptureState[]>> = {
  IDLE: ['AUTHORIZING'],
  AUTHORIZING: ['LISTENING', 'ERROR'],
  LISTENING: ['WAITING_FOR_SPEECH', 'PAUSED', 'FINALIZING', 'INTERRUPTED', 'ERROR'],
  WAITING_FOR_SPEECH: ['LISTENING', 'PAUSED', 'FINALIZING', 'INTERRUPTED', 'ERROR'],
  PAUSED: ['LISTENING', 'FINALIZING', 'INTERRUPTED', 'ERROR'],
  FINALIZING: ['RESULT_READY', 'INSUFFICIENT_DATA'],
  RESULT_READY: ['IDLE'],
  INSUFFICIENT_DATA: ['IDLE'],
  INTERRUPTED: ['IDLE'],
  ERROR: ['IDLE'],
};

// Edges beyond SPEC §6.1, required by «stop() accepted from every state»:
// proposed amendment to ADR-0011 (2026-11-11), awaiting the product owner.
const AMENDMENT_EDGES: Partial<Record<CaptureState, readonly CaptureState[]>> = {
  AUTHORIZING: ['INTERRUPTED'],
  FINALIZING: ['INTERRUPTED', 'ERROR'],
};

const EDGES: Record<CaptureState, readonly CaptureState[]> = { ...SPEC_EDGES };
for (const s of ALL_STATES) EDGES[s] = [...SPEC_EDGES[s], ...(AMENDMENT_EDGES[s] ?? [])];

const ms = fc.integer({ min: 0, max: 200_000 });

const eventArb: fc.Arbitrary<CaptureEvent> = fc.oneof(
  fc.constant<CaptureEvent>({ type: 'START' }),
  fc.constant<CaptureEvent>({ type: 'ACQUIRED' }),
  fc.constant<CaptureEvent>({ type: 'DENIED', code: 'PERMISSION_DENIED' }),
  fc.constant<CaptureEvent>({ type: 'VAD_PAUSE' }),
  fc.constant<CaptureEvent>({ type: 'VOICE_RESUMES' }),
  fc.constant<CaptureEvent>({ type: 'PLAYER_PAUSED' }),
  fc.constant<CaptureEvent>({ type: 'PLAYER_RESUMED' }),
  fc.constant<CaptureEvent>({ type: 'SPLIT_HALF_STABLE' }),
  fc.record({ activeMs: ms, elapsedMs: ms, validSpeechMs: ms }).map((t): CaptureEvent => ({ type: 'TICK', ...t })),
  fc
    .constantFrom(
      'VIDEO_SEEK',
      'VIDEO_CHANGED',
      'PLAYBACK_RATE_CHANGED',
      'AD_OR_SOURCE_CHANGE',
      'NAVIGATED_AWAY',
      'USER_STOP',
      'MULTI_SPEAKER_DECLINED',
    )
    .map((reason): CaptureEvent => ({ type: 'INTERRUPT', reason })),
  fc
    .constantFrom('STREAM_ENDED', 'CAPTURE_ERROR', 'OFFSCREEN_CLOSED')
    .map((reason): CaptureEvent => ({ type: 'FAIL', reason, code: 'INTERNAL_ERROR' })),
  fc.record({ accepted: fc.boolean(), validSpeechMs: ms }).map((q): CaptureEvent => ({ type: 'QUALITY', ...q })),
  fc.constant<CaptureEvent>({ type: 'RELEASED' }),
  fc.constant<CaptureEvent>({ type: 'STOP' }),
);

function run(events: readonly CaptureEvent[], from: MachineState = INITIAL_STATE): MachineState[] {
  const trace = [from];
  let current = from;
  for (const event of events) {
    current = transition(current, event).next;
    trace.push(current);
  }
  return trace;
}

/** Reaches IDLE the way the offscreen does: stop, release. */
function drain(state: MachineState): MachineState {
  let current = transition(state, { type: 'STOP' }).next;
  if (current.state === 'FINALIZING') current = transition(current, { type: 'QUALITY', accepted: false, validSpeechMs: 0 }).next;
  return transition(current, { type: 'RELEASED' }).next.state === 'IDLE'
    ? transition(current, { type: 'RELEASED' }).next
    : current;
}

describe('capture machine model (SPEC §6.1)', () => {
  it('every reachable state reaches IDLE with stop + release', () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 40 }), (events) => {
        for (const state of run(events)) {
          expect(drain(state).state).toBe('IDLE');
        }
      }),
      { numRuns: 500 },
    );
  });

  it('stop() is accepted in every state', () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 40 }), (events) => {
        for (const state of run(events)) {
          expect(transition(state, { type: 'STOP' }).accepted).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('no transition outside the declared table', () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 60 }), (events) => {
        let current = INITIAL_STATE;
        for (const event of events) {
          const { next, accepted } = transition(current, event);
          if (!accepted) expect(next).toBe(current);
          if (next.state !== current.state) expect(EDGES[current.state]).toContain(next.state);
          current = next;
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('terminal states change only through RELEASED, to IDLE', () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 40 }), eventArb, (events, event) => {
        for (const state of run(events)) {
          if (!isTerminal(state.state)) continue;
          const { next } = transition(state, event);
          if (event.type === 'RELEASED') expect(next.state).toBe('IDLE');
          else expect(next).toBe(state);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('exitReason is set exactly in FINALIZING and terminal states; code only in ERROR', () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 40 }), (events) => {
        for (const s of run(events)) {
          const needsReason = s.state === 'FINALIZING' || isTerminal(s.state);
          expect(s.exitReason !== null).toBe(needsReason);
          expect(s.code !== null).toBe(s.state === 'ERROR');
        }
      }),
      { numRuns: 500 },
    );
  });

  it('RESULT_READY needs accepted quality and at least 8 s of valid speech', () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 60 }), (events) => {
        let current = INITIAL_STATE;
        for (const event of events) {
          const next = transition(current, event).next;
          if (next.state === 'RESULT_READY' && current.state !== 'RESULT_READY') {
            expect(event.type).toBe('QUALITY');
            if (event.type === 'QUALITY') {
              expect(event.accepted).toBe(true);
              expect(event.validSpeechMs).toBeGreaterThanOrEqual(CAPTURE_LIMITS.minValidSpeechMs);
            }
          }
          current = next;
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('every state of SPEC §6.1 is reachable by a declared path', () => {
    const start: CaptureEvent[] = [{ type: 'START' }];
    const listen: CaptureEvent[] = [...start, { type: 'ACQUIRED' }];
    const finalize: CaptureEvent[] = [...listen, { type: 'SPLIT_HALF_STABLE' }];
    const paths: Readonly<Record<CaptureState, readonly CaptureEvent[]>> = {
      IDLE: [],
      AUTHORIZING: start,
      LISTENING: listen,
      WAITING_FOR_SPEECH: [...listen, { type: 'VAD_PAUSE' }],
      PAUSED: [...listen, { type: 'PLAYER_PAUSED' }],
      FINALIZING: finalize,
      RESULT_READY: [...finalize, { type: 'QUALITY', accepted: true, validSpeechMs: 8_000 }],
      INSUFFICIENT_DATA: [...finalize, { type: 'QUALITY', accepted: true, validSpeechMs: 7_999 }],
      INTERRUPTED: [...listen, { type: 'INTERRUPT', reason: 'NAVIGATED_AWAY' }],
      ERROR: [...start, { type: 'DENIED', code: 'PERMISSION_DENIED' }],
    };
    for (const state of ALL_STATES) {
      expect(run(paths[state]).at(-1)?.state, state).toBe(state);
    }
  });
});

describe('capture machine times [H] (SPEC §6)', () => {
  const listening = run([{ type: 'START' }, { type: 'ACQUIRED' }]).at(-1) as MachineState;

  it('45 s of active time finalizes with WALL_TIMEOUT', () => {
    const below = transition(listening, { type: 'TICK', activeMs: 44_999, elapsedMs: 50_000, validSpeechMs: 0 });
    expect(below.next.state).toBe('LISTENING');
    const at = transition(listening, { type: 'TICK', activeMs: 45_000, elapsedMs: 50_000, validSpeechMs: 0 });
    expect(at.next).toEqual({ state: 'FINALIZING', exitReason: 'WALL_TIMEOUT', code: null });
  });

  it('18 s of valid speech finalizes with MAX_VALID_SPEECH', () => {
    const at = transition(listening, { type: 'TICK', activeMs: 20_000, elapsedMs: 20_000, validSpeechMs: 18_000 });
    expect(at.next.exitReason).toBe('MAX_VALID_SPEECH');
  });

  it('while paused only the 120 s absolute timeout runs', () => {
    const paused = transition(listening, { type: 'PLAYER_PAUSED' }).next;
    expect(paused.state).toBe('PAUSED');
    const frozen = transition(paused, { type: 'TICK', activeMs: 45_000, elapsedMs: 119_999, validSpeechMs: 18_000 });
    expect(frozen.next.state).toBe('PAUSED');
    const timeout = transition(paused, { type: 'TICK', activeMs: 10_000, elapsedMs: 120_000, validSpeechMs: 0 });
    expect(timeout.next).toEqual({ state: 'FINALIZING', exitReason: 'ABSOLUTE_TIMEOUT', code: null });
  });

  it('finalizing without enough speech gives INSUFFICIENT_DATA and keeps the reason', () => {
    const finalizing = transition(listening, { type: 'TICK', activeMs: 45_000, elapsedMs: 45_000, validSpeechMs: 0 }).next;
    expect(transition(finalizing, { type: 'QUALITY', accepted: true, validSpeechMs: 7_999 }).next).toEqual({
      state: 'INSUFFICIENT_DATA',
      exitReason: 'WALL_TIMEOUT',
      code: null,
    });
  });
});
