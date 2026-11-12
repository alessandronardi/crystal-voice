// `pnpm bench:vad` (I-05b, SPEC §7.2, VC-11): WebRTC VAD (libfvad, modes 0–3)
// against the band-energy pre-filter (diagnostics) and, with --silero, Silero
// VAD as an offline reference. Same fixtures, same truth, same 20 ms frames.
//
//   pnpm bench:vad [--silero] [--fixtures DIR] [--out DIR]
//
// --silero needs tools/silero-reference installed (`pnpm install
// --frozen-lockfile` there) and its model fetched (`node fetch-model.ts`).
// Wall-clock timing is allowed here (bench only, never in dsp-core).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ANALYSIS_SAMPLE_RATE,
  createBandEnergyPrefilter,
  createWebRtcVad,
  frameAt,
  frameCount,
  mixToMono,
  resample,
  VAD_FRAME_SAMPLES,
  type FvadMode,
  type VadEngine,
} from '@voicecrystal/dsp-core';
import { decodeWav } from '../../scripts/fixtures/wav.ts';
import { describeEnvironment, readManifest } from './harness.ts';
import { loadFvad } from './fvad-loader.ts';
import { addDecisions, CATEGORIES, emptyTallies, frameTruths, GUARD_FRAMES, rates, type CategoryTallies, type FrameTruth, type VadRates } from './vad-metrics.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const FRAME_SECONDS = VAD_FRAME_SAMPLES / ANALYSIS_SAMPLE_RATE;

interface Prepared {
  name: string;
  family: string;
  seconds: number;
  frames: Float32Array[];
  pcm16k: Float32Array;
  truths: FrameTruth[];
}

interface EngineResult {
  id: string;
  primary: boolean;
  tallies: CategoryTallies;
  rates: VadRates;
  /** Wall-clock milliseconds per second of audio (this machine; see environment). */
  msPerAudioSecond: number;
  perFixture: Record<string, { speechShare: number; frames: number }>;
}

function arg(argv: readonly string[], flag: string, fallback: string): string {
  const i = argv.indexOf(flag);
  return i >= 0 ? resolve(argv[i + 1] ?? fallback) : fallback;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function prepare(dir: string): Prepared[] {
  const manifest = readManifest(dir);
  const out: Prepared[] = [];
  for (const name of Object.keys(manifest.files)) {
    const audio = decodeWav(readFileSync(join(dir, `${name}.wav`)));
    const meta: unknown = JSON.parse(readFileSync(join(dir, `${name}.meta.json`), 'utf8'));
    if (!isRecord(meta) || typeof meta['family'] !== 'string' || !isRecord(meta['expected'])) throw new Error(`${name}: bad meta`);
    const mono = mixToMono(audio.channels, audio.sampleRate).pcm;
    const pcm16k = audio.sampleRate === ANALYSIS_SAMPLE_RATE ? mono : resample(mono, audio.sampleRate, ANALYSIS_SAMPLE_RATE);
    const n = frameCount(pcm16k.length, VAD_FRAME_SAMPLES, VAD_FRAME_SAMPLES);
    const frames = Array.from({ length: n }, (_, k) => frameAt(pcm16k, k, VAD_FRAME_SAMPLES, VAD_FRAME_SAMPLES));
    const track = meta['expected']['f0Track'];
    let truths: FrameTruth[];
    if (isRecord(track) && typeof track['hopSamples'] === 'number' && Array.isArray(track['valuesHz'])) {
      truths = frameTruths(
        { hopSamples: track['hopSamples'], valuesHz: track['valuesHz'] as (number | null)[] },
        audio.sampleRate,
        n,
        FRAME_SECONDS,
      );
    } else {
      truths = new Array<FrameTruth>(n).fill(null);
    }
    out.push({ name, family: meta['family'], seconds: mono.length / audio.sampleRate, frames, pcm16k, truths });
  }
  return out;
}

function finish(id: string, primary: boolean, tallies: CategoryTallies, ms: number, seconds: number, perFixture: EngineResult['perFixture']): EngineResult {
  return { id, primary, tallies, rates: rates(tallies), msPerAudioSecond: ms / seconds, perFixture };
}

function runSync(make: () => VadEngine & { dispose?: () => void }, data: readonly Prepared[]): EngineResult {
  const tallies = emptyTallies();
  const perFixture: EngineResult['perFixture'] = {};
  let ms = 0;
  let seconds = 0;
  let id = '';
  let primary = false;
  for (const f of data) {
    const engine = make();
    id = engine.id;
    primary = engine.primary;
    const started = performance.now();
    const decisions = f.frames.map((frame) => engine.process(frame).speech);
    ms += performance.now() - started;
    seconds += f.seconds;
    engine.dispose?.();
    addDecisions(tallies, f.family, f.truths, decisions);
    perFixture[f.name] = { speechShare: decisions.filter(Boolean).length / Math.max(1, decisions.length), frames: decisions.length };
  }
  return finish(id, primary, tallies, ms, seconds, perFixture);
}

interface SileroModule {
  createSilero(modelFile: string, tag: string): Promise<{ id: string; probabilities(pcm: Float32Array): Promise<Float32Array> }>;
  toFrameDecisions(p: Float32Array, frames: number, frameSamples: number): boolean[];
}

async function runSilero(data: readonly Prepared[]): Promise<{ result: EngineResult; modelSha256: string }> {
  const dir = join(ROOT, 'tools/silero-reference');
  // Not a static import: the package is outside the workspace and usually not installed.
  const silero = (await import(pathToFileURL(join(dir, 'silero.ts')).href)) as SileroModule;
  const model = (await import(pathToFileURL(join(dir, 'fetch-model.ts')).href)) as {
    MODEL_FILE: string;
    SILERO_TAG: string;
    checkModel(bytes: Uint8Array): string;
  };
  const modelSha256 = model.checkModel(readFileSync(model.MODEL_FILE));
  const runner = await silero.createSilero(model.MODEL_FILE, model.SILERO_TAG);
  const tallies = emptyTallies();
  const perFixture: EngineResult['perFixture'] = {};
  let ms = 0;
  let seconds = 0;
  for (const f of data) {
    const started = performance.now();
    const p = await runner.probabilities(f.pcm16k);
    ms += performance.now() - started;
    seconds += f.seconds;
    const decisions = silero.toFrameDecisions(p, f.frames.length, VAD_FRAME_SAMPLES);
    addDecisions(tallies, f.family, f.truths, decisions);
    perFixture[f.name] = { speechShare: decisions.filter(Boolean).length / Math.max(1, decisions.length), frames: decisions.length };
  }
  return { result: finish(runner.id, false, tallies, ms, seconds, perFixture), modelSha256 };
}

async function main(argv: readonly string[]): Promise<number> {
  const fixtureDir = arg(argv, '--fixtures', join(ROOT, 'tests/fixtures'));
  const outDir = arg(argv, '--out', join(ROOT, 'tests/benchmarks/out'));
  const now = new Date();
  const data = prepare(fixtureDir);
  const fvad = loadFvad();
  const engines: EngineResult[] = [];
  for (const mode of [0, 1, 2, 3] as const satisfies readonly FvadMode[]) {
    const r = runSync(() => createWebRtcVad(fvad.fvad, mode), data);
    engines.push({ ...r, id: `${r.id}-mode${mode}` });
  }
  engines.push(runSync(createBandEnergyPrefilter, data));
  let silero: { modelSha256: string } | null = null;
  if (argv.includes('--silero')) {
    const s = await runSilero(data);
    engines.push(s.result);
    silero = { modelSha256: s.modelSha256 };
  }
  const report = {
    version: 2,
    guardFrames: GUARD_FRAMES,
    environment: describeEnvironment(now),
    fvad: { bytes: fvad.bytes, gzipBytes: gzipSync(readFileSync(join(ROOT, 'packages/dsp-core/wasm/fvad.wasm')), { level: 9 }).length, sha256: fvad.sha256 },
    silero,
    fixtures: data.length,
    audioSeconds: data.reduce((s, f) => s + f.seconds, 0),
    engines,
  };
  mkdirSync(outDir, { recursive: true });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(join(outDir, `vad-${now.toISOString().replace(/[:.]/g, '-')}.json`), text);
  writeFileSync(join(outDir, 'vad-latest.json'), text);
  const pct = (v: number | null): string => (v === null ? 'n/d' : `${(v * 100).toFixed(1)}%`);
  console.log(
    `fvad.wasm ${report.fvad.bytes} B (gzip ${report.fvad.gzipBytes} B); ${data.length} fixture, ${report.audioSeconds.toFixed(0)} s analizzati ` +
      `(i ms per s di audio contano tutto l'audio analizzato, anche quello escluso dalle cifre)`,
  );
  const first = engines[0];
  if (first) {
    console.log(`frame contati per categoria (banda di guardia ±${GUARD_FRAMES} frame): ${CATEGORIES.map((c) => `${c} ${first.tallies[c].frames}`).join(', ')}`);
  }
  const head = ['FN voce', 'FN voce+mus', 'FP mus. sola', 'FP mus. pause', 'FP pause', 'FP silenzio', 'FP toni/rum.', 'ms/s audio'];
  console.log(`${'motore'.padEnd(30)}${head.map((h) => h.padStart(14)).join('')}`);
  for (const e of engines) {
    const r = e.rates;
    const cells = [
      r.falseNegativeVoice,
      r.falseNegativeVoiceWithMusic,
      r.falsePositiveMusicOnly,
      r.falsePositiveMusicInPause,
      r.falsePositivePause,
      r.falsePositiveSilence,
      r.falsePositiveTonesNoise,
    ].map((v) => pct(v).padStart(14));
    console.log(`${e.id.padEnd(30)}${cells.join('')}${e.msPerAudioSecond.toFixed(3).padStart(14)}`);
  }
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
