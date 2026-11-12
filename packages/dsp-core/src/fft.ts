// Iterative radix-2 FFT of a real frame, magnitude spectrum only (SPEC §7.3).
// Twiddles and bit reversal are tabulated once per size; Math.sin/cos are used
// only to build the tables (VC-24: values may differ by 1–2 ULP across JS
// engines; measured Node vs panel in I-06b).

import { DspInputError } from './errors.ts';

export interface RealFft {
  readonly size: number;
  /** |X_k| for k = 0 … size/2 of `input` zero-padded to `size`. `out` must have size/2 + 1 slots. */
  magnitudes(input: ArrayLike<number>, out: Float64Array): void;
}

export function createRealFft(size: number): RealFft {
  if (!Number.isInteger(size) || size < 2 || (size & (size - 1)) !== 0) {
    throw new DspInputError('BAD_FRAME', `FFT size ${String(size)} is not a power of two`);
  }
  const bits = Math.round(Math.log2(size));
  const rev = new Uint32Array(size);
  for (let i = 0; i < size; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(size / 2);
  const sin = new Float64Array(size / 2);
  for (let k = 0; k < size / 2; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / size);
    sin[k] = -Math.sin((2 * Math.PI * k) / size);
  }
  const re = new Float64Array(size);
  const im = new Float64Array(size);

  return {
    size,
    magnitudes(input, out) {
      if (input.length > size) throw new DspInputError('BAD_FRAME', `FFT input longer than ${size}`);
      if (out.length !== size / 2 + 1) throw new DspInputError('BAD_FRAME', 'FFT output has the wrong length');
      for (let i = 0; i < size; i++) {
        const j = rev[i] ?? 0;
        re[j] = i < input.length ? (input[i] ?? 0) : 0;
        im[j] = 0;
      }
      for (let len = 2; len <= size; len <<= 1) {
        const half = len >> 1;
        const step = size / len;
        for (let start = 0; start < size; start += len) {
          for (let j = 0; j < half; j++) {
            const wr = cos[j * step] ?? 1;
            const wi = sin[j * step] ?? 0;
            const a = start + j;
            const b = a + half;
            const xr = re[b] ?? 0;
            const xi = im[b] ?? 0;
            const tr = xr * wr - xi * wi;
            const ti = xr * wi + xi * wr;
            const ar = re[a] ?? 0;
            const ai = im[a] ?? 0;
            re[b] = ar - tr;
            im[b] = ai - ti;
            re[a] = ar + tr;
            im[a] = ai + ti;
          }
        }
      }
      for (let k = 0; k <= size / 2; k++) {
        const r = re[k] ?? 0;
        const m = im[k] ?? 0;
        out[k] = Math.sqrt(r * r + m * m);
      }
    },
  };
}
