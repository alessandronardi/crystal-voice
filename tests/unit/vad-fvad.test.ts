// WebRTC VAD (libfvad WASM) behind VadEngine (I-05b). Uses the committed
// packages/dsp-core/wasm/fvad.wasm, checked against its SHA-256 file.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createWebRtcVad,
  DspInputError,
  FVAD_IMPORTS,
  FVAD_MODE,
  FVAD_WASM_SHA256,
  FvadError,
  fvadImportObject,
  mixToMono,
  resample,
  toInt16,
  VAD_FRAME_SAMPLES,
  WEBRTC_VAD_ID,
  asFvadExports,
  instantiateFvad,
} from '@voicecrystal/dsp-core';
import { synthVoice } from '../../scripts/fixtures/synth/voice.ts';
import { VOICE_A } from '../../scripts/fixtures/catalog.ts';
import { importNames, loadFvad, readFvadBytes } from '../benchmarks/fvad-loader.ts';

const fvad = loadFvad();

function framesOf(pcm16k: Float32Array): Float32Array[] {
  const n = Math.floor(pcm16k.length / VAD_FRAME_SAMPLES);
  return Array.from({ length: n }, (_, k) => pcm16k.subarray(k * VAD_FRAME_SAMPLES, (k + 1) * VAD_FRAME_SAMPLES));
}

const voice16k = (() => {
  const { signal } = synthVoice(VOICE_A, 6, 48000, 7);
  return resample(mixToMono([Float32Array.from(signal)], 48000).pcm, 48000, 16000);
})();

describe('fvad.wasm', () => {
  it('matches its committed SHA-256, and the constant the extension checks (I-06b)', () => {
    expect(readFvadBytes().sha256).toBe(fvad.sha256);
    expect(FVAD_WASM_SHA256).toBe(fvad.sha256);
  });

  it('imports only the declared WASI stubs and exports what the engine needs', () => {
    expect(importNames(fvad.module)).toEqual([...FVAD_IMPORTS].sort());
    const exports = WebAssembly.Module.exports(fvad.module).map((e) => e.name);
    for (const name of ['memory', 'fvad_new', 'fvad_free', 'fvad_reset', 'fvad_set_mode', 'fvad_set_sample_rate', 'fvad_process', 'malloc', 'free']) {
      expect(exports).toContain(name);
    }
  });

  it('every stub throws: no stdio reaches the host', () => {
    for (const fn of Object.values(fvadImportObject()['wasi_snapshot_preview1'] ?? {})) {
      expect(() => fn()).toThrow(FvadError);
    }
  });

  it('instantiateFvad refuses a module with an undeclared import (review M-2)', () => {
    // Minimal module: one type () -> (), one import env.foo of that type.
    const bytes = Uint8Array.from([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x04, 0x01, 0x60, 0x00, 0x00, 0x02, 0x0b, 0x01, 0x03, 0x65, 0x6e,
      0x76, 0x03, 0x66, 0x6f, 0x6f, 0x00, 0x00,
    ]);
    expect(WebAssembly.Module.imports(new WebAssembly.Module(bytes))).toEqual([{ module: 'env', name: 'foo', kind: 'function' }]);
    expect(() => instantiateFvad(WebAssembly, bytes)).toThrow(expect.objectContaining({ code: 'BAD_IMPORTS' }));
  });

  it('an error inside the module marks it broken for every engine on it (review L-4)', () => {
    let fail = false;
    const fake = asFvadExports({
      memory: { buffer: new ArrayBuffer(65536) },
      fvad_new: () => 8,
      fvad_free: () => 0,
      fvad_reset: () => 0,
      fvad_set_mode: () => 0,
      fvad_set_sample_rate: () => 0,
      fvad_process: () => {
        if (fail) throw new Error('unreachable executed');
        return 0;
      },
      malloc: () => 1024,
      free: () => 0,
    });
    const module = { exports: fake, broken: false };
    const a = createWebRtcVad(module, 2);
    const b = createWebRtcVad(module, 2);
    expect(a.process(new Float32Array(VAD_FRAME_SAMPLES)).speech).toBe(false);
    fail = true;
    expect(() => a.process(new Float32Array(VAD_FRAME_SAMPLES))).toThrow(expect.objectContaining({ code: 'PROCESS_FAILED' }));
    expect(module.broken).toBe(true);
    fail = false;
    expect(() => b.process(new Float32Array(VAD_FRAME_SAMPLES))).toThrow(expect.objectContaining({ code: 'MODULE_BROKEN' }));
    expect(() => createWebRtcVad(module, 2)).toThrow(expect.objectContaining({ code: 'MODULE_BROKEN' }));
  });

  it('asFvadExports refuses an object without the functions or the memory', () => {
    expect(() => asFvadExports({})).toThrow(FvadError);
    const fns = Object.fromEntries(
      ['fvad_new', 'fvad_free', 'fvad_reset', 'fvad_set_mode', 'fvad_set_sample_rate', 'fvad_process', 'malloc', 'free'].map((n) => [n, () => 0]),
    );
    expect(() => asFvadExports(fns)).toThrow(FvadError);
  });
});

describe('toInt16', () => {
  it('rounds x·32768 and clamps; −0 becomes 0', () => {
    expect(toInt16(-1)).toBe(-32768);
    expect(toInt16(1)).toBe(32767);
    expect(toInt16(32767 / 32768)).toBe(32767);
    expect(toInt16(-2)).toBe(-32768);
    expect(Object.is(toInt16(-0), 0)).toBe(true);
    expect(toInt16(0.5 / 32768)).toBe(1); // halves round towards +∞ (Math.round)
    expect(toInt16(-0.5 / 32768)).toBe(0);
  });

  it('refuses non-finite samples (R13)', () => {
    expect(() => toInt16(Number.NaN)).toThrow(DspInputError);
    expect(() => toInt16(Number.POSITIVE_INFINITY)).toThrow(DspInputError);
  });
});

describe('createWebRtcVad', () => {
  it('is a primary, binary engine at 16 kHz and 20 ms with the default mode', () => {
    const v = createWebRtcVad(fvad.fvad);
    expect(v.id).toBe(WEBRTC_VAD_ID);
    expect(v.primary).toBe(true);
    expect(v.mode).toBe(FVAD_MODE);
    expect(v.sampleRate).toBe(16000);
    expect(v.frameSamples).toBe(320);
    expect(v.process(new Float32Array(VAD_FRAME_SAMPLES))).toEqual({ speech: false, probability: null });
    v.dispose();
  });

  it('never calls silence speech, in any mode', () => {
    for (const mode of [0, 1, 2, 3] as const) {
      const v = createWebRtcVad(fvad.fvad, mode);
      for (let i = 0; i < 100; i++) expect(v.process(new Float32Array(VAD_FRAME_SAMPLES)).speech).toBe(false);
      v.dispose();
    }
  });

  it('calls most of a synthetic voice speech', () => {
    const v = createWebRtcVad(fvad.fvad, 0);
    const decisions = framesOf(voice16k).map((f) => v.process(f).speech);
    v.dispose();
    expect(decisions.filter(Boolean).length / decisions.length).toBeGreaterThan(0.5);
  });

  it('is deterministic: two engines, and the same engine after reset, give the same decisions', () => {
    const frames = framesOf(voice16k);
    const a = createWebRtcVad(fvad.fvad, 3);
    const b = createWebRtcVad(fvad.fvad, 3);
    const first = frames.map((f) => a.process(f).speech);
    expect(frames.map((f) => b.process(f).speech)).toEqual(first);
    a.reset();
    expect(frames.map((f) => a.process(f).speech)).toEqual(first);
    a.dispose();
    b.dispose();
  });

  it('engines on the same module do not share state', () => {
    const frames = framesOf(voice16k);
    const alone = createWebRtcVad(fvad.fvad, 1);
    const expected = frames.map((f) => alone.process(f).speech);
    alone.dispose();
    const x = createWebRtcVad(fvad.fvad, 1);
    const y = createWebRtcVad(fvad.fvad, 1);
    const got: boolean[] = [];
    for (const f of frames) {
      got.push(x.process(f).speech);
      y.process(new Float32Array(VAD_FRAME_SAMPLES).fill(0.3));
    }
    expect(got).toEqual(expected);
    x.dispose();
    y.dispose();
  });

  it('a bad frame throws a typed error and leaves the state as it was', () => {
    const frames = framesOf(voice16k).slice(0, 50);
    const ref = createWebRtcVad(fvad.fvad, 2);
    const expected = frames.map((f) => ref.process(f).speech);
    ref.dispose();
    const v = createWebRtcVad(fvad.fvad, 2);
    const got: boolean[] = [];
    frames.forEach((f, i) => {
      if (i === 20) {
        expect(() => v.process(new Float32Array(10))).toThrow(DspInputError);
        const bad = Float32Array.from(f);
        bad[100] = Number.NaN;
        expect(() => v.process(bad)).toThrow(DspInputError);
      }
      got.push(v.process(f).speech);
    });
    expect(got).toEqual(expected);
    v.dispose();
  });

  it('refuses work after dispose; dispose twice is harmless', () => {
    const v = createWebRtcVad(fvad.fvad);
    v.dispose();
    v.dispose();
    expect(() => v.process(new Float32Array(VAD_FRAME_SAMPLES))).toThrow(FvadError);
    expect(() => {
      v.reset();
    }).toThrow(FvadError);
  });

  it('rejects an invalid mode', () => {
    expect(() => createWebRtcVad(fvad.fvad, 7 as never)).toThrow(FvadError);
  });

  it('any finite frame gives a boolean, in every mode (property)', () => {
    const engines = ([0, 1, 2, 3] as const).map((m) => createWebRtcVad(fvad.fvad, m));
    fc.assert(
      fc.property(fc.float32Array({ minLength: VAD_FRAME_SAMPLES, maxLength: VAD_FRAME_SAMPLES, noNaN: true, noDefaultInfinity: true }), (frame) => {
        for (const e of engines) {
          const r = e.process(frame);
          if (typeof r.speech !== 'boolean' || r.probability !== null) return false;
        }
        return true;
      }),
      { numRuns: 300 },
    );
    for (const e of engines) e.dispose();
  });

  it('a thousand create/dispose cycles do not exhaust the fixed memory', () => {
    for (let i = 0; i < 1000; i++) createWebRtcVad(fvad.fvad).dispose();
  });
});
