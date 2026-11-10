// Shared signal helpers for fixture synthesis (I-04). Float64 internally;
// conversion to Float32/int16 happens only when a fixture is encoded.

export type Signal = Float64Array;

export const dbToGain = (db: number): number => 10 ** (db / 20);
export const gainToDb = (gain: number): number => 20 * Math.log10(gain);

export function samplesFor(seconds: number, sampleRate: number): number {
  return Math.round(seconds * sampleRate);
}

export function rms(x: Signal, from = 0, to = x.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) {
    const v = x[i] ?? 0;
    sum += v * v;
  }
  return to > from ? Math.sqrt(sum / (to - from)) : 0;
}

/**
 * RMS over the "active" samples of a signal with pauses: those whose |value|
 * exceeds `relativeFloor` × peak. The floor is relative, so the measure is
 * scale-invariant (activeRms(g·x) = g·activeRms(x)).
 */
export function activeRms(x: Signal, relativeFloor = 1e-3): number {
  const floor = peak(x) * relativeFloor;
  let sum = 0;
  let n = 0;
  for (const v of x) {
    if (Math.abs(v) > floor) {
      sum += v * v;
      n++;
    }
  }
  return n > 0 ? Math.sqrt(sum / n) : 0;
}

export function peak(x: Signal): number {
  let p = 0;
  for (const v of x) p = Math.max(p, Math.abs(v));
  return p;
}

export function scale(x: Signal, gain: number): Signal {
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = (x[i] ?? 0) * gain;
  return out;
}

/** Scales `x` so that its RMS (or active RMS) equals `targetDbfs`. */
export function normalizeTo(x: Signal, targetDbfs: number, mode: 'rms' | 'active' = 'rms'): Signal {
  const level = mode === 'rms' ? rms(x) : activeRms(x);
  if (level === 0) return x;
  return scale(x, dbToGain(targetDbfs) / level);
}

export function add(a: Signal, b: Signal): Signal {
  if (a.length !== b.length) throw new RangeError('add: length mismatch');
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] ?? 0) + (b[i] ?? 0);
  return out;
}

export function concat(...parts: readonly Signal[]): Signal {
  const out = new Float64Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * Two-pole resonator (formant filter), unity gain at the centre frequency.
 * y[n] = g·x[n] − a1·y[n−1] − a2·y[n−2], with r = e^(−π·bw/fs).
 */
export function resonate(x: Signal, freqHz: number, bandwidthHz: number, sampleRate: number): Signal {
  const r = Math.exp((-Math.PI * bandwidthHz) / sampleRate);
  const theta = (2 * Math.PI * freqHz) / sampleRate;
  const a1 = -2 * r * Math.cos(theta);
  const a2 = r * r;
  // Gain normalization: |H(e^jθ)| = 1.
  const re = 1 + a1 * Math.cos(theta) + a2 * Math.cos(2 * theta);
  const im = -(a1 * Math.sin(theta) + a2 * Math.sin(2 * theta));
  const g = Math.hypot(re, im);
  const out = new Float64Array(x.length);
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = g * (x[i] ?? 0) - a1 * y1 - a2 * y2;
    out[i] = y;
    y2 = y1;
    y1 = y;
  }
  return out;
}

/** Raised-cosine fade in/out of `fadeSamples` at both ends (in place). */
export function fadeEdges(x: Signal, fadeSamples: number): Signal {
  const n = Math.min(fadeSamples, Math.floor(x.length / 2));
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((Math.PI * i) / n);
    x[i] = (x[i] ?? 0) * w;
    const j = x.length - 1 - i;
    x[j] = (x[j] ?? 0) * w;
  }
  return x;
}
