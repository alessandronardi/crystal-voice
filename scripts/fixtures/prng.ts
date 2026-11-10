// Seeded PRNG for fixture generation (I-04). Fixture scripts only: never used
// by crystal-core, which has its own per-domain PRNG (SPEC §10).
//
// mulberry32: 32-bit state, integer-only arithmetic, so the sequence is
// identical on every JS engine. Reference outputs are pinned in
// tests/unit/fixtures/prng.test.ts.

export interface Prng {
  /** Next uint32 in [0, 2^32). */
  nextUint32(): number;
  /** Next float in [0, 1), with 32 bits of resolution. */
  next(): number;
  /** Next float in [min, max). */
  range(min: number, max: number): number;
}

export function createPrng(seed: number): Prng {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError(`PRNG seed must be a uint32, got ${String(seed)}`);
  }
  let state = seed >>> 0;
  const nextUint32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  const next = (): number => nextUint32() / 4294967296;
  return {
    nextUint32,
    next,
    range: (min, max) => min + (max - min) * next(),
  };
}
