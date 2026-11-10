// Inclusion transforms → column-major matrices for WebGL instancing. Pure.
//
// Contract (packages/contracts/src/geometry.ts): `transform` is a 4×4
// row-major affine matrix quantized at 2^-16. A needle is the unit cylinder of
// radius 1 along z with z ∈ [−½, ½]; a phantom is a copy of the primary body.

import { POSITION_UNITS_PER_LENGTH, type Inclusion } from '@voicecrystal/contracts';
import { RenderInputError } from './errors.ts';

/** Dequantized row-major 4×4. Throws on a wrong length or non-finite entry. */
export function dequantizeTransform(transform: readonly number[]): number[] {
  if (transform.length !== 16) throw new RenderInputError('MALFORMED_TRANSFORM', `transform has ${transform.length} entries, expected 16`);
  return transform.map((v, i) => {
    if (!Number.isFinite(v)) throw new RenderInputError('NON_FINITE', `transform entry ${i} is not finite`);
    return v / POSITION_UNITS_PER_LENGTH;
  });
}

/**
 * Column-major matrices (16 floats each) of the needles, in contract order.
 * `radiusFactor` widens the needles in their own x and y (veiled p4: blurred
 * needles) without changing length, axis or position.
 */
export function needleMatrices(inclusions: readonly Inclusion[], radiusFactor: number): Float32Array {
  const needles = inclusions.filter((i) => i.kind === 'needle');
  const out = new Float32Array(needles.length * 16);
  needles.forEach((needle, n) => {
    const m = dequantizeTransform(needle.transform);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const scale = row < 3 && col < 2 ? radiusFactor : 1;
        out[n * 16 + col * 4 + row] = (m[row * 4 + col] ?? 0) * scale;
      }
    }
  });
  return out;
}

/** Row-major matrices of the phantoms (copies of the primary). */
export function phantomMatrices(inclusions: readonly Inclusion[]): number[][] {
  return inclusions.filter((i) => i.kind === 'phantom').map((p) => dequantizeTransform(p.transform));
}
