// Acoustic/geometric affinity comparator (SPEC §11, ADR-0007, G0-DOC-02).
// Pure math: weighted Euclidean distance D in [0, 1], Euclidean Affinity(A, B),
// and nearness percentile 100 * (1 - G(D)). Never identifies speakers (R3).

import { roundHalfEven } from '@voicecrystal/calibration';
import {
  DESCRIPTOR_KEYS,
  SEED_UNITS_MAX,
  isCrystalSeed,
  type CrystalSeed,
  type DescriptorKey,
  type QualityWarning,
  type SeedUnits,
} from '@voicecrystal/contracts';
import { ComparatorError } from './errors.ts';
import {
  COMPARATOR_0,
  EQUAL_WEIGHTS,
  evaluateDistanceCdf,
  type ComparatorTable,
  type ComparatorWeights,
} from './table.ts';

/** Per-descriptor contribution to weighted Euclidean squared distance. */
export interface ParameterContribution {
  readonly parameter: DescriptorKey;
  readonly seedA: SeedUnits;
  readonly seedB: SeedUnits;
  /** Percentile point A_i / 100 in [0, 100]. */
  readonly percentileA: number;
  /** Percentile point B_i / 100 in [0, 100]. */
  readonly percentileB: number;
  /** Absolute difference |A_i - B_i| in percentile points [0, 100]. */
  readonly deltaPoints: number;
  /** Weight w_i in [0, 1]. */
  readonly weight: number;
  /** Weighted squared term c_i = w_i * ((seedA_i - seedB_i) / 10000)^2. */
  readonly weightedSquaredContribution: number;
}

export type SixContributions = readonly [
  ParameterContribution,
  ParameterContribution,
  ParameterContribution,
  ParameterContribution,
  ParameterContribution,
  ParameterContribution,
];

export interface SeedComparisonResult {
  readonly comparatorVersion: string;
  readonly experimental: boolean;
  /** Weighted Euclidean distance D(A, B) in [0, 1]. */
  readonly distance: number;
  /** Affinity(A, B) = 100 * clamp(1 - D(A, B), 0, 1) in [0, 100]. */
  readonly affinity: number;
  /** Empirical CDF G(D) in [0, 1]. */
  readonly cdfValue: number;
  /** Exact nearness 100 * (1 - G(D)) in [0, 100] before rounding. */
  readonly nearnessExact: number;
  /** Integer nearness percentile in [0, 100] via half-even rounding. */
  readonly nearnessPercentile: number;
  readonly contributions: SixContributions;
}

/** Structural specimen view accepted by `compareSpecimens` (`CrystalRecordV1` fits directly). */
export interface ComparableSpecimen {
  readonly seed: CrystalSeed;
  readonly extractorVersion: string;
  readonly mappingVersion: string;
  readonly geometryVersion: string;
  readonly source?: {
    readonly kind: 'tab' | 'mic' | 'file';
  };
  readonly quality?: {
    readonly warnings?: readonly QualityWarning[];
    readonly confidence?: readonly [number, number, number, number, number, number];
  };
}

export type ComparisonBlockReason =
  | 'INCOMPATIBLE_MAPPING_VERSION'
  | 'INCOMPATIBLE_EXTRACTOR_VERSION';

export type ComparisonContextWarning =
  | 'EXPERIMENTAL_COMPARATOR'
  | 'DIFFERENT_SOURCE_KIND'
  | 'LOW_CONFIDENCE_TRAITS'
  | 'QUALITY_WARNINGS_PRESENT'
  | 'DIFFERENT_GEOMETRY_VERSION';

export type SpecimenComparisonOutcome =
  | {
      readonly status: 'blocked';
      readonly reason: ComparisonBlockReason;
      readonly mappingVersionA: string;
      readonly mappingVersionB: string;
      readonly extractorVersionA: string;
      readonly extractorVersionB: string;
    }
  | ({
      readonly status: 'ok';
      readonly mappingVersion: string;
      readonly extractorVersion: string;
      readonly geometryVersionA: string;
      readonly geometryVersionB: string;
      readonly geometryVersionDiffers: boolean;
      readonly contextWarnings: readonly ComparisonContextWarning[];
    } & SeedComparisonResult);

function assertValidSeed(seed: CrystalSeed, label: string): void {
  if (!isCrystalSeed(seed)) {
    throw new ComparatorError('INVALID_SEED', `${label} must be 6 integers in [0, ${SEED_UNITS_MAX}]`);
  }
}

function assertValidWeights(weights: ComparatorWeights): number {
  let sum = 0;
  for (let i = 0; i < 6; i++) {
    const w = weights[i];
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) {
      throw new ComparatorError('INVALID_WEIGHTS', `weights[${i}] must be a non-negative finite number`);
    }
    sum += w;
  }
  if (Math.abs(sum - 1) > 1e-6) {
    throw new ComparatorError('INVALID_WEIGHTS', `weights must sum to 1, got ${String(sum)}`);
  }
  return sum;
}

/**
 * Computes the six weighted squared distance contributions between two canonical seeds:
 * `c_i = w_i * ((seedA_i - seedB_i) / 10000)^2`.
 */
export function computeParameterContributions(
  seedA: CrystalSeed,
  seedB: CrystalSeed,
  weights: ComparatorWeights = EQUAL_WEIGHTS,
): SixContributions {
  assertValidSeed(seedA, 'seedA');
  assertValidSeed(seedB, 'seedB');
  assertValidWeights(weights);

  const items: ParameterContribution[] = [];
  for (let i = 0; i < 6; i++) {
    const key = DESCRIPTOR_KEYS[i] as DescriptorKey;
    const a = seedA[i] as SeedUnits;
    const b = seedB[i] as SeedUnits;
    const w = weights[i] as number;
    const normalizedDiff = (a - b) / SEED_UNITS_MAX;
    items.push({
      parameter: key,
      seedA: a,
      seedB: b,
      percentileA: a / 100,
      percentileB: b / 100,
      deltaPoints: Math.abs(a - b) / 100,
      weight: w,
      weightedSquaredContribution: w * normalizedDiff * normalizedDiff,
    });
  }
  return items as unknown as SixContributions;
}

/** Weighted Euclidean distance D(A, B) in [0, 1] (SPEC §11). */
export function weightedEuclideanDistance(
  seedA: CrystalSeed,
  seedB: CrystalSeed,
  weights: ComparatorWeights = EQUAL_WEIGHTS,
): number {
  const contribs = computeParameterContributions(seedA, seedB, weights);
  let sumSq = 0;
  let weightSum = 0;
  for (const c of contribs) {
    sumSq += c.weightedSquaredContribution;
    weightSum += c.weight;
  }
  const normalized = weightSum > 0 ? sumSq / weightSum : 0;
  const d = Math.sqrt(normalized);
  return d < 0 ? 0 : d > 1 ? 1 : d;
}

/** Secondary metric Affinity(A, B) = 100 * clamp(1 - D(A, B), 0, 1) in [0, 100] (SPEC §11). */
export function euclideanAffinity(
  seedA: CrystalSeed,
  seedB: CrystalSeed,
  weights: ComparatorWeights = EQUAL_WEIGHTS,
): number {
  const d = weightedEuclideanDistance(seedA, seedB, weights);
  const raw = 100 * (1 - d);
  return raw < 0 ? 0 : raw > 100 ? 100 : raw;
}

/** Converts distance D in [0, 1] to exact nearness and rounded integer percentile (SPEC §11, ADR-0007). */
export function nearnessFromDistance(
  distance: number,
  table: ComparatorTable = COMPARATOR_0,
): { readonly cdfValue: number; readonly nearnessExact: number; readonly nearnessPercentile: number } {
  const cdfValue = evaluateDistanceCdf(distance, table);
  const nearnessExact = Math.min(100, Math.max(0, 100 * (1 - cdfValue)));
  const nearnessPercentile = Math.min(100, Math.max(0, roundHalfEven(nearnessExact)));
  return { cdfValue, nearnessExact, nearnessPercentile };
}

/** Full pure seed-to-seed comparison against `table` (defaults to `COMPARATOR_0`). */
export function compareSeeds(
  seedA: CrystalSeed,
  seedB: CrystalSeed,
  table: ComparatorTable = COMPARATOR_0,
): SeedComparisonResult {
  const contributions = computeParameterContributions(seedA, seedB, table.weights);
  let sumSq = 0;
  let weightSum = 0;
  for (const c of contributions) {
    sumSq += c.weightedSquaredContribution;
    weightSum += c.weight;
  }
  const distance = Math.min(1, Math.max(0, Math.sqrt(weightSum > 0 ? sumSq / weightSum : 0)));
  const affinity = Math.min(100, Math.max(0, 100 * (1 - distance)));
  const { cdfValue, nearnessExact, nearnessPercentile } = nearnessFromDistance(distance, table);

  return {
    comparatorVersion: table.comparatorVersion,
    experimental: table.experimental,
    distance,
    affinity,
    cdfValue,
    nearnessExact,
    nearnessPercentile,
    contributions,
  };
}

/**
 * Compares two specimens while enforcing SPEC §11 compatibility rules:
 * differing `mappingVersion` or `extractorVersion` blocks the comparison with
 * an explicit reason; differing `geometryVersion` does NOT block acoustic affinity.
 */
export function compareSpecimens(
  specimenA: ComparableSpecimen,
  specimenB: ComparableSpecimen,
  table: ComparatorTable = COMPARATOR_0,
): SpecimenComparisonOutcome {
  assertValidSeed(specimenA.seed, 'specimenA.seed');
  assertValidSeed(specimenB.seed, 'specimenB.seed');

  const mappingA = specimenA.mappingVersion;
  const mappingB = specimenB.mappingVersion;
  const extractorA = specimenA.extractorVersion;
  const extractorB = specimenB.extractorVersion;

  if (mappingA.length === 0 || mappingB.length === 0 || mappingA !== mappingB) {
    return {
      status: 'blocked',
      reason: 'INCOMPATIBLE_MAPPING_VERSION',
      mappingVersionA: mappingA,
      mappingVersionB: mappingB,
      extractorVersionA: extractorA,
      extractorVersionB: extractorB,
    };
  }

  if (extractorA.length === 0 || extractorB.length === 0 || extractorA !== extractorB) {
    return {
      status: 'blocked',
      reason: 'INCOMPATIBLE_EXTRACTOR_VERSION',
      mappingVersionA: mappingA,
      mappingVersionB: mappingB,
      extractorVersionA: extractorA,
      extractorVersionB: extractorB,
    };
  }

  const seedComparison = compareSeeds(specimenA.seed, specimenB.seed, table);
  const warnings: ComparisonContextWarning[] = [];

  if (table.experimental) {
    warnings.push('EXPERIMENTAL_COMPARATOR');
  }
  if (
    specimenA.source !== undefined &&
    specimenB.source !== undefined &&
    specimenA.source.kind !== specimenB.source.kind
  ) {
    warnings.push('DIFFERENT_SOURCE_KIND');
  }

  const hasLowConf = (spec: ComparableSpecimen): boolean => {
    const conf = spec.quality?.confidence;
    if (conf !== undefined && conf.some((v) => v < 0.5)) return true;
    return spec.quality?.warnings?.includes('LOW_CONFIDENCE_PARAMETER') ?? false;
  };
  if (hasLowConf(specimenA) || hasLowConf(specimenB)) {
    warnings.push('LOW_CONFIDENCE_TRAITS');
  }

  const hasNotableQualityWarning = (spec: ComparableSpecimen): boolean =>
    (spec.quality?.warnings ?? []).some(
      (w) => w !== 'EXPERIMENTAL_MAPPING' && w !== 'LOW_CONFIDENCE_PARAMETER',
    );
  if (hasNotableQualityWarning(specimenA) || hasNotableQualityWarning(specimenB)) {
    warnings.push('QUALITY_WARNINGS_PRESENT');
  }

  const geometryVersionDiffers = specimenA.geometryVersion !== specimenB.geometryVersion;
  if (geometryVersionDiffers) {
    warnings.push('DIFFERENT_GEOMETRY_VERSION');
  }

  return {
    status: 'ok',
    mappingVersion: mappingA,
    extractorVersion: extractorA,
    geometryVersionA: specimenA.geometryVersion,
    geometryVersionB: specimenB.geometryVersion,
    geometryVersionDiffers,
    contextWarnings: warnings,
    ...seedComparison,
  };
}
