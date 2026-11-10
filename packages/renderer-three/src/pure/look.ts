// Showcase look (ADR-0012) and veiled traits (ADR-0014, SPEC §10 D3). Pure.
//
// One rule across traits: a veiled trait looks frosted or faded, never
// removed. The renderer can only attenuate an element that exists: with no
// secondary crystal (p3), no inclusion (p4) or a single zoning band (p6) there
// is nothing to veil, and the label alone states it (SPEC §10 D3, I-13).
// `veilIsVisible` says which case applies. Whether the effect is recognizable
// is a human judgement (G2, MANUAL_CHECKLIST M19). Every constant here is [H].

import { assertNever, type CrystalAppearance, type CrystalGeometry, type DescriptorKey } from '@voicecrystal/contracts';
import { mixRgb, oklchToLinearSrgb, type Rgb } from './color.ts';
import type { FaceClass } from './mesh-arrays.ts';

export type RenderProfile = 'vetrina' | 'economy';

export interface Veil {
  /** p1: prism faces frosted. */
  prismFrosted: boolean;
  /** p2: termination and pinacoid faces frosted. */
  terminationFrosted: boolean;
  /** p3: secondary crystals frosted and fainter. */
  secondaryFrosted: boolean;
  /** p4: needles and phantoms blurred (wider, low contrast). */
  inclusionsBlurred: boolean;
  /** p5: colour desaturated. */
  colorDesaturated: boolean;
  /** p6: zoning bands at low contrast. */
  bandsLowContrast: boolean;
}

export function veilFromTraits(traits: readonly DescriptorKey[]): Veil {
  const veil: Veil = {
    prismFrosted: false,
    terminationFrosted: false,
    secondaryFrosted: false,
    inclusionsBlurred: false,
    colorDesaturated: false,
    bandsLowContrast: false,
  };
  for (const trait of traits) {
    switch (trait) {
      case 'p1_pitch':
        veil.prismFrosted = true;
        break;
      case 'p2_intonation':
        veil.terminationFrosted = true;
        break;
      case 'p3_dynamics':
        veil.secondaryFrosted = true;
        break;
      case 'p4_roughness':
        veil.inclusionsBlurred = true;
        break;
      case 'p5_brightness':
        veil.colorDesaturated = true;
        break;
      case 'p6_rhythm':
        veil.bandsLowContrast = true;
        break;
      default:
        assertNever(trait);
    }
  }
  return veil;
}

/** [H] Surface roughness: polished vs frosted (frosting also blurs what is seen through the face). */
export const ROUGHNESS_POLISHED = 0.04;
export const ROUGHNESS_FROSTED = 0.32;
/** [H] Chroma kept when p5 is veiled. */
export const VEILED_CHROMA_FACTOR = 0.1;
/** [H] Contrast of the zoning bands (0 = invisible, 1 = full). */
export const BAND_CONTRAST = 0.12;
export const BAND_CONTRAST_VEILED = 0.035;
/** [H] Needles: radius factor and how far their colour moves toward the body colour. */
export const NEEDLE_RADIUS_FACTOR_VEILED = 2.5;
export const INCLUSION_FADE = 0.15;
export const INCLUSION_FADE_VEILED = 0.75;
/** [H] Secondary crystals when p3 is veiled: opacity in economy, extra frosting in vetrina. */
export const SECONDARY_VEILED_OPACITY = 0.45;
export const SECONDARY_VEILED_TRANSMISSION = 0.55;

/** Colours used by the scene, all linear sRGB. */
export interface Palette {
  body: Rgb;
  /** Light inclusion colour (rutile-like), already faded toward the body colour. */
  inclusion: Rgb;
  /** Phantom outline colour. */
  phantom: Rgb;
}

const INCLUSION_BASE: Rgb = [0.85, 0.78, 0.6];
const PHANTOM_BASE: Rgb = [0.92, 0.92, 0.95];

export function paletteFor(appearance: CrystalAppearance, veil: Veil): Palette {
  const [l, c, h] = appearance.colorOklch;
  const body = oklchToLinearSrgb(l, c, h, veil.colorDesaturated ? VEILED_CHROMA_FACTOR : 1);
  const fade = veil.inclusionsBlurred ? INCLUSION_FADE_VEILED : INCLUSION_FADE;
  return { body, inclusion: mixRgb(INCLUSION_BASE, body, fade), phantom: mixRgb(PHANTOM_BASE, body, fade) };
}

export const roughnessFor = (faceClass: FaceClass, secondary: boolean, veil: Veil): number => {
  if (secondary && veil.secondaryFrosted) return ROUGHNESS_FROSTED;
  const frosted = faceClass === 'prism' ? veil.prismFrosted : veil.terminationFrosted;
  return frosted ? ROUGHNESS_FROSTED : ROUGHNESS_POLISHED;
};

/**
 * Whether veiling `trait` can change the render of this geometry, i.e. the
 * element it attenuates exists. False means only the label signals it.
 */
export function veilIsVisible(trait: DescriptorKey, geometry: CrystalGeometry): boolean {
  switch (trait) {
    case 'p1_pitch':
    case 'p2_intonation':
    case 'p5_brightness':
      // The primary always has prism faces and terminations (at least the pinacoid); colour always shows.
      return true;
    case 'p3_dynamics':
      return geometry.bodies.some((b) => b.kind === 'secondary');
    case 'p4_roughness':
      return geometry.inclusions.length > 0;
    case 'p6_rhythm':
      return geometry.appearance.zoningBands > 1;
    default:
      return assertNever(trait);
  }
}

/**
 * 1-D zoning texture, RGBA8: `bands` alternating light/dark stripes along c.
 * Light stripes are 1, dark ones are 1 − contrast, so the texture only
 * modulates the body colour. Size is one texel per stripe (nearest filtering).
 */
export function zoningTexels(bands: number, veil: Veil): Uint8Array {
  const n = Math.max(1, Math.floor(bands)) * 2 - 1;
  const contrast = veil.bandsLowContrast ? BAND_CONTRAST_VEILED : BAND_CONTRAST;
  const dark = Math.round(255 * (1 - contrast));
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const v = i % 2 === 0 ? 255 : dark;
    out.set([v, v, v, 255], i * 4);
  }
  return out;
}

/** [H] Turntable: one revolution every 40 s (SPEC §10: slow). */
export const TURNTABLE_PERIOD_MS = 40_000;

export const turntableAngle = (elapsedMs: number): number =>
  ((elapsedMs % TURNTABLE_PERIOD_MS) / TURNTABLE_PERIOD_MS) * 2 * Math.PI;

/** [H] Physical material of the showcase. */
export const VETRINA_MATERIAL = Object.freeze({
  transmission: 0.92,
  ior: 1.57,
  dispersion: 0.25,
  /** Thickness and attenuation distance, as a fraction of the body's bounding radius. */
  thicknessFactor: 0.6,
  attenuationFactor: 3,
  specularIntensity: 1,
  envMapIntensity: 1,
});

/** [H] Economy: standard material, see-through by plain alpha. */
export const ECONOMY_OPACITY = 0.82;

/**
 * [H] Fixed framing radius in length units, so sizes stay comparable across
 * crystals (like PLATE_SCALE_512). Measured: largest vertex distance from the
 * origin over all bodies of 2000 random seeds = 2.9026 (test "framing",
 * fast-check seed 0x11e3); 3.1 leaves about 7% margin.
 */
export const FRAMING_RADIUS = 3.1;
