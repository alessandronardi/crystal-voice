import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DESCRIPTOR_KEYS,
  SEED_UNITS_MAX,
  SEED_UNITS_MIN,
  assertNever,
  isCrystalSeed,
  isPingMessage,
  isPongMessage,
  isSeedUnits,
  makePong,
  type CaptureMessage,
} from '../src/index.ts';

const seedUnits = fc.integer({ min: SEED_UNITS_MIN, max: SEED_UNITS_MAX });

describe('seed guards', () => {
  it('accepts every tuple of six integers in [0, 10000]', () => {
    fc.assert(
      fc.property(fc.array(seedUnits, { minLength: 6, maxLength: 6 }), (seed) => {
        expect(isCrystalSeed(seed)).toBe(true);
      }),
    );
  });

  it('rejects out-of-range integers', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer({ max: SEED_UNITS_MIN - 1 }), fc.integer({ min: SEED_UNITS_MAX + 1 })),
        (n) => {
          expect(isSeedUnits(n)).toBe(false);
        },
      ),
    );
  });

  it('rejects non-integers, NaN, Infinity and null (R12, R13)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 10000, noInteger: true }),
        (x) => {
          expect(isSeedUnits(x)).toBe(false);
        },
      ),
    );
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, null, undefined, '5000']) {
      expect(isSeedUnits(bad)).toBe(false);
    }
  });

  it('rejects sparse arrays and arrays with undefined entries (R13)', () => {
    expect(isCrystalSeed(new Array(6))).toBe(false);
    const holey = [1, 2, 3, 4, 5, 6];
    // eslint-disable-next-line @typescript-eslint/no-array-delete -- building a hole on purpose
    delete holey[3];
    expect(isCrystalSeed(holey)).toBe(false);
    expect(isCrystalSeed([1, 2, 3, undefined, 5, 6])).toBe(false);
  });

  it('rejects tuples of the wrong length', () => {
    fc.assert(
      fc.property(
        fc.array(seedUnits).filter((a) => a.length !== 6),
        (seed) => {
          expect(isCrystalSeed(seed)).toBe(false);
        },
      ),
    );
  });

  it('keeps the canonical parameter order', () => {
    expect(DESCRIPTOR_KEYS).toEqual([
      'p1_pitch',
      'p2_intonation',
      'p3_dynamics',
      'p4_roughness',
      'p5_brightness',
      'p6_rhythm',
    ]);
  });
});

describe('diagnostic messages', () => {
  it('round-trips a ping into a matching pong', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 64 }), (nonce) => {
        const ping: unknown = { v: 1, type: 'PING', nonce };
        expect(isPingMessage(ping)).toBe(true);
        if (!isPingMessage(ping)) return;
        const pong = makePong(ping, '0.3.0');
        expect(isPongMessage(pong)).toBe(true);
        expect(pong.nonce).toBe(nonce);
      }),
    );
  });

  it('rejects malformed pings', () => {
    for (const bad of [
      null,
      [],
      'PING',
      { type: 'PING', nonce: 'x' },
      { v: 2, type: 'PING', nonce: 'x' },
      { v: 1, type: 'PING', nonce: '' },
      { v: 1, type: 'PING', nonce: 'x'.repeat(65) },
      { v: 1, type: 'PONG', nonce: 'x', extensionVersion: '0' },
    ]) {
      expect(isPingMessage(bad)).toBe(false);
    }
  });
});

describe('assertNever', () => {
  it('makes switches over CaptureMessage exhaustive and throws if reached', () => {
    const describeMessage = (m: CaptureMessage): string => {
      switch (m.type) {
        case 'CAPTURE_START':
        case 'CAPTURE_STOP':
        case 'HEARTBEAT':
        case 'MULTI_SPEAKER_ANSWER':
        case 'CAPTURE_PROGRESS':
        case 'CAPTURE_RESULT':
        case 'CAPTURE_FAILED':
          return m.type;
        default:
          return assertNever(m);
      }
    };
    expect(
      describeMessage({ v: 1, sessionId: 's', seq: 0, type: 'CAPTURE_STOP', reason: 'USER_STOP' }),
    ).toBe('CAPTURE_STOP');
    expect(() => assertNever('rogue' as never)).toThrow(TypeError);
  });
});
