// The live legend and the label lines of I-13b (SPEC §13, ADR-0028, ADR-0014).
// Pure: no DOM, tested in Node. The panel draws the rows it returns.
//
// One row per descriptor: the crystal trait, the raw measure with its unit,
// the percentile of the experimental mapping (the seed value / 100: mapping-0
// is a quantile map), «confidenza bassa» when veiled, and what the crystal
// cannot show (veilIsVisible false: the rendering never invents an element).
import { DESCRIPTOR_KEYS, type CrystalGeometry, type CrystalSeed, type DescriptorKey, type QualityWarning, type RawMeasureTuple } from '@voicecrystal/contracts';
import { highlightTargetOf, veilIsVisible, type HighlightTarget } from '@voicecrystal/renderer-three';
import { strings } from '../ui/strings.it.ts';

const t = strings.shell.legend;
const r = strings.shell.revealed;

export interface LegendRow {
  key: DescriptorKey;
  trait: string;
  descriptor: string;
  /** Raw measure with its unit, or «non misurabile». */
  measure: string;
  percentile: string;
  veiled: boolean;
  /** Why the crystal shows nothing for this row; null when it can. */
  nothing: string | null;
  /** What selecting the row lights up on the showcase: nothing for traits of the whole body (ADR-0028 point 4). */
  highlight: HighlightTarget | null;
}

const nf = (digits: number): Intl.NumberFormat => new Intl.NumberFormat('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const NF0 = nf(0);
const NF1 = nf(1);
const NF2 = nf(2);

/** SPEC §7.4 units: p1 and p5 are log2 of a frequency, shown in Hz. */
export function formatMeasure(key: DescriptorKey, raw: number | null): string {
  if (raw === null || !Number.isFinite(raw)) return t.unmeasurable;
  switch (key) {
    case 'p1_pitch':
    case 'p5_brightness':
      return `${NF0.format(2 ** raw)} ${t.units.hz}`;
    case 'p2_intonation':
      return `${NF1.format(raw)} ${t.units.semitones}`;
    case 'p3_dynamics':
      return `${NF1.format(raw)} ${t.units.db}`;
    case 'p4_roughness':
      return `${NF2.format(raw)} ${t.units.aperiodicity}`;
    case 'p6_rhythm':
      return `${NF1.format(raw)} ${t.units.onsets}`;
  }
}

/** mapping-0 maps by quantiles: seed value 0…10000 → percentile 0…100, rounded half to even. */
export function percentileOf(value: number): number {
  const x = value / 100;
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

function nothingFor(key: DescriptorKey, geometry: CrystalGeometry): string | null {
  if (veilIsVisible(key, geometry)) return null;
  switch (key) {
    case 'p3_dynamics':
    case 'p4_roughness':
    case 'p6_rhythm':
      return t.nothing[key];
    case 'p1_pitch':
    case 'p2_intonation':
    case 'p5_brightness':
      return null; // always visible (look.ts)
  }
}

export function legendRows(seed: CrystalSeed, raw: RawMeasureTuple | null, geometry: CrystalGeometry): LegendRow[] {
  const veiled = new Set(geometry.appearance.veiledTraits);
  return DESCRIPTOR_KEYS.map((key, i) => {
    const value = seed[i];
    if (value === undefined) throw new RangeError('a seed has six values'); // a CrystalSeed tuple: never reached
    const nothing = nothingFor(key, geometry);
    const tgt = highlightTargetOf(key);
    return {
      key,
      trait: t.traits[key],
      descriptor: strings.analysis.descriptors[key],
      measure: formatMeasure(key, raw?.[i] ?? null),
      percentile: t.percentile(NF0.format(percentileOf(value))),
      veiled: veiled.has(key),
      nothing,
      highlight: nothing === null ? tgt : null,
    };
  });
}

/**
 * «Tratti velati» on the label: each veiled trait, and when the crystal has no
 * element to veil, the label alone says so (BACKLOG I-13 DoD), for example
 * «Ruvidità: incerta (nessuna inclusione da mostrare)».
 */
export function veiledLines(geometry: CrystalGeometry): string[] {
  return DESCRIPTOR_KEYS.filter((k) => geometry.appearance.veiledTraits.includes(k)).map((k) => {
    const nothing = nothingFor(k, geometry);
    return `${strings.analysis.descriptors[k]}: ${nothing === null ? r.veiledShown : r.veiledNothing(nothing)}`;
  });
}

/**
 * Quality warnings worth a line on the label (review M-4 of I-13a). Not shown
 * there: the experimental mapping (the label says it already) and low
 * confidence (the veiled traits line says which).
 */
export const LABEL_WARNINGS: readonly QualityWarning[] = ['MULTI_SPEAKER_SUSPECTED', 'MIXED_AUDIO_UNCERTAIN', 'CLIPPING', 'LOW_LEVEL', 'PLAYER_MUTED', 'PHASE_CANCELLATION'];

export function labelWarnings(warnings: readonly QualityWarning[]): string[] {
  return LABEL_WARNINGS.filter((w) => warnings.includes(w)).map((w) => strings.analysis.warningNames[w]);
}
