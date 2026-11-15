// Pure Collection filtering and trait classification helpers (SPEC §12, I-15).
// No DOM, chrome.*, Three.js, or IndexedDB dependencies; unit-tested in Node.

import type { CrystalRecordV1, SeedUnits, VaultSource } from '@voicecrystal/contracts';
import { PRISM_NAMES, generateCrystalGeometry } from '@voicecrystal/crystal-core';

export type PrismFormFilter = 'trigonal' | 'bevelledTrigonal' | 'hexagonal' | 'bevelledHexagonal' | 'doubleHexagonal';
export type HabitFilter = 'all' | PrismFormFilter;
export type ColorBucket = 'ruby' | 'amber' | 'cyan' | 'sapphire';
export type ColorFilter = 'all' | ColorBucket;
export type SourceFilter = 'all' | VaultSource['kind'];

export interface CollectionFilterState {
  readonly habit: HabitFilter;
  readonly color: ColorFilter;
  readonly source: SourceFilter;
  /** Inclusive ISO date lower bound ('YYYY-MM-DD') or empty string for none. */
  readonly dateFrom: string;
  /** Inclusive ISO date upper bound ('YYYY-MM-DD') or empty string for none. */
  readonly dateTo: string;
}

export const INITIAL_COLLECTION_FILTERS: CollectionFilterState = {
  habit: 'all',
  color: 'all',
  source: 'all',
  dateFrom: '',
  dateTo: '',
};

/**
 * Classifies `p5_brightness` seed units (0..10000) into the 4 colour bands of
 * SPEC §10 (`appearance.ts`: ruby -> amber -> cyan -> sapphire).
 */
export function classifyColorBucket(brightnessUnits: SeedUnits): ColorBucket {
  if (brightnessUnits < 2500) return 'ruby';
  if (brightnessUnits < 5000) return 'amber';
  if (brightnessUnits < 7500) return 'cyan';
  return 'sapphire';
}

/** Extracts prism form from canonical Italian habit names (longest prefix first). */
export function prismFormFromHabitName(name: string): PrismFormFilter {
  if (name.startsWith(PRISM_NAMES.doubleHexagonal)) return 'doubleHexagonal';
  if (name.startsWith(PRISM_NAMES.bevelledHexagonal)) return 'bevelledHexagonal';
  if (name.startsWith(PRISM_NAMES.hexagonal)) return 'hexagonal';
  if (name.startsWith(PRISM_NAMES.bevelledTrigonal)) return 'bevelledTrigonal';
  if (name.startsWith(PRISM_NAMES.trigonal)) return 'trigonal';
  // Fallback for unknown future geometryVersion names: infer from pitch threshold.
  return 'hexagonal';
}

/**
 * Computes canonical habit name and prism filter bucket for a saved record.
 * Falls back safely if `geometryVersion` is unfamiliar so Collection never crashes.
 */
export function classifyRecordHabit(record: Pick<CrystalRecordV1, 'seed' | 'confidence' | 'geometryVersion'>): {
  readonly habitName: string;
  readonly prismForm: PrismFormFilter;
} {
  try {
    const g = generateCrystalGeometry(record.seed, record.confidence, record.geometryVersion);
    return {
      habitName: g.habitName,
      prismForm: prismFormFromHabitName(g.habitName),
    };
  } catch {
    const p1 = record.seed[0] / 10000;
    const prismForm: PrismFormFilter =
      p1 <= 0
        ? 'trigonal'
        : p1 < 0.4
          ? 'bevelledTrigonal'
          : p1 <= 0.5
            ? 'hexagonal'
            : p1 < 0.809
              ? 'bevelledHexagonal'
              : 'doubleHexagonal';
    return { habitName: PRISM_NAMES[prismForm], prismForm };
  }
}

export function filterCrystalRecords(
  records: readonly CrystalRecordV1[],
  filters: CollectionFilterState,
  habitLookup?: ReadonlyMap<string, PrismFormFilter>,
): CrystalRecordV1[] {
  return records.filter((record) => {
    if (filters.source !== 'all' && record.source.kind !== filters.source) {
      return false;
    }
    if (filters.color !== 'all' && classifyColorBucket(record.seed[4]) !== filters.color) {
      return false;
    }
    if (filters.habit !== 'all') {
      const form = habitLookup?.get(record.id) ?? classifyRecordHabit(record).prismForm;
      if (form !== filters.habit) return false;
    }
    const day = record.createdAt.slice(0, 10);
    if (filters.dateFrom !== '' && day < filters.dateFrom) {
      return false;
    }
    if (filters.dateTo !== '' && day > filters.dateTo) {
      return false;
    }
    return true;
  });
}
