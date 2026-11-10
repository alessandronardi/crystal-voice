// Orthographic projections of the plate presets, with exact rational
// directions: only + - * / and Math.sqrt (correctly rounded per IEEE 754), so
// the SVG is identical in every engine (ADR-0010, ADR-0013). No trigonometry.

import type { PlatePreset } from '@voicecrystal/contracts';

export type Vec3 = readonly [number, number, number];

/** Orthonormal view basis: screen right, screen up, and the direction toward the viewer. */
export interface Projection {
  right: Vec3;
  up: Vec3;
  toward: Vec3;
}

// Clinographic (atlas) view: rotate the crystal about z by phi, tan phi = 1/3,
// then tilt it toward the viewer by delta, tan delta = 1/6, so the top is seen.
const R10 = Math.sqrt(10); // Math.sqrt: correctly rounded (IEEE 754)
const R37 = Math.sqrt(37);
const C_PHI = 3 / R10;
const S_PHI = 1 / R10;
const C_DELTA = 6 / R37;
const S_DELTA = 1 / R37;

export const PROJECTIONS: Readonly<Record<PlatePreset, Projection>> = Object.freeze({
  clinographic: {
    right: [C_PHI, -S_PHI, 0],
    up: [S_DELTA * S_PHI, S_DELTA * C_PHI, C_DELTA],
    toward: [-C_DELTA * S_PHI, -C_DELTA * C_PHI, S_DELTA],
  },
  front: { right: [1, 0, 0], up: [0, 0, 1], toward: [0, -1, 0] },
  top: { right: [1, 0, 0], up: [0, 1, 0], toward: [0, 0, 1] },
});

/**
 * Pixels per length unit on a 512 px plate [H]: fixed for every crystal, so
 * sizes compare across plates. Chosen from an empirical maximum, not a proof:
 * the largest projected half-extent of the habit-1 primary over 40,512 seeds
 * (`pnpm bench:plate-scale`, also in CI) fits with a 5% margin in every
 * preset (docs/BENCHMARK_PROTOCOL.md §7).
 */
export const PLATE_SCALE_512 = 92;

export function plateScale(sizePx: number): number {
  return (PLATE_SCALE_512 * sizePx) / 512;
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
