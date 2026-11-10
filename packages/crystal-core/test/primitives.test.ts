import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { asciiBytes, sha256, toHex } from '../src/geometry/sha256.ts';
import { prngFor, xoshiro128ss } from '../src/geometry/prng.ts';
import { continuousNoise, NOISE_CELL } from '../src/geometry/noise.ts';
import { DIRECTIONS_30, dot, mulMatVec, quaternionToMatrix } from '../src/geometry/linear.ts';

describe('SHA-256 (FIPS 180-4 vectors)', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ])('sha256(%j)', (msg, hex) => {
    expect(toHex(sha256(asciiBytes(msg)))).toBe(hex);
  });

  it('one million "a"', () => {
    expect(toHex(sha256(new Uint8Array(1000000).fill(0x61)))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('rejects non-ASCII canonical strings', () => {
    expect(() => asciiBytes('è')).toThrow(RangeError);
  });
});

describe('xoshiro128**', () => {
  // Reference outputs cross-checked with an independent Python implementation (2026-11-10).
  it('matches the reference sequence for state (1, 2, 3, 4)', () => {
    const p = xoshiro128ss([1, 2, 3, 4]);
    expect([0, 1, 2, 3, 4, 5].map(() => p.nextUint32())).toEqual([11520, 0, 5927040, 70819200, 2031721883, 1637235492]);
  });

  it('seeds from the first 128 bits of SHA-256 of the canonical string', () => {
    const p = prngFor('habit-1|test');
    expect([0, 1, 2, 3].map(() => p.nextUint32())).toEqual([2799395393, 1737583629, 3206259622, 1550248705]);
  });

  it('next() is in [0, 1)', () => {
    const p = prngFor('x');
    for (let i = 0; i < 1000; i++) {
      const v = p.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('continuous noise (ADR-0018)', () => {
  const p4 = fc.tuple(fc.integer({ min: 0, max: 10000 }), fc.integer({ min: 0, max: 10000 }), fc.integer({ min: 0, max: 10000 }), fc.integer({ min: 0, max: 10000 }));

  it('is deterministic, in [0, 1), and equals the node value on lattice nodes', () => {
    expect(NOISE_CELL).toBe(5000);
    const a = continuousNoise('habit-1', 'secondary', [5000, 10000, 0, 5000], 5);
    expect(continuousNoise('habit-1', 'secondary', [5000, 10000, 0, 5000], 5)).toEqual(a);
    const node = prngFor('habit-1|secondary|1,2,0,1');
    for (const v of a) expect(v).toBe(node.next());
  });

  it('changes by a bounded amount for a 100-unit step in one parameter', () => {
    // smoothstep slope ≤ 1.5 per cell; value range 1 → |Δ| ≤ 1.5·100/NOISE_CELL per corner blend.
    const bound = (1.5 * 100) / NOISE_CELL + 1e-12;
    fc.assert(
      fc.property(p4, fc.integer({ min: 0, max: 3 }), (p, k) => {
        const q = [...p] as [number, number, number, number];
        q[k] = Math.min(10000, (q[k] ?? 0) + 100);
        const a = continuousNoise('habit-1', 'inclusions', p, 3);
        const b = continuousNoise('habit-1', 'inclusions', q, 3);
        a.forEach((v, i) => {
          expect(Math.abs(v - (b[i] ?? 0))).toBeLessThanOrEqual(bound);
        });
      }),
      { numRuns: 200 },
    );
  });

  it('domains are independent', () => {
    expect(continuousNoise('habit-1', 'secondary', [0, 0, 0, 0], 2)).not.toEqual(continuousNoise('habit-1', 'orientation', [0, 0, 0, 0], 2));
  });

  it('adding channels does not change earlier ones', () => {
    const a = continuousNoise('habit-1', 'secondary', [1234, 5678, 910, 1112], 3);
    const b = continuousNoise('habit-1', 'secondary', [1234, 5678, 910, 1112], 6);
    expect(Array.from(b.slice(0, 3))).toEqual(Array.from(a));
  });
});

describe('exact directions and rational rotations', () => {
  it('directions at 30° steps are unit vectors with the exact constants', () => {
    for (const [c, s] of DIRECTIONS_30) expect(Math.abs(c * c + s * s - 1)).toBeLessThan(1e-15);
    expect(DIRECTIONS_30[4]).toEqual([-0.5, Math.sqrt(3) / 2]);
  });

  it('quaternion matrices are orthonormal and continuous', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.5, max: 2, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }), (w, x, y, z) => {
        const m = quaternionToMatrix(w, x, y, z);
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) expect(Math.abs(dot(m[i] ?? [0, 0, 0], m[j] ?? [0, 0, 0]) - (i === j ? 1 : 0))).toBeLessThan(1e-12);
        }
        const v = mulMatVec(m, [1, 2, 3]);
        expect(Math.abs(dot(v, v) - 14)).toBeLessThan(1e-9);
      }),
      { numRuns: 100 },
    );
  });
});
