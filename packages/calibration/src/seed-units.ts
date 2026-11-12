// Seed units (SPEC §7.5, ADR-0006, AGENTS.md R12): a point p in [0, 100]
// becomes an integer in [0, 10000] by half-even rounding of 100·p. Decimals
// exist only for display.

import { SEED_UNITS_MAX, SEED_UNITS_MIN, type SeedUnits } from '@voicecrystal/contracts';
import { CalibrationError } from './errors.ts';

/**
 * Half-even ("banker's") rounding to an integer: ties go to the even
 * neighbour (0.5 → 0, 1.5 → 2, 2.5 → 2). `v − floor(v)` is exact in binary
 * floating point, so a tie is detected exactly.
 */
export function roundHalfEven(v: number): number {
  if (!Number.isFinite(v)) throw new CalibrationError('NON_FINITE', `cannot round ${String(v)}`);
  const f = Math.floor(v);
  const d = v - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** Point in [0, 100] → seed units in [0, 10000]. Out-of-range points are a caller bug. */
export function toSeedUnits(point: number): SeedUnits {
  if (!Number.isFinite(point) || point < 0 || point > 100) {
    throw new CalibrationError('POINT_OUT_OF_RANGE', `point ${String(point)} outside [0, 100]`);
  }
  const units = roundHalfEven(point * 100);
  // `+ 0` turns a −0 (impossible here, kept as a guard) into 0.
  return Math.min(SEED_UNITS_MAX, Math.max(SEED_UNITS_MIN, units)) + 0;
}
