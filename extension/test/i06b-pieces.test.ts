// I-06b, pure pieces tested in Node: the accumulator (blocks = whole buffer),
// the checked fvad loader, the worker protocol guards, the pinned files of the
// bundle guard, and the shared descriptor analysis.
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { seedFromRaw } from '@voicecrystal/calibration';
import { createWebRtcVad, extractDescriptors, FVAD_WASM_SHA256 } from '@voicecrystal/dsp-core';
import { checkUnscannedFile, missingPinnedFiles, type PinnedFile } from '../scripts/bundle-guard.ts';
import { analyzeDescriptors } from '../src/shared/descriptor-analysis.ts';
import { isDspWorkerReply, isPcmBlock, isStreamBeginRequest, isStreamEndRequest } from '../src/shared/dsp-protocol.ts';
import { FvadLoadError, instantiateCheckedFvad } from '../src/shared/fvad-loader.ts';
import { PcmAccumulator } from '../src/shared/pcm-accumulator.ts';
import { isWorkletCommand } from '../src/offscreen/pcm-protocol.ts';
import { synthVoice } from '../../scripts/fixtures/synth/voice.ts';
import { VOICE_A } from '../../scripts/fixtures/catalog.ts';
import { loadFvad } from '../../tests/benchmarks/fvad-loader.ts';

const WASM = readFileSync(resolve(import.meta.dirname, '../../packages/dsp-core/wasm/fvad.wasm'));
const asBuffer = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

describe('PcmAccumulator', () => {
  it('concatenated blocks equal the whole buffer, bit for bit (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ noNaN: true, noDefaultInfinity: true, min: -1, max: 1 }), { minLength: 1, maxLength: 3000 }),
        fc.array(fc.integer({ min: 1, max: 700 }), { minLength: 1, maxLength: 40 }),
        (samples, cuts) => {
          const left = Float32Array.from(samples);
          const right = left.map((v) => -v);
          const acc = new PcmAccumulator(10_000);
          let at = 0;
          for (let i = 0; at < left.length; i++) {
            const n = Math.min(cuts[i % cuts.length] ?? 1, left.length - at);
            expect(acc.push([left.slice(at, at + n), right.slice(at, at + n)])).toBe(true);
            at += n;
          }
          const [l, r] = acc.take();
          return acc.droppedFrames === 0 && Buffer.compare(Buffer.from(l?.buffer ?? new ArrayBuffer(0)), Buffer.from(left.buffer)) === 0 &&
            Buffer.compare(Buffer.from(r?.buffer ?? new ArrayBuffer(0)), Buffer.from(right.buffer)) === 0;
        },
      ),
    );
  });

  it('refuses and counts blocks over the cap or with another channel count', () => {
    const acc = new PcmAccumulator(1000);
    expect(acc.push([new Float32Array(600)])).toBe(true);
    expect(acc.push([new Float32Array(500)])).toBe(false); // over the cap: whole block refused
    expect(acc.push([new Float32Array(100), new Float32Array(100)])).toBe(false); // 2 channels after 1
    expect(acc.push([new Float32Array(400)])).toBe(true);
    expect(acc.frames).toBe(1000);
    expect(acc.droppedFrames).toBe(600);
    expect(acc.channelCount).toBe(1);
    expect(acc.push([new Float32Array(3), new Float32Array(4)])).toBe(false); // ragged: not counted, not kept
    expect(acc.droppedFrames).toBe(600);
    expect(() => new PcmAccumulator(0)).toThrow(RangeError);
  });
});

describe('instantiateCheckedFvad (fail closed)', () => {
  it('instantiates the pinned module', async () => {
    const fvad = await instantiateCheckedFvad(asBuffer(WASM));
    const vad = createWebRtcVad(fvad);
    expect(vad.process(new Float32Array(320)).speech).toBe(false);
    vad.dispose();
  });

  it('refuses a module with another SHA-256 before compiling it', async () => {
    const tampered = new Uint8Array(WASM);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    await expect(instantiateCheckedFvad(asBuffer(tampered))).rejects.toBeInstanceOf(FvadLoadError);
    await expect(instantiateCheckedFvad(new ArrayBuffer(8))).rejects.toMatchObject({ code: 'VAD_UNAVAILABLE' });
    expect(FVAD_WASM_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('worker and worklet protocol guards', () => {
  it('accepts well-formed messages only', () => {
    const { port1, port2 } = new MessageChannel();
    expect(isStreamBeginRequest({ type: 'STREAM_BEGIN', sampleRate: 48000, port: port1 })).toBe(true);
    expect(isStreamBeginRequest({ type: 'STREAM_BEGIN', sampleRate: 0, port: port1 })).toBe(false);
    expect(isStreamBeginRequest({ type: 'STREAM_BEGIN', sampleRate: 48000, port: {} })).toBe(false);
    expect(isStreamEndRequest({ type: 'STREAM_END' })).toBe(true);
    expect(isPcmBlock({ channels: [new Float32Array(4), new Float32Array(4)] })).toBe(true);
    expect(isPcmBlock({ channels: [new Float32Array(4), new Float32Array(3)] })).toBe(false);
    expect(isPcmBlock({ channels: [] })).toBe(false);
    expect(isPcmBlock({ channels: [[0.1, 0.2]] })).toBe(false);
    expect(isWorkletCommand({ type: 'ATTACH_WORKER', port: port2 })).toBe(true);
    expect(isWorkletCommand({ type: 'RECORD', record: 'yes' })).toBe(false);
    expect(isWorkletCommand({ type: 'END' })).toBe(true);
    const stats = { frames: 10, droppedFrames: 0, channelCount: 1 };
    expect(isDspWorkerReply({ type: 'STREAM_RESULT', analysis: null, failure: 'VAD_UNAVAILABLE', stats })).toBe(true);
    expect(isDspWorkerReply({ type: 'STREAM_RESULT', analysis: null, failure: null, stats: { ...stats, frames: -0.5 } })).toBe(false);
    port1.close();
    port2.close();
  });
});

describe('bundle guard: pinned files (I-06b)', () => {
  const pinned: PinnedFile[] = [{ path: 'fvad.wasm', sha256: 'a'.repeat(64), reason: 'test' }];
  it('allows a pinned file with its hash only, and nothing unpinned', () => {
    expect(checkUnscannedFile('fvad.wasm', 'a'.repeat(64), pinned)).toEqual([]);
    expect(checkUnscannedFile('fvad.wasm', 'b'.repeat(64), pinned).map((f) => f.rule)).toEqual(['pinned-file-mismatch']);
    expect(checkUnscannedFile('other.wasm', 'a'.repeat(64), pinned)).toEqual([{ file: 'other.wasm', rule: 'unscanned-file-type', detail: '.wasm' }]);
    expect(checkUnscannedFile('notes.txt', 'a'.repeat(64), pinned).map((f) => f.rule)).toEqual(['unscanned-file-type']);
    expect(checkUnscannedFile('THIRD_PARTY/LICENSE', 'a'.repeat(64), pinned)[0]?.detail).toBe('(none)');
    expect(missingPinnedFiles(new Set(['manifest.json']), pinned).map((f) => f.rule)).toEqual(['missing-required-output']);
  });
});

describe('analyzeDescriptors', () => {
  const fvad = loadFvad().fvad;
  it('is extractor-0 with libfvad plus the mapping-0 seed, and carries no samples', async () => {
    const pcm = Float32Array.from(synthVoice(VOICE_A, 12, 48000, 1001).signal);
    const d = await analyzeDescriptors([pcm], 48000, fvad);
    const vad = createWebRtcVad(fvad);
    const x = extractDescriptors([pcm], 48000, vad);
    vad.dispose();
    expect(d.raw).toEqual([...x.raw]);
    expect(d.status).toBe('OK');
    expect(d.seed).toEqual(seedFromRaw(x.raw).seed);
    expect(d.extractorVersion).toBe('extractor-0-experimental');
    expect(d.quality.accepted).toBe(true);
    expect(d.vadDecisionsSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(d).length).toBeLessThan(3000);
  });
});
