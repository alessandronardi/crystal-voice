// Probing and decoding of a local file in the side panel (SPEC §5 point 7,
// §9 «File locali [H]», I-18, ADR-0022). Browser-only: File, Blob,
// OfflineAudioContext, <audio>. The limits are in file-limits.ts and the WAV
// layout in wav-header.ts, both pure and tested in Node.
//
// - WAV: the header gives rate, channels and duration; only the chosen window
//   is read (File.slice) and decoded, in an OfflineAudioContext at the file's
//   own rate, so decodeAudioData does not resample. The analysis rate is
//   reached by dsp-core's resampler, as in the offline harness. A WAV whose
//   rate that resampler cannot convert takes the whole-file path below.
// - Anything else: the duration comes from an <audio> element's metadata; the
//   whole file is read and decoded at WHOLE_DECODE_SAMPLE_RATE (the browser
//   resamples), then the window is copied out.
// The file's bytes and samples live only in local variables of one analysis.
// Between analyses the probe keeps the layout and a copy of the "fmt " chunk,
// never the leading bytes of the file (AGENTS.md R1, review L1).
import { ANALYSIS_SAMPLE_RATE, createResampler } from '@voicecrystal/dsp-core';
import {
  WHOLE_DECODE_SAMPLE_RATE,
  checkDecoded,
  planWav,
  planWhole,
  windowFrames,
  windowSeconds,
  type FileRefusal,
  type FrameWindow,
} from './file-limits.ts';
import { WAV_HEAD_BYTES, fmtChunk, parseWavHeader, windowByteRange, windowWavHeader, type WavLayout } from './wav-header.ts';

/** [H] Time allowed to an <audio> element to read a file's metadata. */
const METADATA_TIMEOUT_MS = 10_000;

export type DecodeRefusal = FileRefusal | { code: 'FILE_DECODE_FAILED'; reason: 'DECODE' };

export type FileProbe =
  | { ok: true; kind: 'wav'; layout: WavLayout; fmt: Uint8Array; durationSeconds: number }
  | { ok: true; kind: 'whole'; durationSeconds: number }
  | ({ ok: false } & DecodeRefusal);

export interface DecodedWindow {
  sampleRate: number;
  channels: Float32Array[];
  window: FrameWindow;
  /** Total duration of the file, seconds. */
  durationSeconds: number;
  offsetStartSeconds: number;
  offsetEndSeconds: number;
  /** Whether decodeAudioData resampled (whole-file path), or the file's own rate was kept. */
  path: 'wav-window' | 'whole';
}

export type DecodeOutcome = { ok: true; decoded: DecodedWindow } | ({ ok: false } & DecodeRefusal);

/** Duration from an <audio> element's metadata; NaN when it cannot be read. */
function mediaDuration(file: File): Promise<number> {
  const url = URL.createObjectURL(file);
  const audio = document.createElement('audio');
  audio.preload = 'metadata';
  audio.muted = true;
  return new Promise((resolve) => {
    let settled = false;
    const done = (duration: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    const timer = setTimeout(() => {
      done(Number.NaN);
    }, METADATA_TIMEOUT_MS);
    audio.addEventListener('loadedmetadata', () => {
      done(audio.duration);
    });
    audio.addEventListener('error', () => {
      done(Number.NaN);
    });
    audio.src = url;
  });
}

/** Whether dsp-core's resampler converts this rate to the analysis rate (it refuses some, review L4). */
function resamplable(sampleRate: number): boolean {
  try {
    createResampler(sampleRate, ANALYSIS_SAMPLE_RATE);
    return true;
  } catch {
    return false;
  }
}

export async function probeFile(file: File): Promise<FileProbe> {
  let head: Uint8Array;
  try {
    head = new Uint8Array(await file.slice(0, WAV_HEAD_BYTES).arrayBuffer());
  } catch {
    return { ok: false, code: 'FILE_DECODE_FAILED', reason: 'DECODE' };
  }
  const layout = parseWavHeader(head, file.size);
  if (layout !== null && resamplable(layout.sampleRate)) {
    return { ok: true, kind: 'wav', layout, fmt: fmtChunk(head, layout), durationSeconds: layout.durationSeconds };
  }
  const durationSeconds = await mediaDuration(file);
  // The duration check proper is in planWhole; here only «unreadable».
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    return { ok: false, code: 'FILE_DECODE_FAILED', reason: 'NO_DURATION' };
  }
  return { ok: true, kind: 'whole', durationSeconds };
}

/** Plans the decoding without doing it: the refusal the user would get, or null. */
export function checkProbe(probe: FileProbe & { ok: true }, fileBytes: number, startSeconds: number): DecodeRefusal | null {
  const plan = probe.kind === 'wav' ? planWav(probe.layout, startSeconds) : planWhole(probe.durationSeconds, fileBytes);
  return plan.ok ? null : plan;
}

async function decode(bytes: ArrayBuffer, sampleRate: number): Promise<AudioBuffer | null> {
  try {
    const context = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate });
    return await context.decodeAudioData(bytes);
  } catch {
    return null;
  }
}

/** Copies a window out of a decoded buffer, one new array per channel. */
function copyWindow(buffer: AudioBuffer, window: FrameWindow): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, c) => {
    const out = new Float32Array(window.frameCount);
    buffer.copyFromChannel(out, c, window.startFrame);
    return out;
  });
}

const FAILED = { ok: false, code: 'FILE_DECODE_FAILED', reason: 'DECODE' } as const;

async function decodeWavWindow(file: File, probe: Extract<FileProbe, { kind: 'wav' }>, startSeconds: number): Promise<DecodeOutcome> {
  const plan = planWav(probe.layout, startSeconds);
  if (!plan.ok) return plan;
  const range = windowByteRange(probe.layout, plan.window.startFrame, plan.window.frameCount);
  const header = windowWavHeader(probe.fmt, range.end - range.start);
  let bytes: ArrayBuffer;
  try {
    bytes = await new Blob([header as Uint8Array<ArrayBuffer>, file.slice(range.start, range.end)]).arrayBuffer();
  } catch {
    return FAILED;
  }
  const buffer = await decode(bytes, probe.layout.sampleRate);
  // At the file's own rate nothing is resampled: the decoded length is the window's.
  if (buffer === null || buffer.sampleRate !== probe.layout.sampleRate || buffer.length === 0) return FAILED;
  const window: FrameWindow = { startFrame: 0, frameCount: buffer.length };
  const refusal = checkDecoded({ length: buffer.length, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels }, window);
  if (refusal !== null && refusal.reason !== 'DURATION') return { ok: false, ...refusal };
  const reported: FrameWindow = { startFrame: plan.window.startFrame, frameCount: buffer.length };
  return {
    ok: true,
    decoded: {
      sampleRate: buffer.sampleRate,
      channels: copyWindow(buffer, window),
      window: reported,
      durationSeconds: probe.durationSeconds,
      ...windowSeconds(reported, buffer.sampleRate),
      path: 'wav-window',
    },
  };
}

async function decodeWhole(file: File, probe: Extract<FileProbe, { kind: 'whole' }>, startSeconds: number): Promise<DecodeOutcome> {
  const plan = planWhole(probe.durationSeconds, file.size);
  if (!plan.ok) return plan;
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    return FAILED;
  }
  const buffer = await decode(bytes, WHOLE_DECODE_SAMPLE_RATE);
  if (buffer === null) return FAILED;
  const window = windowFrames(buffer.length, buffer.sampleRate, startSeconds);
  if (window === null) return { ok: false, code: 'FILE_DECODE_FAILED', reason: 'EMPTY' };
  // The estimate trusted the metadata and assumed two channels: the decoded
  // buffer is the truth, checked before the window is copied (review H2).
  const refusal = checkDecoded({ length: buffer.length, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels }, window);
  if (refusal !== null) return { ok: false, ...refusal };
  return {
    ok: true,
    decoded: {
      sampleRate: buffer.sampleRate,
      channels: copyWindow(buffer, window),
      window,
      durationSeconds: buffer.length / buffer.sampleRate,
      ...windowSeconds(window, buffer.sampleRate),
      path: 'whole',
    },
  };
}

export function decodeFileWindow(file: File, probe: FileProbe & { ok: true }, startSeconds: number): Promise<DecodeOutcome> {
  return probe.kind === 'wav' ? decodeWavWindow(file, probe, startSeconds) : decodeWhole(file, probe, startSeconds);
}
