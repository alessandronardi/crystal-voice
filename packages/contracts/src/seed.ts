// Canonical seed types. Transcribed from SPEC v0.3 §7.5 (Δ12) and AGENTS.md R12.

/** Integer in [0, 10000] (hundredths of a percentile point). `Number.isInteger` is mandatory. */
export type SeedUnits = number;

export const SEED_UNITS_MIN = 0;
export const SEED_UNITS_MAX = 10000;

export type CrystalSeed = readonly [
  p1_pitch: SeedUnits,
  p2_intonation: SeedUnits,
  p3_dynamics: SeedUnits,
  p4_roughness: SeedUnits,
  p5_brightness: SeedUnits,
  p6_rhythm: SeedUnits,
];

/** Per-parameter confidence, each in [0, 1] (ADR-0014). */
export type SeedConfidence = readonly [number, number, number, number, number, number];

export type DescriptorKey =
  | 'p1_pitch'
  | 'p2_intonation'
  | 'p3_dynamics'
  | 'p4_roughness'
  | 'p5_brightness'
  | 'p6_rhythm';

/** Immutable parameter order (SPEC §7.5). */
export const DESCRIPTOR_KEYS: readonly DescriptorKey[] = [
  'p1_pitch',
  'p2_intonation',
  'p3_dynamics',
  'p4_roughness',
  'p5_brightness',
  'p6_rhythm',
];

export function isSeedUnits(value: unknown): value is SeedUnits {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= SEED_UNITS_MIN &&
    value <= SEED_UNITS_MAX
  );
}

/**
 * Structural guard for untrusted input: exactly six integers in [0, 10000].
 * Indexed loop on purpose: `Array.prototype.every` skips holes, so a sparse
 * `new Array(6)` (kept as such by structured clone / IndexedDB) would pass.
 */
export function isCrystalSeed(value: unknown): value is CrystalSeed {
  if (!Array.isArray(value) || value.length !== 6) return false;
  for (let i = 0; i < 6; i += 1) {
    if (!(i in value) || !isSeedUnits(value[i])) return false;
  }
  return true;
}
