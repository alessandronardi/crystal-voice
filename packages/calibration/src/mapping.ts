// Quantile mapping (SPEC §7.5, ADR-0006): p_i = 100 · F_i(x_i), with F_i the
// empirical distribution function tabulated as 101 percentiles P0…P100 and
// interpolated linearly; values outside the table saturate at 0 or 100.
// Arithmetic only (no Math.log2 etc.), so the point depends only on x_i.

import { DESCRIPTOR_KEYS, type CrystalSeed, type DescriptorKey, type QualityWarning } from '@voicecrystal/contracts';
import { CalibrationError } from './errors.ts';
import { toSeedUnits } from './seed-units.ts';
import mapping0Json from '../mapping-0-experimental.json' with { type: 'json' };

export interface ParameterTable {
  measure: string;
  unit: string;
  /** 101 values, non-decreasing: P0 … P100. */
  percentiles: readonly number[];
}

export interface MappingTable {
  mappingVersion: string;
  /** True before G1 (mapping-0): the result carries EXPERIMENTAL_MAPPING. */
  experimental: boolean;
  parameters: Readonly<Record<DescriptorKey, ParameterTable>>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validates an untrusted table: 101 finite non-decreasing percentiles per parameter, P0 < P100. */
export function parseMappingTable(value: unknown): MappingTable {
  if (!isRecord(value)) throw new CalibrationError('BAD_TABLE', 'mapping table is not an object');
  const { mappingVersion, experimental, parameters } = value;
  if (typeof mappingVersion !== 'string' || mappingVersion.length === 0) throw new CalibrationError('BAD_TABLE', 'missing mappingVersion');
  if (typeof experimental !== 'boolean') throw new CalibrationError('BAD_TABLE', 'missing experimental flag');
  if (!isRecord(parameters)) throw new CalibrationError('BAD_TABLE', 'missing parameters');
  const out: Partial<Record<DescriptorKey, ParameterTable>> = {};
  for (const key of DESCRIPTOR_KEYS) {
    const p = parameters[key];
    if (!isRecord(p)) throw new CalibrationError('BAD_TABLE', `missing table for ${key}`);
    const { measure, unit, percentiles } = p;
    if (typeof measure !== 'string' || typeof unit !== 'string') throw new CalibrationError('BAD_TABLE', `${key}: measure and unit required`);
    if (!Array.isArray(percentiles) || percentiles.length !== 101) throw new CalibrationError('BAD_TABLE', `${key}: 101 percentiles required`);
    const values: number[] = [];
    for (let k = 0; k < 101; k++) {
      const v: unknown = percentiles[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new CalibrationError('BAD_TABLE', `${key}: P${k} is not a finite number`);
      const prev = values[k - 1];
      if (prev !== undefined && v < prev) throw new CalibrationError('BAD_TABLE', `${key}: P${k} decreases`);
      values.push(v);
    }
    if (!((values[100] ?? 0) > (values[0] ?? 0))) throw new CalibrationError('BAD_TABLE', `${key}: P100 must exceed P0`);
    out[key] = { measure, unit, percentiles: Object.freeze(values) };
  }
  return Object.freeze({ mappingVersion, experimental, parameters: Object.freeze(out as Record<DescriptorKey, ParameterTable>) });
}

/** The pre-G1 table (SPEC §7.5). Validated when the module loads: a bad file fails closed. */
export const MAPPING_0: MappingTable = parseMappingTable(mapping0Json);
export const MAPPING_0_VERSION = 'mapping-0-experimental';
if (MAPPING_0.mappingVersion !== MAPPING_0_VERSION || !MAPPING_0.experimental) {
  throw new CalibrationError('BAD_TABLE', 'mapping-0-experimental.json has the wrong version or flag');
}

/**
 * F(x)·100 by linear interpolation between percentiles, non-decreasing in x.
 * Flat runs (equal consecutive percentiles, possible in mapping-1): a value
 * equal to an interior run maps to the run's upper end; a value at or below
 * P0 maps to 0 and at or above P100 to 100, even when P0 or P100 belong to a
 * run (review L-4: to be revisited with the real tables of I-09).
 */
export function mapToPoint(table: ParameterTable, x: number): number {
  if (!Number.isFinite(x)) throw new CalibrationError('NON_FINITE', `raw measure ${String(x)}`);
  const p = table.percentiles;
  const first = p[0] ?? 0;
  const last = p[100] ?? 0;
  if (x <= first) return 0;
  if (x >= last) return 100;
  // Largest k with p[k] <= x (binary search); then p[k] <= x < p[k + 1].
  let lo = 0;
  let hi = 100;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((p[mid] ?? 0) <= x) lo = mid;
    else hi = mid;
  }
  const a = p[lo] ?? 0;
  const b = p[lo + 1] ?? a;
  const point = lo + (x - a) / (b - a);
  return point < 0 ? 0 : point > 100 ? 100 : point;
}

export interface MappedSeed {
  seed: CrystalSeed;
  /** p_i in [0, 100], before quantization (display only). */
  points: readonly [number, number, number, number, number, number];
  mappingVersion: string;
  /** EXPERIMENTAL_MAPPING for mapping-0 (SPEC §7.5: marked EXPERIMENTAL in the UI too). */
  warnings: QualityWarning[];
}

/** Six raw measures, all measurable, → canonical seed. A null is never mapped (R13): the caller returns INSUFFICIENT_DATA. */
export function seedFromRaw(raw: readonly (number | null)[], table: MappingTable = MAPPING_0): MappedSeed {
  if (raw.length !== 6) throw new CalibrationError('MISSING_MEASURE', `six raw measures required, got ${raw.length}`);
  const points: number[] = [];
  DESCRIPTOR_KEYS.forEach((key, i) => {
    const x = raw[i];
    if (x === null || x === undefined) throw new CalibrationError('MISSING_MEASURE', `${key} is not measurable`);
    points.push(mapToPoint(table.parameters[key], x));
  });
  const [a, b, c, d, e, f] = points.map(toSeedUnits) as [number, number, number, number, number, number];
  const [pa, pb, pc, pd, pe, pf] = points as [number, number, number, number, number, number];
  return {
    seed: [a, b, c, d, e, f],
    points: [pa, pb, pc, pd, pe, pf],
    mappingVersion: table.mappingVersion,
    warnings: table.experimental ? ['EXPERIMENTAL_MAPPING'] : [],
  };
}
