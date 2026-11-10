// Offline benchmark harness (I-04, BENCHMARK_PROTOCOL §1, SPEC §15).
// Runs dsp-core on every fixture listed in the manifest and returns a report.
// Wall-clock timing is allowed here (harness only, never in dsp-core).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { join } from 'node:path';
import { PITCH_TRACK_VERSION, SIGNAL_SUMMARY_VERSION, signalSummary, trackPitch, type SignalSummary } from '@voicecrystal/dsp-core';
import {
  centsBetween,
  frameErrors,
  OCTAVE_ERROR_LOG2,
  parsePitchTruth,
  pitchFixtureMetrics,
  type PitchFixtureMetrics,
} from './pitch-metrics.ts';
import { median } from '@voicecrystal/dsp-core';
import { sha256Hex, type Manifest, type ManifestEntry } from '../../scripts/fixtures/build.ts';
import { decodeWav } from '../../scripts/fixtures/wav.ts';

export const BENCH_REPORT_VERSION = 2;

/** M2 targets [H] (BENCHMARK_PROTOCOL §4). */
export const M2_MAX_MEDIAN_REL_ERROR = 0.01;
export const M2_MAX_OCTAVE_ERROR_RATE = 0.02;
/**
 * Families that form the M2 set: distinct clean synthetic voices with a known
 * f0 track. Gain and sample-rate variants are the same signal (they belong to
 * M3, reported in `invariance`) and would only duplicate frames.
 */
export const M2_FAMILIES = ['voice'] as const;

export interface BenchEnvironment {
  commit: string | null;
  workingTreeDirty: boolean | null;
  node: string;
  cpu: string;
  os: string;
  date: string;
  /** DSP runs in Node here; Chrome is measured separately (BENCHMARK_PROTOCOL §1). */
  chrome: null;
  /** Not defined until I-06 introduces descriptors: null, never a made-up value. */
  extractorVersion: null;
  mappingVersion: null;
  analyzers: string[];
}

export interface FixtureResult {
  name: string;
  sha256: string;
  durationSeconds: number;
  family: string | null;
  channels: SignalSummary[];
  pitch: PitchFixtureMetrics;
  monoRule: string;
  cancellationDb: number | null;
  warnings: string[];
  /** Wall time of the analyzers on this fixture (decode excluded). */
  analysisMs: number;
  /** Analysis seconds per second of audio (BENCHMARK_PROTOCOL M12). */
  secondsPerAudioSecond: number;
}

export interface BenchReport {
  reportVersion: number;
  fixturesVersion: string;
  environment: BenchEnvironment;
  totals: { fixtures: number; audioSeconds: number; analysisMs: number; secondsPerAudioSecond: number };
  /** BENCHMARK_PROTOCOL M2 pooled over the frames of the M2 families. */
  m2: {
    fixtures: string[];
    framesCompared: number;
    medianRelError: number | null;
    octaveErrorRate: number | null;
    octaveErrorDefinition: string;
    scope: string;
    targets: { medianRelError: number; octaveErrorRate: number };
    meetsTargets: boolean | null;
  };
  /** Median f0 differences (cents) between variants of voice-a (M3 for pitch only). */
  invariance: { [pair: string]: number | null };
  fixtures: FixtureResult[];
}

export class BenchError extends Error {
  override readonly name = 'BenchError';
  readonly code: 'MANIFEST_MISSING' | 'MANIFEST_INVALID' | 'FIXTURE_MISSING' | 'HASH_MISMATCH';
  constructor(code: BenchError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const isPositiveInt = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v > 0;

function isEntry(v: unknown): v is ManifestEntry {
  return (
    isRecord(v) &&
    typeof v['sha256'] === 'string' &&
    /^[0-9a-f]{64}$/.test(v['sha256']) &&
    isPositiveInt(v['bytes']) &&
    isPositiveInt(v['sampleRate']) &&
    isPositiveInt(v['channelCount']) &&
    isPositiveInt(v['lengthSamples'])
  );
}

export function readManifest(dir: string): Manifest {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  } catch {
    throw new BenchError('MANIFEST_MISSING', `manifest.json non leggibile in ${dir}: esegui "pnpm fixtures"`);
  }
  if (!isRecord(raw) || typeof raw['fixturesVersion'] !== 'string' || !isRecord(raw['files'])) {
    throw new BenchError('MANIFEST_INVALID', 'manifest.json: struttura non valida');
  }
  const files: Manifest['files'] = {};
  for (const [name, entry] of Object.entries(raw['files'])) {
    if (!/^[a-z0-9-]+$/.test(name) || !isEntry(entry)) {
      throw new BenchError('MANIFEST_INVALID', `manifest.json: voce non valida "${name}"`);
    }
    files[name] = entry;
  }
  return { fixturesVersion: raw['fixturesVersion'], files };
}

function git(args: readonly string[]): string | null {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export function describeEnvironment(now: Date): BenchEnvironment {
  const status = git(['status', '--porcelain']);
  return {
    commit: git(['rev-parse', 'HEAD']),
    workingTreeDirty: status === null ? null : status.length > 0,
    node: process.version,
    cpu: cpus()[0]?.model.trim() ?? 'unknown',
    os: `${platform()} ${release()}`,
    date: now.toISOString(),
    chrome: null,
    extractorVersion: null,
    mappingVersion: null,
    analyzers: [SIGNAL_SUMMARY_VERSION, PITCH_TRACK_VERSION],
  };
}

export function runBench(dir: string, environment: BenchEnvironment): BenchReport {
  const manifest = readManifest(dir);
  const fixtures: FixtureResult[] = [];
  const pooledErrors: number[] = [];
  let pooledOctave = 0;
  const m2Fixtures: string[] = [];
  for (const [name, entry] of Object.entries(manifest.files)) {
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(join(dir, `${name}.wav`));
    } catch {
      throw new BenchError('FIXTURE_MISSING', `${name}.wav mancante: esegui "pnpm fixtures"`);
    }
    const sha256 = sha256Hex(bytes);
    if (sha256 !== entry.sha256) {
      throw new BenchError('HASH_MISMATCH', `${name}.wav non corrisponde al manifest: esegui "pnpm fixtures"`);
    }
    const audio = decodeWav(bytes);
    const durationSeconds = (audio.channels[0]?.length ?? 0) / audio.sampleRate;
    let metaText = '';
    try {
      metaText = readFileSync(join(dir, `${name}.meta.json`), 'utf8');
    } catch {
      // No meta: no ground truth, summaries only.
    }
    const truth = parsePitchTruth(metaText);
    const family = familyOf(metaText);
    const started = performance.now();
    const channels = audio.channels.map((ch) => signalSummary(ch, audio.sampleRate));
    const track = trackPitch(audio.channels, audio.sampleRate);
    const analysisMs = performance.now() - started;
    if (truth !== null && family !== null && (M2_FAMILIES as readonly string[]).includes(family)) {
      const e = frameErrors(track, truth);
      pooledErrors.push(...e.errors);
      pooledOctave += e.octave;
      m2Fixtures.push(name);
    }
    fixtures.push({
      name,
      sha256,
      durationSeconds,
      family,
      channels,
      pitch: pitchFixtureMetrics(track, truth),
      monoRule: track.mono.rule,
      cancellationDb: track.mono.cancellationDb,
      warnings: [...track.mono.warnings],
      analysisMs,
      secondsPerAudioSecond: durationSeconds > 0 ? analysisMs / 1000 / durationSeconds : 0,
    });
  }
  const medianRelError = median(pooledErrors);
  const octaveErrorRate = pooledErrors.length > 0 ? pooledOctave / pooledErrors.length : null;
  const f0Of = (n: string): number | null => fixtures.find((f) => f.name === n)?.pitch.medianF0Hz ?? null;
  const audioSeconds = fixtures.reduce((s, f) => s + f.durationSeconds, 0);
  const analysisMs = fixtures.reduce((s, f) => s + f.analysisMs, 0);
  return {
    reportVersion: BENCH_REPORT_VERSION,
    fixturesVersion: manifest.fixturesVersion,
    environment,
    totals: {
      fixtures: fixtures.length,
      audioSeconds,
      analysisMs,
      secondsPerAudioSecond: audioSeconds > 0 ? analysisMs / 1000 / audioSeconds : 0,
    },
    m2: {
      fixtures: m2Fixtures,
      framesCompared: pooledErrors.length,
      medianRelError,
      octaveErrorRate,
      octaveErrorDefinition: `|log2(estimate/truth)| > ${OCTAVE_ERROR_LOG2}`,
      scope: 'voci sintetiche sorgente-filtro (impulso di Rosenberg, jitter 0,5%): non vale per il parlato reale (G1, I-08)',
      targets: { medianRelError: M2_MAX_MEDIAN_REL_ERROR, octaveErrorRate: M2_MAX_OCTAVE_ERROR_RATE },
      meetsTargets:
        medianRelError === null || octaveErrorRate === null
          ? null
          : medianRelError <= M2_MAX_MEDIAN_REL_ERROR && octaveErrorRate <= M2_MAX_OCTAVE_ERROR_RATE,
    },
    invariance: {
      'voice-a→voice-a-44k': centsBetween(f0Of('voice-a'), f0Of('voice-a-44k')),
      'voice-a→voice-a-plus6db': centsBetween(f0Of('voice-a'), f0Of('voice-a-plus6db')),
      'voice-a→voice-a-minus6db': centsBetween(f0Of('voice-a'), f0Of('voice-a-minus6db')),
    },
    fixtures,
  };
}

function familyOf(metaText: string): string | null {
  try {
    const meta: unknown = JSON.parse(metaText);
    return isRecord(meta) && typeof meta['family'] === 'string' ? meta['family'] : null;
  } catch {
    return null;
  }
}
