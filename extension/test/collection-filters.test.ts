import { describe, expect, it } from 'vitest';
import {
  VAULT_SCHEMA_VERSION,
  type CrystalRecordV1,
  type CrystalSeed,
} from '@voicecrystal/contracts';
import { PRISM_NAMES } from '@voicecrystal/crystal-core';
import {
  INITIAL_COLLECTION_FILTERS,
  classifyColorBucket,
  classifyRecordHabit,
  filterCrystalRecords,
  prismFormFromHabitName,
} from '../src/collection/filters.ts';
import { strings } from '../src/ui/strings.it.ts';

function sampleRecord(
  id: string,
  specimenNumber: number,
  seed: CrystalSeed,
  overrides: Partial<CrystalRecordV1> = {},
): CrystalRecordV1 {
  return {
    id,
    specimenNumber,
    schemaVersion: VAULT_SCHEMA_VERSION,
    createdAt: '2026-11-15T10:00:00.000Z',
    title: '',
    speakerLabel: null,
    source: { kind: 'mic' },
    seed,
    confidence: [1, 1, 1, 1, 1, 1],
    rawMeasures: [7.2, 2.5, 14, 0.12, 10.1, 4],
    extractorVersion: 'extractor-0-experimental',
    mappingVersion: 'mapping-0-experimental',
    geometryVersion: 'habit-1',
    comparatorVersion: 'comparator-0-experimental',
    captureExitReason: 'CONVERGED',
    quality: {
      accepted: true,
      validSpeechMs: 12000,
      pitchUsableFrames: 400,
      vadSpeechFrames: 500,
      droppedFrames: 0,
      clippedFraction: 0,
      confidence: [1, 1, 1, 1, 1, 1],
      missingFeatureKeys: [],
      warnings: ['EXPERIMENTAL_MAPPING'],
    },
    geometryHash: 'a'.repeat(64),
    tags: [],
    ...overrides,
  };
}

describe('Collection color & habit classification', () => {
  it('maps p5_brightness seed units to the four color bands', () => {
    expect(classifyColorBucket(0)).toBe('ruby');
    expect(classifyColorBucket(2499)).toBe('ruby');
    expect(classifyColorBucket(2500)).toBe('amber');
    expect(classifyColorBucket(4999)).toBe('amber');
    expect(classifyColorBucket(5000)).toBe('cyan');
    expect(classifyColorBucket(7499)).toBe('cyan');
    expect(classifyColorBucket(7500)).toBe('sapphire');
    expect(classifyColorBucket(10000)).toBe('sapphire');
  });

  it('extracts prism form from all five Italian habit names (longest prefix first)', () => {
    expect(prismFormFromHabitName(`${PRISM_NAMES.trigonal} con pinacoide`)).toBe('trigonal');
    expect(prismFormFromHabitName(`${PRISM_NAMES.bevelledTrigonal} con romboedro`)).toBe('bevelledTrigonal');
    expect(prismFormFromHabitName(`${PRISM_NAMES.hexagonal} con romboedro`)).toBe('hexagonal');
    expect(prismFormFromHabitName(`${PRISM_NAMES.bevelledHexagonal} con pinacoide`)).toBe('bevelledHexagonal');
    expect(prismFormFromHabitName(`${PRISM_NAMES.doubleHexagonal} con bipiramide esagonale`)).toBe('doubleHexagonal');
  });

  it('classifies real CrystalRecordV1 instances across prism habits', () => {
    const trig = sampleRecord('id-1', 1, [0, 0, 5000, 1000, 1000, 3000]);
    const bevelTrig = sampleRecord('id-2', 2, [2000, 5000, 5000, 1000, 3500, 3000]);
    const hex = sampleRecord('id-3', 3, [4500, 5000, 5000, 1000, 6000, 3000]);
    const doubleHex = sampleRecord('id-4', 4, [9500, 9000, 5000, 1000, 9000, 3000]);

    expect(classifyRecordHabit(trig).prismForm).toBe('trigonal');
    expect(classifyRecordHabit(bevelTrig).prismForm).toBe('bevelledTrigonal');
    expect(classifyRecordHabit(hex).prismForm).toBe('hexagonal');
    expect(classifyRecordHabit(doubleHex).prismForm).toBe('doubleHexagonal');
  });
});

describe('filterCrystalRecords', () => {
  const recA = sampleRecord('uuid-1', 1, [0, 2000, 5000, 1000, 1000, 3000], {
    source: { kind: 'mic' },
    createdAt: '2026-11-10T10:00:00.000Z',
  });
  const recB = sampleRecord('uuid-2', 2, [4500, 5000, 5000, 1000, 6000, 3000], {
    source: {
      kind: 'file',
      fileName: 'sample.wav',
      durationSeconds: 30,
      offsetStartSeconds: 0,
      offsetEndSeconds: 20,
    },
    createdAt: '2026-11-12T10:00:00.000Z',
  });
  const recC = sampleRecord('uuid-3', 3, [9500, 9000, 5000, 1000, 9000, 3000], {
    source: { kind: 'tab' },
    createdAt: '2026-11-15T10:00:00.000Z',
  });
  const all = [recA, recB, recC];

  it('returns all records for INITIAL_COLLECTION_FILTERS', () => {
    expect(filterCrystalRecords(all, INITIAL_COLLECTION_FILTERS)).toEqual(all);
  });

  it('filters by habit, color, source, and inclusive UTC date bounds', () => {
    expect(filterCrystalRecords(all, { ...INITIAL_COLLECTION_FILTERS, habit: 'hexagonal' })).toEqual([recB]);
    expect(filterCrystalRecords(all, { ...INITIAL_COLLECTION_FILTERS, color: 'ruby' })).toEqual([recA]);
    expect(filterCrystalRecords(all, { ...INITIAL_COLLECTION_FILTERS, color: 'sapphire' })).toEqual([recC]);
    expect(filterCrystalRecords(all, { ...INITIAL_COLLECTION_FILTERS, source: 'tab' })).toEqual([recC]);
    expect(filterCrystalRecords(all, { ...INITIAL_COLLECTION_FILTERS, source: 'file' })).toEqual([recB]);
    expect(
      filterCrystalRecords(all, { ...INITIAL_COLLECTION_FILTERS, dateFrom: '2026-11-11', dateTo: '2026-11-14' }),
    ).toEqual([recB]);
    expect(
      filterCrystalRecords(all, {
        habit: 'doubleHexagonal',
        color: 'sapphire',
        source: 'tab',
        dateFrom: '2026-11-15',
        dateTo: '2026-11-15',
      }),
    ).toEqual([recC]);
  });
});

describe('G0-DOC-02 and R3 terminology guard', () => {
  it('uses "Affinità acustica / geometrica" and avoids positive biometric/identity claims', () => {
    expect(strings.comparison.sectionTitle).toBe('Affinità acustica / geometrica');
    expect(strings.comparison.nonBiometricNotice).toContain('non verifica né identifica una persona');
    expect(strings.comparison.nonBiometricNotice).toContain('stesso parlante');

    const positiveCopy = [
      strings.comparison.sectionTitle,
      strings.comparison.primaryPercentile(50),
      strings.comparison.experimentalBadge,
      strings.comparison.platterTitle,
      strings.comparison.platterSubtitle,
      strings.comparison.contributionsTitle,
      strings.collection.title,
      strings.collection.chooseComparison,
    ]
      .join(' ')
      .toLowerCase();

    for (const forbidden of [
      'stessa persona',
      'riconoscimento',
      'identificazione biometrica',
      'probabilità che sia',
      'verifica vocale',
    ]) {
      expect(positiveCopy).not.toContain(forbidden);
    }
  });
});
