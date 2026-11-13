// WebRTC VAD (libfvad) behind `VadEngine` (I-05b, SPEC §7.2, decision D-L).
//
// libfvad is compiled by the project to a standalone WASM module
// (scripts/vad/build-fvad.sh; committed as packages/dsp-core/wasm/fvad.wasm).
// This file stays pure (R10): it never reads files or the network. The caller
// reads the bytes (Node: from the file; the dsp-worker: from the bundle, I-06),
// checks their hash and passes them, with the global `WebAssembly`, to
// `instantiateFvad`. libfvad is fixed-point C, so its decisions do not depend
// on the JS engine's Math (VC-24); the resampler upstream does.
//
// libfvad gives a binary decision: probability stays null (SPEC §7.2).

import { ANALYSIS_SAMPLE_RATE, FVAD_MODE, VAD_FRAME_SAMPLES, type FvadMode } from './config.ts';
import { DspInputError } from './errors.ts';
import type { VadEngine } from './vad.ts';

export const WEBRTC_VAD_ID = 'webrtc-fvad-0';

/**
 * SHA-256 of the committed fvad.wasm (packages/dsp-core/wasm/fvad.wasm.sha256,
 * checked by tests/unit/vad-fvad.test.ts). A loader outside Node (the
 * extension's dsp-worker, I-06b) checks the fetched bytes against it before
 * instantiateFvad.
 */
export const FVAD_WASM_SHA256 = '8af911182fc3db2dd5bcc142c3c5c318ec2309abd5e74a4714f74074e9950597';

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
  readonly code:
    | 'BAD_IMPORTS'
    | 'BAD_EXPORTS'
    | 'ALLOC_FAILED'
    | 'BAD_MODE'
    | 'PROCESS_FAILED'
    | 'MODULE_BROKEN'
    | 'DISPOSED'
    | 'UNEXPECTED_IMPORT_CALL';
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

/** An import declared by a WASM module (shape of WebAssembly.Module.imports). */
export interface WasmImportDescriptor {
  readonly module: string;
  readonly name: string;
}

/**
 * The part of the JS `WebAssembly` namespace used here. The caller passes the
 * global `WebAssembly` (an ECMAScript-embedding API, not DOM or chrome.*): dsp-core
 * stays without DOM types and without I/O (R10).
 */
export interface WasmRuntime<M> {
  readonly Module: {
    new (bytes: Uint8Array<ArrayBuffer>): M;
    imports(module: M): readonly WasmImportDescriptor[];
  };
  readonly Instance: new (module: M, imports: Record<string, Record<string, () => never>>) => { readonly exports: object };
}

/** An instantiated fvad.wasm. Every engine on it is refused once it is broken. */
export interface FvadModule {
  readonly exports: FvadExports;
  /** True after an error inside the module: its memory may be inconsistent. */
  readonly broken: boolean;
}

interface MutableFvadModule extends FvadModule {
  broken: boolean;
}

/**
 * The only way to obtain an FvadModule (Node bench, tests, and the dsp-worker
 * in I-06). Fail closed:
 *  - the module may import nothing beyond FVAD_IMPORTS;
 *  - every import is a stub that throws;
 *  - the exports are checked; `_initialize` runs once.
 * The caller checks the bytes against fvad.wasm.sha256 before calling this.
 */
export function instantiateFvad<M>(wasm: WasmRuntime<M>, bytes: Uint8Array<ArrayBuffer>): FvadModule {
  const module = new wasm.Module(bytes);
  const unexpected = wasm.Module.imports(module)
    .map((i) => `${i.module}.${i.name}`)
    .filter((n) => !FVAD_IMPORTS.includes(n));
  if (unexpected.length > 0) throw new FvadError('BAD_IMPORTS', `fvad.wasm imports ${unexpected.join(', ')}`);
  const instance = new wasm.Instance(module, fvadImportObject());
  const exports = asFvadExports(instance.exports as Readonly<Record<string, unknown>>);
  exports._initialize?.();
  const handle: MutableFvadModule = { exports, broken: false };
  return handle;
}

export interface WebRtcVad extends VadEngine {
  readonly mode: FvadMode;
  /** Frees the libfvad instance and its frame buffer. The engine is unusable afterwards. */
  dispose(): void;
}

/**
 * One libfvad instance on an instantiated fvad.wasm. Several engines may share
 * the same module: each owns its libfvad instance and frame buffer. An error
 * inside the module (a trap, or a stub that throws) marks the whole module
 * broken: every engine on it then refuses to work.
 */
export function createWebRtcVad(fvad: FvadModule, mode: FvadMode = FVAD_MODE): WebRtcVad {
  const handle = fvad as MutableFvadModule;
  const exports = fvad.exports;
  const guarded = <T>(what: string, run: () => T): T => {
    if (handle.broken) throw new FvadError('MODULE_BROKEN', 'fvad.wasm failed earlier: create a new module');
    try {
      return run();
    } catch (error) {
      if (error instanceof FvadError && error.code !== 'UNEXPECTED_IMPORT_CALL') throw error;
      handle.broken = true;
      throw new FvadError('PROCESS_FAILED', `${what} failed inside fvad.wasm: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  return guarded('create', () => createEngine(exports, mode, guarded));
}

function createEngine(exports: FvadExports, mode: FvadMode, guarded: <T>(what: string, run: () => T) => T): WebRtcVad {
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
      return guarded('fvad_process', () => {
        // The memory cannot grow (ALLOW_MEMORY_GROWTH=0), but a fresh view costs nothing.
        new Int16Array(exports.memory.buffer, buf, VAD_FRAME_SAMPLES).set(pcm);
        const r = exports.fvad_process(inst, buf, VAD_FRAME_SAMPLES);
        if (r !== 0 && r !== 1) throw new Error(`fvad_process returned ${r}`);
        return { speech: r === 1, probability: null };
      });
    },
    reset() {
      alive();
      guarded('fvad_reset', () => {
        // fvad_reset restores the defaults (mode 0, 8 kHz): configure again.
        exports.fvad_reset(inst);
        configure();
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      guarded('dispose', () => {
        exports.free(buf);
        exports.fvad_free(inst);
      });
    },
  };
}
