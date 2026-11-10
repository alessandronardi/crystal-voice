// Continuous randomness (ADR-0018). The geometric parameters (p1..p4, seed
// units) live on a lattice of step NOISE_CELL. Each lattice node, per domain,
// seeds one xoshiro128** from SHA-256("<version>|<domain>|<i1>,<i2>,<i3>,<i4>")
// and draws `channels` values in [0, 1) in a fixed order (adding channels at
// the end does not change earlier ones). Between nodes, values are blended
// multilinearly with smoothstep weights 3t² − 2t³: only + − × ÷.

import { prngFor } from './prng.ts';

/** Lattice step in seed units (50 points). [H] (ADR-0018; 2000 failed the continuity test) */
export const NOISE_CELL = 5000;

export type NoiseDomain = 'secondary' | 'inclusions' | 'orientation';

const smooth = (t: number): number => t * t * (3 - 2 * t);

function nodeValues(version: string, domain: NoiseDomain, node: readonly number[], channels: number): Float64Array {
  const prng = prngFor(`${version}|${domain}|${node.join(',')}`);
  const out = new Float64Array(channels);
  for (let c = 0; c < channels; c++) out[c] = prng.next();
  return out;
}

/**
 * `channels` continuous values in [0, 1) at `params` (four integers in
 * [0, 10000]). Deterministic; Lipschitz in each parameter.
 */
export function continuousNoise(
  version: string,
  domain: NoiseDomain,
  params: readonly [number, number, number, number],
  channels: number,
): Float64Array {
  const base: number[] = [];
  const weights: number[] = [];
  for (const p of params) {
    const cell = Math.floor(p / NOISE_CELL);
    base.push(cell);
    weights.push(smooth((p - cell * NOISE_CELL) / NOISE_CELL));
  }
  const out = new Float64Array(channels);
  for (let corner = 0; corner < 16; corner++) {
    let w = 1;
    const node: number[] = [];
    for (let k = 0; k < 4; k++) {
      const bit = (corner >> k) & 1;
      const wk = weights[k] ?? 0;
      w *= bit === 1 ? wk : 1 - wk;
      node.push((base[k] ?? 0) + bit);
    }
    if (w === 0) continue;
    const values = nodeValues(version, domain, node, channels);
    for (let c = 0; c < channels; c++) out[c] = (out[c] ?? 0) + w * (values[c] ?? 0);
  }
  return out;
}
