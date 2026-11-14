// I-13b: the live legend, the veiled traits and the warnings of the label (SPEC §13, ADR-0028, ADR-0014).
import { DESCRIPTOR_KEYS, GEOMETRY_VERSIONS, type CrystalGeometry, type CrystalSeed, type SeedConfidence } from '@voicecrystal/contracts';
import { generateCrystalGeometry } from '@voicecrystal/crystal-core';
import { veilIsVisible } from '@voicecrystal/renderer-three';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatMeasure, labelWarnings, legendRows, percentileOf, veiledLines } from '../src/sidepanel/legend.ts';

const FULL: SeedConfidence = [1, 1, 1, 1, 1, 1];
const geometry = (seed: CrystalSeed, confidence: SeedConfidence = FULL): CrystalGeometry => generateCrystalGeometry(seed, confidence, GEOMETRY_VERSIONS[0]);
const SEED: CrystalSeed = [5000, 5000, 5000, 5000, 5000, 5000];
// log2(182 Hz) ≈ 7.5078; 3.4 st; 12.1 dB; 0.21; log2(1450 Hz) ≈ 10.5018; 4.1 onset/s
const RAW = [Math.log2(182), 3.4, 12.1, 0.21, Math.log2(1450), 4.1] as const;

const seedArb = fc.tuple(...DESCRIPTOR_KEYS.map(() => fc.integer({ min: 0, max: 10000 }))) as unknown as fc.Arbitrary<CrystalSeed>;
const confArb = fc.tuple(...DESCRIPTOR_KEYS.map(() => fc.constantFrom(0.2, 1))) as unknown as fc.Arbitrary<SeedConfidence>;

describe('legend measures', () => {
  it('formats each raw measure with its SPEC §7.4 unit', () => {
    expect(formatMeasure('p1_pitch', RAW[0])).toBe('182 Hz');
    expect(formatMeasure('p2_intonation', RAW[1])).toBe('3,4 semitoni');
    expect(formatMeasure('p3_dynamics', RAW[2])).toBe('12,1 dB');
    expect(formatMeasure('p4_roughness', RAW[3])).toBe('0,21 aperiodicità');
    expect(formatMeasure('p5_brightness', RAW[4])).toBe('1450 Hz'); // it-IT groups from five digits (CLDR minimumGroupingDigits 2)
    expect(formatMeasure('p6_rhythm', RAW[5])).toBe('4,1 onset/s');
  });

  it('a missing measure stays «non misurabile», never 0 (R13)', () => {
    for (const k of DESCRIPTOR_KEYS) expect(formatMeasure(k, null)).toBe('non misurabile');
    const rows = legendRows(SEED, null, geometry(SEED));
    expect(rows.every((r) => r.measure === 'non misurabile')).toBe(true);
  });

  it('percentile is the seed value / 100, rounded half to even', () => {
    expect(percentileOf(6800)).toBe(68);
    expect(percentileOf(6849)).toBe(68);
    expect(percentileOf(6851)).toBe(69);
    expect(percentileOf(6850)).toBe(68);
    expect(percentileOf(6950)).toBe(70);
    expect(percentileOf(0)).toBe(0);
    expect(percentileOf(10000)).toBe(100);
  });
});

describe('legend rows (property over seeds and veils)', () => {
  it('six rows in descriptor order; veiled as the geometry; highlight only for an element that exists', () => {
    fc.assert(
      fc.property(seedArb, confArb, (seed, conf) => {
        const g = geometry(seed, conf);
        const rows = legendRows(seed, RAW, g);
        expect(rows.map((r) => r.key)).toEqual(DESCRIPTOR_KEYS);
        for (const row of rows) {
          expect(row.veiled).toBe(g.appearance.veiledTraits.includes(row.key));
          const visible = veilIsVisible(row.key, g);
          expect(row.nothing === null).toBe(visible);
          if (!visible) expect(row.highlight).toBeNull();
          if (row.key === 'p5_brightness' || row.key === 'p6_rhythm') expect(row.highlight).toBeNull();
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('label lines', () => {
  it('a veiled trait with nothing to veil is said by the label alone', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const g = geometry(seed, [0.2, 0.2, 0.2, 0.2, 0.2, 0.2]);
        const lines = veiledLines(g);
        expect(lines).toHaveLength(g.appearance.veiledTraits.length);
        if (g.inclusions.length === 0) expect(lines).toContain('Ruvidità: incerta (nessuna inclusione da mostrare)');
        else expect(lines).toContain('Ruvidità: confidenza bassa: reso smerigliato');
      }),
      { numRuns: 100 },
    );
  });

  it('no veiled trait, no line', () => {
    expect(veiledLines(geometry(SEED))).toEqual([]);
  });

  it('shows the quality warnings of review M-4, not the experimental mapping', () => {
    expect(labelWarnings(['EXPERIMENTAL_MAPPING', 'LOW_CONFIDENCE_PARAMETER'])).toEqual([]);
    expect(labelWarnings(['PHASE_CANCELLATION', 'MULTI_SPEAKER_SUSPECTED', 'CLIPPING', 'PLAYER_MUTED'])).toEqual([
      'forse più di una voce',
      'audio saturato',
      'player muto',
      'canali in controfase: usato un solo canale',
    ]);
  });
});
