// Crystallographic plate contract (SPEC §10, ADR-0013; I-12). SPEC names
// `PlateView` in `renderPlateSvg(geometry, view)` without defining it; this is
// its definition. The same geometry and view give the same SVG byte for byte.

/** Fixed orthographic views of the primary body. */
export const PLATE_PRESETS = ['clinographic', 'front', 'top'] as const;
export type PlatePreset = (typeof PLATE_PRESETS)[number];

/**
 * Output format of the plate renderer; a new value whenever the SVG of a golden
 * seed changes, strings included. The byte-identity promise holds for the same
 * geometryVersion, PlateView and renderer version (ADR-0020).
 */
export const PLATE_RENDERER_VERSION = 'plate-1';

export const PLATE_SIZE_MIN = 64;
export const PLATE_SIZE_MAX = 4096;

export interface PlateView {
  /**
   * 'clinographic': the atlas view (default, for the label): rotation about
   * the c axis with tan = 1/3, then a tilt with tan = 1/6;
   * 'front': looking along +y, c axis up; 'top': looking down the c axis.
   */
  preset: PlatePreset;
  /** Square side in pixels, integer in [PLATE_SIZE_MIN, PLATE_SIZE_MAX]. The scale is fixed per pixel size, never fitted to the crystal. */
  sizePx: number;
}

export const DEFAULT_PLATE_VIEW: PlateView = Object.freeze({ preset: 'clinographic', sizePx: 512 });

export function isPlateView(value: unknown): value is PlateView {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { preset?: unknown; sizePx?: unknown };
  return (
    typeof v.preset === 'string' &&
    (PLATE_PRESETS as readonly string[]).includes(v.preset) &&
    typeof v.sizePx === 'number' &&
    Number.isInteger(v.sizePx) &&
    v.sizePx >= PLATE_SIZE_MIN &&
    v.sizePx <= PLATE_SIZE_MAX
  );
}
