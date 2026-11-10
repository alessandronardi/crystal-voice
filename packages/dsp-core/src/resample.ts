// Deterministic rational resampler with an anti-alias filter (SPEC §7.1).
//
// out[n] = Σ_k x[k]·h(n·M/L − k), with L/M = outRate/inRate reduced by the
// gcd. h is a sinc low-pass at RESAMPLE_CUTOFF × min(in, out)/2 under a Kaiser
// window spanning ±RESAMPLE_HALF_TAPS output-rate zero crossings. One tap
// table per polyphase phase, each normalized to unit DC gain. Samples outside
// the input are zero. Float64 accumulation, Float32 output.
//
// WHOLE-BUFFER ONLY: `process` is stateless and zero-pads both edges, and its
// output length is ceil(n·L/M) per call. Feeding consecutive blocks gives
// artefacts at the joints and a drifting sample count. A streaming resampler
// (with state and phase counter) is needed for the worker path and must be
// tested as "concatenated blocks = whole buffer".

import { RESAMPLE_CUTOFF, RESAMPLE_HALF_TAPS, RESAMPLE_KAISER_BETA } from './config.ts';
import { DspInputError } from './errors.ts';

/** Polyphase phases above this are refused: such rate pairs are not expected from browsers. */
const MAX_PHASES = 2000;

export interface Resampler {
  readonly inRate: number;
  readonly outRate: number;
  /** Resamples one complete signal. Not for consecutive blocks (see the module comment). */
  process(pcm: Float32Array): Float32Array;
}

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}

/** Modified Bessel function of the first kind, order 0 (power series). */
function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 50; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return sum;
}

export function createResampler(inRate: number, outRate: number): Resampler {
  for (const r of [inRate, outRate]) {
    if (!Number.isInteger(r) || r <= 0) throw new DspInputError('BAD_SAMPLE_RATE', `sample rate ${String(r)}`);
  }
  if (inRate === outRate) {
    return { inRate, outRate, process: (pcm) => checked(pcm).slice() };
  }
  const g = gcd(inRate, outRate);
  const up = outRate / g; // L
  const down = inRate / g; // M
  if (up > MAX_PHASES) throw new DspInputError('UNSUPPORTED_RATE', `${inRate} → ${outRate} needs ${up} phases`);

  // Cutoff in cycles per input sample; kernel half-width in input samples.
  const cutoff = (RESAMPLE_CUTOFF * Math.min(inRate, outRate)) / 2 / inRate;
  const halfWidth = RESAMPLE_HALF_TAPS * Math.max(1, inRate / outRate);
  const taps = 2 * Math.ceil(halfWidth);
  const i0Beta = besselI0(RESAMPLE_KAISER_BETA);

  // Phase p: output time offset frac = p/L input samples after the base sample.
  const tables: Float64Array[] = [];
  for (let p = 0; p < up; p++) {
    const frac = p / up;
    const table = new Float64Array(taps);
    let sum = 0;
    for (let j = 0; j < taps; j++) {
      // Tap j multiplies x[base − taps/2 + 1 + j]; distance from the output time:
      const d = frac - (j - taps / 2 + 1);
      let h = 0;
      if (Math.abs(d) < halfWidth) {
        const arg = 2 * cutoff * d;
        const sinc = arg === 0 ? 1 : Math.sin(Math.PI * arg) / (Math.PI * arg);
        const w = d / halfWidth;
        const kaiser = besselI0(RESAMPLE_KAISER_BETA * Math.sqrt(1 - w * w)) / i0Beta;
        h = 2 * cutoff * sinc * kaiser;
      }
      table[j] = h;
      sum += h;
    }
    for (let j = 0; j < taps; j++) table[j] = (table[j] ?? 0) / sum;
    tables.push(table);
  }

  return {
    inRate,
    outRate,
    process(pcm: Float32Array): Float32Array {
      const x = checked(pcm);
      const outLength = Math.ceil((x.length * up) / down);
      const out = new Float32Array(outLength);
      for (let n = 0; n < outLength; n++) {
        const pos = n * down; // in units of 1/L input samples
        const base = Math.floor(pos / up);
        const table = tables[pos - base * up];
        if (table === undefined) throw new DspInputError('UNSUPPORTED_RATE', 'phase table missing');
        const first = base - taps / 2 + 1;
        let acc = 0;
        const jFrom = Math.max(0, -first);
        const jTo = Math.min(taps, x.length - first);
        for (let j = jFrom; j < jTo; j++) acc += (table[j] ?? 0) * (x[first + j] ?? 0);
        out[n] = acc;
      }
      return out;
    },
  };
}

function checked(pcm: Float32Array): Float32Array {
  for (const v of pcm) {
    if (!Number.isFinite(v)) throw new DspInputError('NON_FINITE_INPUT', 'non-finite PCM sample');
  }
  return pcm;
}

export function resample(pcm: Float32Array, inRate: number, outRate: number): Float32Array {
  return createResampler(inRate, outRate).process(pcm);
}
