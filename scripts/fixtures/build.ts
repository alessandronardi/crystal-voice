// Renders catalog entries to WAV bytes + meta, and builds the manifest (I-04).
// Pure with respect to the file system: writing is done by generate.ts.

import { createHash } from 'node:crypto';
import { CATALOG, FIXTURES_VERSION, type FixtureSpec, type Json } from './catalog.ts';
import { peak } from './synth/signal.ts';
import { encodeWav } from './wav.ts';

/** Peak above which a fixture that is not meant to clip is rejected (≈ −0.1 dBFS). */
const MAX_PEAK = 0.99;

export interface BuiltFixture {
  name: string;
  wav: Uint8Array;
  sha256: string;
  /** Exact text written to `<name>.meta.json`. */
  metaText: string;
}

export interface ManifestEntry {
  sha256: string;
  bytes: number;
  sampleRate: number;
  channelCount: number;
  lengthSamples: number;
}

export interface Manifest {
  fixturesVersion: string;
  files: { [name: string]: ManifestEntry };
}

export class FixtureBuildError extends Error {
  override readonly name = 'FixtureBuildError';
  readonly code: 'UNINTENDED_CLIPPING' | 'NON_FINITE_SAMPLE' | 'UNKNOWN_FIXTURE';
  constructor(code: FixtureBuildError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Decimal places kept for non-integer numbers in meta files. */
const META_DECIMALS = 1e9;

const roundFloat = (_key: string, v: unknown): unknown =>
  typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * META_DECIMALS) / META_DECIMALS : v;

/**
 * JSON with 2-space indent and a trailing newline; key order is the insertion
 * order of the catalog. Non-integer numbers are rounded to 9 decimals so that a
 * last-ulp difference in libm (Math.log2, Math.exp, **) between platforms does
 * not change the committed meta files.
 */
export const stableJson = (value: Json | Manifest): string => `${JSON.stringify(value, roundFloat, 2)}\n`;

export function buildFixture(spec: FixtureSpec): BuiltFixture {
  const { channels, expected } = spec.render();
  for (const ch of channels) {
    for (const v of ch) {
      if (!Number.isFinite(v)) throw new FixtureBuildError('NON_FINITE_SAMPLE', `${spec.name}: non-finite sample`);
    }
    const p = peak(ch);
    if (spec.allowClipping !== true && p > MAX_PEAK) {
      throw new FixtureBuildError('UNINTENDED_CLIPPING', `${spec.name}: peak ${p.toFixed(4)} > ${MAX_PEAK}`);
    }
  }
  const wav = encodeWav({ sampleRate: spec.sampleRate, channels });
  const first = channels[0];
  const meta: Json = {
    name: spec.name,
    fixturesVersion: FIXTURES_VERSION,
    family: spec.family,
    description: spec.description,
    sampleRate: spec.sampleRate,
    channelCount: channels.length,
    lengthSamples: first?.length ?? 0,
    durationSeconds: (first?.length ?? 0) / spec.sampleRate,
    seed: spec.seed,
    params: spec.params,
    expected,
  };
  return { name: spec.name, wav, sha256: sha256Hex(wav), metaText: stableJson(meta) };
}

export function selectSpecs(names?: readonly string[]): readonly FixtureSpec[] {
  if (names === undefined || names.length === 0) return CATALOG;
  return names.map((n) => {
    const spec = CATALOG.find((s) => s.name === n);
    if (spec === undefined) throw new FixtureBuildError('UNKNOWN_FIXTURE', `unknown fixture ${n}`);
    return spec;
  });
}

export function manifestEntry(spec: FixtureSpec, built: BuiltFixture): ManifestEntry {
  const view = new DataView(built.wav.buffer, built.wav.byteOffset, built.wav.byteLength);
  const channelCount = view.getUint16(22, true);
  return {
    sha256: built.sha256,
    bytes: built.wav.byteLength,
    sampleRate: spec.sampleRate,
    channelCount,
    lengthSamples: (built.wav.byteLength - 44) / (2 * channelCount),
  };
}

export function buildManifest(specs: readonly FixtureSpec[], built: readonly BuiltFixture[]): Manifest {
  const files: { [name: string]: ManifestEntry } = {};
  specs.forEach((spec, i) => {
    const b = built[i];
    if (b !== undefined) files[spec.name] = manifestEntry(spec, b);
  });
  return { fixturesVersion: FIXTURES_VERSION, files };
}
