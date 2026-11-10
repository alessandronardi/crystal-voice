// Appearance (SPEC §10): outside the geometric hash, so ordinary floating
// point is fine here. p5 → OKLCH colour along a monotone path ruby → amber →
// cyan → sapphire; p6 → number of growth-zoning bands; low confidence → veiled.

import { DESCRIPTOR_KEYS, type CrystalAppearance, type CrystalSeed, type DescriptorKey, type SeedConfidence } from '@voicecrystal/contracts';

/** Confidence below this veils the trait (ADR-0014). [H] */
export const VEIL_BELOW = 0.5;

/** [lightness, chroma, hue°] anchors at t5 = 0, 1/3, 2/3, 1. [H] (G2) */
const PATH: readonly (readonly [number, number, number])[] = [
  [0.55, 0.18, 15], // ruby
  [0.76, 0.15, 70], // amber
  [0.8, 0.11, 200], // cyan
  [0.52, 0.16, 265], // sapphire
];

/** Rounds to 4 decimals so the appearance serializes identically everywhere. */
const r4 = (v: number): number => Math.round(v * 10000) / 10000;

export function colorFromBrightness(t5: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t5)) * (PATH.length - 1);
  const i = Math.min(PATH.length - 2, Math.floor(x));
  const f = x - i;
  const a = PATH[i] ?? PATH[0] ?? [0, 0, 0];
  const b = PATH[i + 1] ?? a;
  return [r4(a[0] + (b[0] - a[0]) * f), r4(a[1] + (b[1] - a[1]) * f), r4(a[2] + (b[2] - a[2]) * f)];
}

/** 1..8 bands from p6. [H] (G2) */
export const zoningBandsFromRhythm = (t6: number): number => 1 + Math.round(Math.min(1, Math.max(0, t6)) * 7);

export function buildAppearance(seed: CrystalSeed, confidence: SeedConfidence): CrystalAppearance {
  const veiledTraits: DescriptorKey[] = [];
  DESCRIPTOR_KEYS.forEach((key, i) => {
    if ((confidence[i] ?? 0) < VEIL_BELOW) veiledTraits.push(key);
  });
  return {
    colorOklch: colorFromBrightness(seed[4] / 10000),
    zoningBands: zoningBandsFromRhythm(seed[5] / 10000),
    veiledTraits,
  };
}
