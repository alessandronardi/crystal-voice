// OKLCH → linear sRGB (Björn Ottosson, "A perceptual color space for image
// processing", 2020). Pure. Out-of-gamut colours keep lightness and hue and
// lose chroma until they fit, so the hue path of p5 stays monotone.

export type Rgb = readonly [number, number, number];

const DEG = Math.PI / 180;

/** OKLab → linear sRGB, no clamping. */
export function oklabToLinearSrgb(l: number, a: number, b: number): Rgb {
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ * l_ * l_;
  const M = m_ * m_ * m_;
  const S = s_ * s_ * s_;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

const inGamut = (c: Rgb, eps = 1e-6): boolean => c.every((v) => v >= -eps && v <= 1 + eps);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** OKLCH (L 0..1, C ≥ 0, h in degrees) → linear sRGB in [0, 1]³, chroma reduced into gamut. */
export function oklchToLinearSrgb(l: number, c: number, hDeg: number, chromaFactor = 1): Rgb {
  const L = clamp01(l);
  const h = hDeg * DEG;
  const at = (chroma: number): Rgb => oklabToLinearSrgb(L, chroma * Math.cos(h), chroma * Math.sin(h));
  let chroma = Math.max(0, c * chromaFactor);
  let rgb = at(chroma);
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = chroma;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(at(mid))) lo = mid;
      else hi = mid;
    }
    chroma = lo;
    rgb = at(chroma);
  }
  return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])];
}

/** Linear interpolation between two linear-sRGB colours. */
export const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
