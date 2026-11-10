// xoshiro128** (Blackman & Vigna), SPEC §10 / ADR-0010. State: the first 128
// bits of SHA-256 of a canonical ASCII serialization, as four big-endian uint32.
// Integer-only arithmetic: identical on every engine.

import { asciiBytes, sha256 } from './sha256.ts';

export interface Xoshiro {
  nextUint32(): number;
  /** Float in [0, 1) with 32 bits of resolution (exact: uint32 / 2^32). */
  next(): number;
}

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

export function xoshiro128ss(state: readonly [number, number, number, number]): Xoshiro {
  const s = Uint32Array.from(state);
  if (s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 0) s[0] = 1; // all-zero state is invalid
  const nextUint32 = (): number => {
    const s0 = s[0] ?? 0;
    const s1 = s[1] ?? 0;
    const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    const s2 = (s[2] ?? 0) ^ s0;
    const s3 = (s[3] ?? 0) ^ s1;
    s[1] = s1 ^ s2;
    s[0] = s0 ^ s3;
    s[2] = s2 ^ t;
    s[3] = rotl(s3, 11);
    return result;
  };
  return { nextUint32, next: () => nextUint32() / 4294967296 };
}

/** PRNG seeded from SHA-256 of `canonical` (ADR-0010, ADR-0018). */
export function prngFor(canonical: string): Xoshiro {
  const digest = sha256(asciiBytes(canonical));
  const view = new DataView(digest.buffer);
  return xoshiro128ss([view.getUint32(0, false), view.getUint32(4, false), view.getUint32(8, false), view.getUint32(12, false)]);
}
