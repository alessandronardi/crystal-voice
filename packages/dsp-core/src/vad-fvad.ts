// WebRTC VAD (libfvad) behind `VadEngine` (I-05b, SPEC §7.2, decision D-L).
//
// libfvad is compiled by the project to a standalone WASM module
// (scripts/vad/build-fvad.sh; committed as packages/dsp-core/wasm/fvad.wasm).
// This file stays pure (R10): it never loads or compiles WASM. The caller
// instantiates the module (Node: from the file; the dsp-worker: from the
// bundle, I-06) and passes its exports. libfvad is fixed-point C, so its
// decisions do not depend on the JS engine's Math (VC-24).
//
// libfvad gives a binary decision: probability stays null (SPEC §7.2).

import { ANALYSIS_SAMPLE_RATE, FVAD_MODE, VAD_FRAME_SAMPLES, type FvadMode } from './config.ts';
import { DspInputError } from './errors.ts';
import type { VadEngine } from './vad.ts';

export const WEBRTC_VAD_ID = 'webrtc-fvad-0';

/** The exports of fvad.wasm this engine uses (see EXPORTED_FUNCTIONS in build-fvad.sh). */
export interface FvadExports {
  readonly memory: { readonly buffer: ArrayBuffer };
  /** Present on reactor modules built with --no-entry: runs static constructors once. */
  readonly _initialize?: () => void;
  fvad_new(): number;
  fvad_free(inst: number): void;
  fvad_reset(inst: number): void;
  fvad_set_mode(inst: number, mode: number): number;
  fvad_set_sample_rate(inst: number, rate: number): number;
  fvad_process(inst: number, frame: number, length: number): number;
  malloc(size: number): number;
  free(ptr: number): void;
}

const FUNCTIONS = [
  'fvad_new',
  'fvad_free',
  'fvad_reset',
  'fvad_set_mode',
  'fvad_set_sample_rate',
  'fvad_process',
  'malloc',
  'free',
] as const;

/**
 * Every import fvad.wasm may declare, as "module.name". A loader must refuse a
 * module that imports anything else. Read from the built module's import
 * section (WebAssembly.Module.imports) on 2026-11-12, checked by test: three
 * WASI stdio calls that Emscripten's libc links in (stdout/stderr flushing).
 */
export const FVAD_IMPORTS: readonly string[] = [
  'wasi_snapshot_preview1.fd_close',
  'wasi_snapshot_preview1.fd_seek',
  'wasi_snapshot_preview1.fd_write',
];

/**
 * The import object for fvad.wasm. libfvad never prints in normal operation;
 * any stdio call means something went wrong inside the module (for example an
 * assertion message), so every stub throws: fail closed, no I/O (R1, R2).
 */
export function fvadImportObject(): Record<string, Record<string, () => never>> {
  const refuse = (name: string) => (): never => {
    throw new FvadError('UNEXPECTED_IMPORT_CALL', `fvad.wasm called ${name}`);
  };
  return {
    wasi_snapshot_preview1: {
      fd_close: refuse('fd_close'),
      fd_seek: refuse('fd_seek'),
      fd_write: refuse('fd_write'),
    },
  };
}

export class FvadError extends Error {
  override readonly name = 'FvadError';
  readonly code: 'BAD_EXPORTS' | 'ALLOC_FAILED' | 'BAD_MODE' | 'PROCESS_FAILED' | 'DISPOSED' | 'UNEXPECTED_IMPORT_CALL';
  constructor(code: FvadError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

/** Checks, at run time, that an untyped exports object has the shape libfvad needs. */
export function asFvadExports(exports: Readonly<Record<string, unknown>>): FvadExports {
  for (const name of FUNCTIONS) {
    if (typeof exports[name] !== 'function') throw new FvadError('BAD_EXPORTS', `fvad.wasm does not export ${name}`);
  }
  const memory = exports['memory'];
  if (typeof memory !== 'object' || memory === null || !((memory as { buffer?: unknown }).buffer instanceof ArrayBuffer)) {
    throw new FvadError('BAD_EXPORTS', 'fvad.wasm does not export its memory');
  }
  const init = exports['_initialize'];
  if (init !== undefined && typeof init !== 'function') throw new FvadError('BAD_EXPORTS', '_initialize is not a function');
  return exports as unknown as FvadExports;
}

/**
 * Float PCM → int16 for libfvad: round(x · 32768), clamped to the int16 range.
 * Math.round rounds halves towards +∞; that is the documented rule (I-05b).
 * Non-finite samples are an input error, never silently 0 (R13).
 */
export function toInt16(x: number): number {
  if (!Number.isFinite(x)) throw new DspInputError('NON_FINITE_INPUT', 'non-finite PCM sample');
  const n = Math.round(x * 32768);
  return n > 32767 ? 32767 : n < -32768 ? -32768 : n === 0 ? 0 : n;
}

export interface WebRtcVad extends VadEngine {
  readonly mode: FvadMode;
  /** Frees the libfvad instance and its frame buffer. The engine is unusable afterwards. */
  dispose(): void;
}

/**
 * One libfvad instance on an instantiated fvad.wasm. Several engines may share
 * the same exports: each owns its instance and frame buffer. The caller runs
 * `_initialize` once, right after instantiation (no module-level state here).
 */
export function createWebRtcVad(exports: FvadExports, mode: FvadMode = FVAD_MODE): WebRtcVad {
  const inst = exports.fvad_new();
  if (inst === 0) throw new FvadError('ALLOC_FAILED', 'fvad_new returned NULL');
  const buf = exports.malloc(VAD_FRAME_SAMPLES * 2);
  if (buf === 0) {
    exports.fvad_free(inst);
    throw new FvadError('ALLOC_FAILED', 'malloc returned NULL');
  }
  const configure = (): void => {
    if (exports.fvad_set_mode(inst, mode) !== 0) throw new FvadError('BAD_MODE', `fvad mode ${mode} rejected`);
    if (exports.fvad_set_sample_rate(inst, ANALYSIS_SAMPLE_RATE) !== 0) {
      throw new FvadError('BAD_MODE', `fvad rejected ${ANALYSIS_SAMPLE_RATE} Hz`);
    }
  };
  try {
    configure();
  } catch (error) {
    exports.free(buf);
    exports.fvad_free(inst);
    throw error;
  }
  let disposed = false;
  const alive = (): void => {
    if (disposed) throw new FvadError('DISPOSED', 'the WebRTC VAD was disposed');
  };
  return {
    id: WEBRTC_VAD_ID,
    primary: true,
    mode,
    sampleRate: ANALYSIS_SAMPLE_RATE,
    frameSamples: VAD_FRAME_SAMPLES,
    process(frame) {
      alive();
      if (frame.length !== VAD_FRAME_SAMPLES) {
        throw new DspInputError('BAD_FRAME', `VAD frame must have ${VAD_FRAME_SAMPLES} samples`);
      }
      // Convert first, so a bad sample leaves the engine state untouched.
      const pcm = new Int16Array(VAD_FRAME_SAMPLES);
      for (let i = 0; i < VAD_FRAME_SAMPLES; i++) pcm[i] = toInt16(frame[i] as number);
      // The memory cannot grow (ALLOW_MEMORY_GROWTH=0), but a fresh view costs nothing.
      new Int16Array(exports.memory.buffer, buf, VAD_FRAME_SAMPLES).set(pcm);
      const r = exports.fvad_process(inst, buf, VAD_FRAME_SAMPLES);
      if (r !== 0 && r !== 1) throw new FvadError('PROCESS_FAILED', `fvad_process returned ${r}`);
      return { speech: r === 1, probability: null };
    },
    reset() {
      alive();
      // fvad_reset restores the defaults (mode 0, 8 kHz): configure again.
      exports.fvad_reset(inst);
      configure();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      exports.free(buf);
      exports.fvad_free(inst);
    },
  };
}
