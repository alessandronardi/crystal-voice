// I-18 E2E: the local-file source in the side panel (ADR-0022). A file enters
// the panel's <input type="file"> through CDP DOM.setFileInputFiles; the panel
// decodes it and analyses it in its own dsp-worker. The reference is the same
// computation in Node (tests/fixtures WAVs decoded by scripts/fixtures/wav.ts,
// then extension/src/shared/pcm-analysis.ts): equal digests mean the panel's
// 16 kHz mono signal, per-channel summaries and pitch track are bit-identical
// to the offline harness (BACKLOG I-18, decision D4). Large and malformed
// files are synthetic and written to a temporary directory, never to the
// repository (AGENTS.md R16). Requires `pnpm build` and `pnpm fixtures`.
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { decodeWav, encodeWav } from '../../scripts/fixtures/wav.ts';
import { analyzePcm, float32Bytes, sha256Hex, type PcmAnalysis } from '../../extension/src/shared/pcm-analysis.ts';
import { ExtensionHarness, OTHER_URL } from './harness.ts';

const FIXTURES = resolve(import.meta.dirname, '../fixtures');
const FAKE_MIC_WAV = join(FIXTURES, 'voice-a.wav');

const h = new ExtensionHarness();
let panelTab: Page;
let tmp: string;

test.describe.configure({ mode: 'serial' });

interface PanelResult {
  source: { kind: 'file'; fileName: string; durationSeconds: number; offsetStartSeconds: number; offsetEndSeconds: number };
  analysis: PcmAnalysis;
  path: 'wav-window' | 'whole';
}

const q = (testId: string): string => `document.querySelector('[data-testid="${testId}"]')`;
const exists = (testId: string): string => `${q(testId)} !== null`;
const click = (testId: string): string => `(() => { const el = ${q(testId)}; if (el === null) return false; el.click(); return true; })()`;
const text = (testId: string): string => `${q(testId)}?.textContent ?? ''`;
const phase = (): Promise<unknown> => h.inSidePanel(`${q('file-status')}?.dataset.phase ?? ''`);

async function openPanel(): Promise<void> {
  await h.clickAction(panelTab);
  await expect.poll(() => h.inSidePanel(exists('file-input'))).toBe(true);
}

async function choose(path: string): Promise<string> {
  await h.setPanelFile('file-input', path);
  await expect.poll(phase, { timeout: 15_000 }).toMatch(/^(ready|failed)$/);
  return String(await phase());
}

async function setStart(seconds: number): Promise<void> {
  await h.inSidePanel(`(() => { const el = ${q('file-start')}; el.value = '${String(seconds)}'; return true; })()`);
}

/** Clicks «Analizza» and waits for the end; returns the final phase. */
async function analyze(timeout = 30_000): Promise<string> {
  expect(await h.inSidePanel(click('file-analyze'))).toBe(true);
  await expect.poll(phase, { timeout }).toMatch(/^(done|failed|stopped)$/);
  return String(await phase());
}

async function panelResult(): Promise<PanelResult> {
  const json = await h.inSidePanel(`${q('file-digest')}?.dataset.analysis ?? ''`);
  return JSON.parse(String(json)) as PanelResult;
}

async function errorOf(): Promise<{ code: string; reason: string }> {
  return (await h.inSidePanel(
    `(() => { const el = ${q('file-error')}; return el === null ? null : { code: el.dataset.code, reason: el.dataset.reason ?? '' }; })()`,
  )) as { code: string; reason: string };
}

const RECIPROCAL_32767_F32 = Math.fround(1 / 32767);

/**
 * int16 → float as Chromium's decoder does it, measured on voice-a-44k.wav
 * (test «decodeAudioData …» below, every sample): negative values n / 32768,
 * positive values float32(n) × float32(1 / 32767) in float32 arithmetic, so
 * both full-scale ends map to ±1. The offline harness (scripts/fixtures/wav.ts)
 * divides every value by 32768.
 */
function toChromiumConvention(channel: Float32Array): Float32Array {
  return channel.map((v) => {
    const int = Math.round(v * 32768);
    return int < 0 ? int / 32768 : Math.fround(Math.fround(int) * RECIPROCAL_32767_F32);
  });
}

type Convention = 'harness' | 'chromium';

/** The Node reference: the harness decoder, optionally re-converted, then the panel's own analysis code. */
async function reference(file: string, convention: Convention, startFrame = 0, frameCount?: number): Promise<PcmAnalysis> {
  const audio = decodeWav(readFileSync(file));
  const count = frameCount ?? (audio.channels[0]?.length ?? 0) - startFrame;
  const channels = audio.channels.map((c) => c.slice(startFrame, startFrame + count));
  return analyzePcm(convention === 'chromium' ? channels.map(toChromiumConvention) : channels, audio.sampleRate);
}

/** Cents between two median f0 values (null when either is missing). */
function cents(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : 1200 * Math.log2(a / b);
}

function fixtureNames(): string[] {
  const manifest = JSON.parse(readFileSync(join(FIXTURES, 'manifest.json'), 'utf8')) as { files: Record<string, unknown> };
  return Object.keys(manifest.files);
}

/** A mono 16-bit WAV of `seconds` at `rate`: a quiet tone, cheap to build. */
function syntheticWav(name: string, seconds: number, rate: number, channels = 1): string {
  const frames = Math.round(seconds * rate);
  const data = Array.from({ length: channels }, (_, c) => {
    const ch = new Float32Array(frames);
    for (let i = 0; i < frames; i++) ch[i] = 0.1 * Math.sin((2 * Math.PI * (180 + 40 * c) * i) / rate);
    return ch;
  });
  const path = join(tmp, name);
  writeFileSync(path, encodeWav({ sampleRate: rate, channels: data }));
  return path;
}

/**
 * Starts a microphone session from the probe page as the panel would; with
 * `port`, the probe also attaches the panel port that keeps it alive (I-17).
 */
async function startMicFromProbe(port: boolean): Promise<string> {
  return h.probe.evaluate(async (withPort) => {
    const id = crypto.randomUUID();
    const g = globalThis as unknown as { vcPorts?: chrome.runtime.Port[] };
    if (withPort) {
      const onDiag = (message: unknown): boolean => {
        const m = message as { type?: unknown; sessionId?: unknown };
        if (m.type === 'CAPTURE_DIAG' && m.sessionId === id) {
          chrome.runtime.onMessage.removeListener(onDiag);
          (g.vcPorts ??= []).push(chrome.runtime.connect({ name: `vc-panel:${id}` }));
        }
        return false;
      };
      chrome.runtime.onMessage.addListener(onDiag);
    }
    await chrome.runtime.sendMessage({ v: 1, type: 'CAPTURE_START', source: 'mic', tabId: null, sessionId: id, seq: 0 }).catch(() => undefined);
    return id;
  }, port);
}

async function stopFromProbe(sessionId: string): Promise<void> {
  await h.probe.evaluate((id) => chrome.runtime.sendMessage({ v: 1, type: 'CAPTURE_STOP', reason: 'USER_STOP', sessionId: id, seq: 9 }), sessionId);
}

test.beforeAll(async () => {
  // The WAV fixtures are generated, not committed (R16): fail with the cause, not a probe error.
  const missing = fixtureNames().filter((name) => !existsSync(join(FIXTURES, `${name}.wav`)));
  if (missing.length > 0) throw new Error(`missing fixtures (run \`pnpm fixtures\`): ${missing.join(', ')}`);
  tmp = mkdtempSync(join(tmpdir(), 'voicecrystal-files-'));
  await h.launch({
    args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${FAKE_MIC_WAV}`],
  });
  panelTab = await h.context.newPage();
  await panelTab.goto(OTHER_URL);
  await openPanel();
});

test.afterAll(async () => {
  await h.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** Distance in units in the last place between two doubles of the same sign (null when either is null). */
function ulps(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return a === b ? 0 : null;
  const bits = (x: number): bigint => {
    const v = new DataView(new ArrayBuffer(8));
    v.setFloat64(0, x);
    return v.getBigInt64(0);
  };
  const d = bits(a) - bits(b);
  return Number(d < 0n ? -d : d);
}

/**
 * What must be bit-identical between the panel and Node given the same decoded
 * samples: everything that is arithmetic only. Values that go through
 * Math.log10 (levels in dB) are not: V8 14.6 (Node 26) and Chromium 156 return
 * different doubles for a few percent of log10 inputs (measured, see README).
 * Those are compared in ULP and reported.
 */
function arithmeticPart(a: PcmAnalysis): unknown {
  return {
    ...a,
    channels: a.channels.map(({ rmsDbfs: _rms, ...rest }) => rest),
    mono: { ...a.mono, cancellationDb: a.mono.cancellationDb === null },
    pitch: { ...a.pitch, sha256: null, medianRmsDbfs: null, fieldSha256: { ...a.pitch.fieldSha256, rmsDbfs: null } },
  };
}

test('every I-04 fixture loaded as a file: the panel DSP equals Node bit for bit; the decoder difference is measured', async () => {
  test.setTimeout(300_000);
  const differences: string[] = [];
  const logUlps: Record<string, { channelRmsDb: (number | null)[]; cancellationDb: number | null; frameRmsDigestEqual: boolean; medianFrameRmsDb: number | null }> = {};
  const vsHarness: Record<string, { fields: string[]; medianF0Cents: number | null; rmsDbDelta: number | null }> = {};
  for (const name of fixtureNames()) {
    const file = join(FIXTURES, `${name}.wav`);
    expect(await choose(file), name).toBe('ready');
    const end = await analyze();
    expect(end, `${name}: ${JSON.stringify(await errorOf())}`).toBe('done');
    const panel = await panelResult();
    expect(panel.path, name).toBe('wav-window');
    // 1. Same decoded samples (Chromium's int16 rule) → the arithmetic part of
    //    the DSP output is bit-identical; log10 values are measured in ULP.
    const same = await reference(file, 'chromium');
    if (JSON.stringify(arithmeticPart(panel.analysis)) !== JSON.stringify(arithmeticPart(same))) differences.push(name);
    expect(arithmeticPart(panel.analysis), name).toEqual(arithmeticPart(same));
    logUlps[name] = {
      channelRmsDb: panel.analysis.channels.map((c, i) => ulps(c.rmsDbfs, same.channels[i]?.rmsDbfs ?? null)),
      cancellationDb: ulps(panel.analysis.mono.cancellationDb, same.mono.cancellationDb),
      frameRmsDigestEqual: panel.analysis.pitch.fieldSha256.rmsDbfs === same.pitch.fieldSha256.rmsDbfs,
      medianFrameRmsDb: ulps(panel.analysis.pitch.medianRmsDbfs, same.pitch.medianRmsDbfs),
    };
    // 2. Against the offline harness as it is (int16/32768): measured, not required equal.
    const harness = await reference(file, 'harness');
    const rms = (a: PcmAnalysis): number | null => a.channels[0]?.rmsDbfs ?? null;
    const pr = rms(panel.analysis);
    const hr = rms(harness);
    vsHarness[name] = {
      fields: (['channels', 'mono', 'analysis', 'pitch'] as const).filter(
        (k) => JSON.stringify(panel.analysis[k]) !== JSON.stringify(harness[k]),
      ),
      medianF0Cents: cents(panel.analysis.pitch.medianF0Hz, harness.pitch.medianF0Hz),
      rmsDbDelta: pr === null || hr === null ? null : pr - hr,
    };
    const audio = decodeWav(readFileSync(file));
    const seconds = (audio.channels[0]?.length ?? 0) / audio.sampleRate;
    expect(panel.source, name).toEqual({
      kind: 'file',
      fileName: `${name}.wav`,
      durationSeconds: seconds,
      offsetStartSeconds: 0,
      offsetEndSeconds: Math.min(seconds, 120),
    });
    // The session ended: its routing state is gone.
    await expect.poll(() => h.storage('activeSession')).toBeUndefined();
  }
  const worst = Object.values(vsHarness).reduce(
    (w, v) => ({ cents: Math.max(w.cents, Math.abs(v.medianF0Cents ?? 0)), db: Math.max(w.db, Math.abs(v.rmsDbDelta ?? 0)) }),
    { cents: 0, db: 0 },
  );
  const logValues = Object.values(logUlps).flatMap((v) => [...v.channelRmsDb, v.cancellationDb, v.medianFrameRmsDb]);
  const log10Summary = {
    maxUlp: Math.max(...logValues.map((u) => u ?? 0)),
    nullMismatch: logValues.filter((u) => u === null).length,
    frameRmsDigestsDiffering: Object.values(logUlps).filter((v) => !v.frameRmsDigestEqual).length,
  };
  test.info().annotations.push(
    { type: 'fixtures compared', description: `${String(fixtureNames().length)}, arithmetic differences: ${differences.join(', ') || 'none'}` },
    { type: 'log10 values, panel vs Node', description: JSON.stringify(log10Summary) },
    { type: 'vs harness (int16/32768), worst', description: JSON.stringify(worst) },
  );
  writeFileSync(
    join(resolve(import.meta.dirname, '../../test-results'), 'i18-file-vs-harness.json'),
    JSON.stringify({ differences, log10Summary, logUlps, worst, vsHarness }, null, 2),
  );
  expect(differences).toEqual([]);
  // A log10 value present on one side and null on the other would not be a rounding difference.
  expect(log10Summary.nullMismatch).toBe(0);
});

test('a start offset analyses the chosen window: voice-a-long from 10 s', async () => {
  const file = join(FIXTURES, 'voice-a-long.wav');
  expect(await choose(file)).toBe('ready');
  await setStart(10);
  expect(await analyze()).toBe('done');
  const panel = await panelResult();
  expect(panel.source).toMatchObject({ offsetStartSeconds: 10, offsetEndSeconds: 42, durationSeconds: 42 });
  expect(arithmeticPart(panel.analysis)).toEqual(arithmeticPart(await reference(file, 'chromium', 480000)));
});

test('decodeAudioData keeps the samples at the file rate and resamples at another (documented in README)', async () => {
  const file = join(FIXTURES, 'voice-a-44k.wav');
  expect(await choose(file)).toBe('ready');
  const measured = (await h.inSidePanel(`(async () => {
    const f = ${q('file-input')}.files[0];
    const bytes = await f.arrayBuffer();
    const out = {};
    for (const rate of [44100, 48000]) {
      const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: rate });
      const b = await ctx.decodeAudioData(bytes.slice(0));
      const ch = b.getChannelData(0);
      const le = new Uint8Array(ch.length * 4); const v = new DataView(le.buffer);
      for (let i = 0; i < ch.length; i++) v.setFloat32(i * 4, ch[i], true);
      const d = await crypto.subtle.digest('SHA-256', le);
      out[rate] = { sampleRate: b.sampleRate, length: b.length, sha256: Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('') };
      if (rate === 44100) out.samples = Array.from(ch);
    }
    return out;
  })()`)) as Record<string, { sampleRate: number; length: number; sha256: string }> & { samples?: number[] };
  // Which int16 → float rule Chromium applies, sample by sample.
  const decoded = measured.samples ?? [];
  delete measured.samples;
  const ints = Array.from(decodeWav(readFileSync(file)).channels[0] ?? [], (v) => Math.round(v * 32768));
  const rules = {
    harness: (n: number) => Math.fround(n / 32768),
    positiveDivide: (n: number) => (n < 0 ? Math.fround(n / 32768) : Math.fround(n / 32767)),
    positiveReciprocalF32: (n: number) => (n < 0 ? Math.fround(n / 32768) : Math.fround(Math.fround(n) * RECIPROCAL_32767_F32)),
  };
  const matches = Object.fromEntries(
    Object.entries(rules).map(([k, f]) => [k, ints.reduce((s, n, i) => s + (f(n) === decoded[i] ? 1 : 0), 0)]),
  );
  test.info().annotations.push({ type: 'int16 rule, samples matching of ' + String(ints.length), description: JSON.stringify(matches) });
  expect(matches['positiveReciprocalF32']).toBe(ints.length);

  const node = decodeWav(readFileSync(file)).channels[0] ?? new Float32Array();
  const harnessSha = await sha256Hex(float32Bytes(node));
  const chromiumSha = await sha256Hex(float32Bytes(toChromiumConvention(node)));
  test.info().annotations.push({ type: 'decodeAudioData', description: JSON.stringify({ ...measured, harnessSha, chromiumSha }) });
  // At the file's rate: not resampled, and exactly Chromium's int16 rule.
  expect(measured['44100']).toEqual({ sampleRate: 44100, length: 529200, sha256: chromiumSha });
  expect(chromiumSha).not.toBe(harnessSha);
  expect(measured['48000']?.sampleRate).toBe(48000);
  expect(measured['48000']?.length).toBe(576000);
});

test('over 30 minutes: FILE_TOO_LONG before decoding; exactly 30 minutes is analysed', async () => {
  test.setTimeout(120_000);
  const tooLong = syntheticWav('too-long.wav', 1801, 8000);
  const before = await h.storage('lastStart');
  expect(await choose(tooLong)).toBe('failed');
  expect(await errorOf()).toEqual({ code: 'FILE_TOO_LONG', reason: 'DURATION' });
  // Refused on selection: nothing to analyse, and no session was asked for.
  expect(await h.inSidePanel(exists('file-analyze'))).toBe(false);
  expect(await h.storage('lastStart')).toEqual(before);

  const limit = syntheticWav('thirty-minutes.wav', 1800, 8000);
  expect(await choose(limit)).toBe('ready');
  await setStart(1700);
  expect(await analyze()).toBe('done');
  expect((await panelResult()).source).toMatchObject({ durationSeconds: 1800, offsetStartSeconds: 1700, offsetEndSeconds: 1800 });
});

test('unreadable files: FILE_DECODE_FAILED, the panel stays usable', async () => {
  const junk = join(tmp, 'junk.wav');
  writeFileSync(junk, Uint8Array.from({ length: 4096 }, (_, i) => (i * 7919) % 251));
  const text = join(tmp, 'not-audio.mp3');
  writeFileSync(text, 'this is not audio at all\n'.repeat(100));
  const truncated = join(tmp, 'truncated.wav');
  writeFileSync(truncated, readFileSync(join(FIXTURES, 'voice-a.wav')).subarray(0, 30));
  for (const file of [junk, text, truncated]) {
    expect(await choose(file), file).toBe('failed');
    expect((await errorOf()).code, file).toBe('FILE_DECODE_FAILED');
  }
  // A WAV header over garbage samples is decodable (it is just noise): the analysis runs.
  expect(await choose(join(FIXTURES, 'voice-a.wav'))).toBe('ready');
});

test('a compressed file made in the browser (MediaRecorder) takes the whole-file path', async () => {
  test.setTimeout(60_000);
  const made = await h.probe.evaluate(async () => {
    const types = ['audio/mp4;codecs=opus', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/ogg;codecs=opus'];
    const type = types.find((t) => MediaRecorder.isTypeSupported(t));
    if (type === undefined) return null;
    const ctx = new AudioContext();
    await ctx.resume();
    const osc = ctx.createOscillator();
    osc.frequency.value = 220;
    const dest = ctx.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    const recorder = new MediaRecorder(dest.stream, { mimeType: type });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((r) => (recorder.onstop = r));
    recorder.start();
    await new Promise((r) => setTimeout(r, 2000));
    recorder.stop();
    await stopped;
    osc.stop();
    await ctx.close();
    const bytes = new Uint8Array(await new Blob(chunks, { type }).arrayBuffer());
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return { type, base64: btoa(bin), audioContextState: 'closed' };
  });
  test.skip(made === null, 'no MediaRecorder audio type supported');
  if (made === null) return;
  const ext = made.type.startsWith('audio/mp4') ? 'm4a' : made.type.startsWith('audio/webm') ? 'webm' : 'ogg';
  const file = join(tmp, `recorded.${ext}`);
  writeFileSync(file, Buffer.from(made.base64, 'base64'));
  const outcome = await choose(file);
  test.info().annotations.push({ type: 'MediaRecorder', description: `${made.type}: probe ${outcome}` });
  // MP4 carries its duration: with it the whole-file path must run (review M3).
  if (outcome === 'failed' && !made.type.startsWith('audio/mp4')) {
    // A recording without a duration in its metadata (known for WebM): refused, not guessed.
    expect(await errorOf()).toEqual({ code: 'FILE_DECODE_FAILED', reason: 'NO_DURATION' });
    test.info().annotations.push({ type: 'not covered', description: 'whole-file happy path: manual check M24' });
    return;
  }
  expect(outcome).toBe('ready');
  expect(await analyze()).toBe('done');
  const panel = await panelResult();
  expect(panel.path).toBe('whole');
  expect(panel.analysis.sourceSampleRate).toBe(48000);
  // The recorder starts late: a 2 s timer gives somewhat less audio (1.36 s observed).
  test.info().annotations.push({ type: 'recorded duration', description: `${String(panel.source.durationSeconds)} s, ${String(panel.analysis.channelCount)} channel(s)` });
  expect(panel.source.durationSeconds).toBeGreaterThan(0.5);
  expect(panel.analysis.pitch.medianF0Hz).toBeGreaterThan(215);
  expect(panel.analysis.pitch.medianF0Hz).toBeLessThan(225);
});

test('a double click on «Analizza» starts one session and does not stop it', async () => {
  // Long enough that the second click lands while the analysis still runs.
  const big = syntheticWav('double-click-120s-stereo.wav', 120, 48000, 2);
  expect(await choose(big)).toBe('ready');
  const ends = async (): Promise<number> => (await h.messageTypes()).filter((t) => t === 'FILE_SESSION_END').length;
  const before = await ends();
  // A person's double click: two real mouse clicks 100 ms apart on the same spot,
  // where «Interrompi» has replaced «Analizza» after the first one (review M1).
  await h.mouseClicksInSidePanel('file-analyze', 2, 100);
  await expect.poll(phase, { timeout: 60_000 }).toMatch(/^(done|failed|stopped)$/);
  expect(await phase()).toBe('done');
  // One analysis, so one end message (the probe sees every broadcast from the panel).
  await expect.poll(ends).toBe(before + 1);
});

test('an unexpected exception during decoding leaves the panel usable (review H1)', async () => {
  expect(await choose(join(FIXTURES, 'voice-a.wav'))).toBe('ready');
  // Make the copy of the decoded window throw, as an allocation failure would.
  await h.inSidePanel(`(() => {
    globalThis.vcCopy = AudioBuffer.prototype.copyFromChannel;
    AudioBuffer.prototype.copyFromChannel = function () { throw new RangeError('Array buffer allocation failed'); };
    return true;
  })()`);
  try {
    expect(await analyze()).toBe('failed');
    expect((await errorOf()).code).toBe('INTERNAL_ERROR');
    expect(await h.inSidePanel(exists('file-analyze'))).toBe(true);
    await expect.poll(() => h.storage('activeSession')).toBeUndefined();
  } finally {
    await h.inSidePanel(`(() => { AudioBuffer.prototype.copyFromChannel = globalThis.vcCopy; return true; })()`);
  }
  expect(await analyze()).toBe('done');
});

test('a failure after the session was granted releases it (non-finite samples)', async () => {
  // A float WAV holding NaN: decodable, refused by dsp-core in the worker.
  const frames = 8000;
  const bytes = new Uint8Array(44 + frames * 4);
  const v = new DataView(bytes.buffer);
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + frames * 4, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 3, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 32000, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 32, true);
  str(36, 'data');
  v.setUint32(40, frames * 4, true);
  for (let i = 0; i < frames; i++) v.setFloat32(44 + i * 4, i % 100 === 0 ? Number.NaN : 0.1, true);
  const file = join(tmp, 'nan-float.wav');
  writeFileSync(file, bytes);
  expect(await choose(file)).toBe('ready');
  const before = (await h.messageTypes()).filter((t) => t === 'FILE_SESSION_END').length;
  const end = await analyze();
  test.info().annotations.push({ type: 'float WAV with NaN', description: `${end} ${JSON.stringify(await errorOf())}` });
  expect(end).toBe('failed');
  expect(await errorOf()).toEqual({ code: 'FILE_DECODE_FAILED', reason: 'DECODE' });
  await expect.poll(async () => (await h.messageTypes()).filter((t) => t === 'FILE_SESSION_END').length).toBe(before + 1);
  await expect.poll(() => h.storage('activeSession')).toBeUndefined();
});

test('a start point past the end asks for no session', async () => {
  expect(await choose(join(FIXTURES, 'voice-a.wav'))).toBe('ready');
  const before = await h.storage('lastStart');
  await setStart(12);
  expect(await h.inSidePanel(click('file-analyze'))).toBe(true);
  await expect.poll(async () => (await errorOf()).reason).toBe('START_PAST_END');
  expect(await phase()).toBe('ready');
  expect(await h.storage('lastStart')).toEqual(before);
  await setStart(0);
});

test('the file name is shown as text, never as markup (R17)', async () => {
  const name = `a&lt;b&gt;'&amp;<i>.wav`.replace(/[<>]/g, '_');
  const file = join(tmp, name);
  copyFileSync(join(FIXTURES, 'voice-a.wav'), file);
  expect(await choose(file)).toBe('ready');
  expect(await h.inSidePanel(text('file-name'))).toBe(name);
  expect(await h.inSidePanel(`${q('file-name')}.children.length`)).toBe(0);
});

test('CAPTURE_BUSY both ways, and «Interrompi la cattura in corso» stops a file analysis', async () => {
  test.setTimeout(120_000);
  await h.grantMic();
  // A microphone session runs: the file start is refused.
  const seen = await h.seenSessions();
  const micId = await startMicFromProbe(true);
  await h.waitForSession('LISTENING', seen);
  expect(await choose(join(FIXTURES, 'voice-a.wav'))).toBe('ready');
  expect(await analyze()).toBe('failed');
  expect(await errorOf()).toMatchObject({ code: 'CAPTURE_BUSY' });
  // The panel never touched the offscreen's session.
  expect(await h.storage('activeSession')).toEqual({ sessionId: micId, source: 'mic' });
  await stopFromProbe(micId);
  await h.waitForEnd(micId);
  await expect.poll(() => h.offscreenCount()).toBe(0);

  // A long file analysis runs: the microphone is refused, then the analysis is stopped.
  const big = syntheticWav('busy-120s-stereo.wav', 120, 48000, 2);
  expect(await choose(big)).toBe('ready');
  expect(await h.inSidePanel(click('file-analyze'))).toBe(true);
  await expect.poll(() => h.storage('activeSession')).toMatchObject({ source: 'file' });
  const active = (await h.storage('activeSession')) as { sessionId: string };
  // Routing state only: no file name, no size, nothing about the content.
  expect(Object.keys(active).sort()).toEqual(['sessionId', 'source']);
  const refused = await startMicFromProbe(false);
  await expect.poll(() => h.storage('lastStart')).toMatchObject({ sessionId: refused, failure: 'CAPTURE_BUSY' });
  expect(await h.offscreenCount()).toBe(0);
  const stoppedAt = Date.now();
  await stopFromProbe(active.sessionId);
  await expect.poll(phase, { timeout: 30_000 }).toBe('stopped');
  test.info().annotations.push({ type: 'stop latency', description: `${String(Date.now() - stoppedAt)} ms` });
  await expect.poll(() => h.storage('activeSession')).toBeUndefined();
});

test('«Interrompi la cattura in corso» in the same panel stops its own file analysis (review L10)', async () => {
  test.setTimeout(120_000);
  await h.grantMic();
  // 96 kHz stereo: a heavier analysis, so it is still running when the stop arrives.
  const big = syntheticWav('same-panel-120s-96k.wav', 120, 96000, 2);
  expect(await choose(big)).toBe('ready');
  expect(await h.inSidePanel(click('file-analyze'))).toBe(true);
  await expect.poll(() => h.storage('activeSession')).toMatchObject({ source: 'file' });
  // «Usa il microfono» as the capture view sends it, from the same panel: refused.
  await h.inSidePanel(`chrome.runtime.sendMessage({ v: 1, type: 'CAPTURE_START', source: 'mic', tabId: null, sessionId: crypto.randomUUID(), seq: 100 }).catch(() => 0).then(() => true)`);
  await expect.poll(() => h.inSidePanel(exists('capture-stop-active')), { timeout: 10_000 }).toBe(true);
  const running = String(await phase());
  // The panel's own CAPTURE_STOP does not reach the panel itself: the stop
  // arrives back through the service worker's OFFSCREEN_STOP.
  const stoppedAt = Date.now();
  expect(await h.inSidePanel(click('capture-stop-active'))).toBe(true);
  await expect.poll(phase, { timeout: 10_000 }).toBe('stopped');
  test.info().annotations.push({ type: 'same-panel stop', description: `while ${running}, stopped after ${String(Date.now() - stoppedAt)} ms` });
  await expect.poll(() => h.storage('activeSession')).toBeUndefined();
});

test('Math functions: Node vs side panel, 200,000 inputs (reproducible measure, BENCHMARK_PROTOCOL §7)', async () => {
  // xorshift32 inputs over 12 orders of magnitude; per function, the doubles of
  // both engines compared bit for bit. Reported, not required equal, except
  // sqrt, which IEEE 754 requires to be correctly rounded.
  const probe = (): Record<string, string[]> => {
    let s = 0x9e3779b9 >>> 0;
    const rnd = (): number => {
      s ^= s << 13;
      s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      return s / 4294967296;
    };
    const xs: number[] = [];
    for (let i = 0; i < 200000; i++) xs.push(rnd() * Math.pow(10, Math.floor(rnd() * 12) - 6));
    const fns: Record<string, (x: number) => number> = {
      log10: Math.log10,
      log: Math.log,
      log2: Math.log2,
      sqrt: Math.sqrt,
      exp: (x) => Math.exp(x % 50),
      sin: (x) => Math.sin(x * 10),
      cos: (x) => Math.cos(x * 10),
      pow: (x) => Math.pow(x, 1.7),
      atan: Math.atan,
      sinh: (x) => Math.sinh(x % 20),
      hypot: (x) => Math.hypot(x, 1.3),
    };
    const out: Record<string, string[]> = {};
    for (const [k, f] of Object.entries(fns)) {
      const b = new Float64Array(xs.length);
      for (let i = 0; i < xs.length; i++) b[i] = f(xs[i] ?? 0);
      out[k] = Array.from(new BigInt64Array(b.buffer), (v) => v.toString());
    }
    return out;
  };
  // The same function runs in the panel (its source, as an expression) and in Node.
  const panel = (await h.inSidePanel(`(${probe.toString()})()`)) as Record<string, string[]>;
  const node = probe();
  const report: Record<string, { differing: number; maxUlp: number }> = {};
  for (const k of Object.keys(node)) {
    const a = node[k] ?? [];
    const b = panel[k] ?? [];
    let differing = 0;
    let maxUlp = 0n;
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      differing++;
      const d = BigInt(a[i] ?? '0') - BigInt(b[i] ?? '0');
      const ad = d < 0n ? -d : d;
      if (ad > maxUlp) maxUlp = ad;
    }
    report[k] = { differing, maxUlp: Number(maxUlp) };
  }
  test.info().annotations.push({ type: 'Math, differing of 200000 (max ULP)', description: JSON.stringify({ node: process.versions.v8, report }) });
  writeFileSync(join(resolve(import.meta.dirname, '../../test-results'), 'i18-math-node-vs-panel.json'), JSON.stringify({ v8: process.versions.v8, report }, null, 2));
  expect(report['sqrt']?.differing).toBe(0);
});

test('a panel closed during the analysis leaves no session behind', async () => {
  test.setTimeout(120_000);
  await h.grantMic();
  const big = syntheticWav('close-120s-stereo.wav', 120, 48000, 2);
  expect(await choose(big)).toBe('ready');
  expect(await h.inSidePanel(click('file-analyze'))).toBe(true);
  await expect.poll(phase).toMatch(/^(decoding|analyzing)$/);
  const observed = String(await phase());
  const closedAt = Date.now();
  expect(await h.closeSidePanels()).toBe(1);
  // Target.closeTarget returns before the document is gone: wait for it, as a
  // user's next click would come after the panel has disappeared.
  await expect.poll(async () => (await h.sidePanels()).length, { timeout: 10_000 }).toBe(0);
  // The routing state is orphaned: its panel document is gone.
  const orphan = await h.storage('activeSession');
  test.info().annotations.push({
    type: 'closed while',
    description: `${observed}; panel target gone after ${String(Date.now() - closedAt)} ms; record left: ${JSON.stringify(orphan !== undefined)}`,
  });
  // A new start is not refused: the orphan is recognised and cleaned.
  const seen = await h.seenSessions();
  const micId = await startMicFromProbe(true);
  // Accepted means: the session reaches LISTENING. lastStart alone proves
  // nothing: it is written with failure null before the busy check.
  const listening = await h.waitForSession('LISTENING', seen);
  expect(listening.sessionId).toBe(micId);
  expect(await h.storage('lastStart')).toMatchObject({ sessionId: micId, failure: null });
  expect(await h.storage('activeSession')).toEqual({ sessionId: micId, source: 'mic' });
  await stopFromProbe(micId);
  await h.waitForEnd(micId, 20_000);
  await expect.poll(() => h.offscreenCount()).toBe(0);
  await openPanel();
});

test('nothing of the file is stored: no name in storage, no IndexedDB', async () => {
  const name = 'privacy-check-voice-a.wav';
  const file = join(tmp, name);
  copyFileSync(join(FIXTURES, 'voice-a.wav'), file);
  expect(await choose(file)).toBe('ready');
  expect(await analyze()).toBe('done');
  const stored = await h.probe.evaluate(async () => ({
    session: await chrome.storage.session.get(null),
    local: await chrome.storage.local.get(null),
    databases: (await indexedDB.databases()).map((d) => d.name ?? ''),
  }));
  const panelDatabases = await h.inSidePanel(`indexedDB.databases().then((d) => JSON.stringify(d.map((x) => x.name)))`);
  test.info().annotations.push({ type: 'storage after analysis', description: JSON.stringify({ ...stored, panelDatabases }) });
  expect(JSON.stringify(stored)).not.toContain('privacy-check');
  expect(stored.local).toEqual({});
  expect(stored.databases).toEqual([]);
  expect(panelDatabases).toBe('[]');
  expect(Object.keys(stored.session).sort()).toEqual(['lastStart']);
  // Not a proof that the worker was terminated: dedicated workers are not
  // top-level CDP targets (0 also during an analysis, see README).
});

test('memory: after a 120 s stereo analysis and a GC, the panel is back near its baseline', async () => {
  test.setTimeout(120_000);
  const usage = (): Promise<Record<string, number>> =>
    h.withSidePanel(async (send) => {
      await send('HeapProfiler.collectGarbage', {});
      return (await send('Runtime.getHeapUsage', {})) as Record<string, number>;
    });
  const big = syntheticWav('memory-120s-stereo.wav', 120, 48000, 2);
  const before = await usage();
  expect(await choose(big)).toBe('ready');
  expect(await analyze(60_000)).toBe('done');
  const after = await usage();
  // Twice, a few seconds apart: what is still referenced stays, garbage goes.
  await new Promise((r) => setTimeout(r, 2000));
  const later = await usage();
  test.info().annotations.push({ type: 'panel heap (bytes)', description: JSON.stringify({ before, after, later }) });
  const MB = 1024 * 1024;
  const grew = (key: string): number => ((later[key] ?? 0) - (before[key] ?? 0)) / MB;
  test.info().annotations.push({ type: 'growth (MB)', description: JSON.stringify({ usedSize: grew('usedSize'), backingStorageSize: grew('backingStorageSize') }) });
  // The window alone is 46 MB as float32 (2 × 120 s × 48 kHz × 4 B); kept
  // references would show as tens of MB. Test tolerance, not a product threshold.
  expect(grew('usedSize')).toBeLessThan(8);
  expect(grew('backingStorageSize')).toBeLessThan(8);

  // Counter-check: the same metric does see a retained window-sized buffer.
  await h.inSidePanel(`(() => { globalThis.vcLeak = new Float32Array(2 * 120 * 48000).fill(0.5); return true; })()`);
  const leaked = await usage();
  await h.inSidePanel(`(() => { delete globalThis.vcLeak; return true; })()`);
  const leakMb = ((leaked['backingStorageSize'] ?? 0) - (later['backingStorageSize'] ?? 0)) / MB;
  test.info().annotations.push({ type: 'counter-check, retained 46 MB buffer (MB)', description: String(leakMb) });
  expect(leakMb).toBeGreaterThan(40);
});
