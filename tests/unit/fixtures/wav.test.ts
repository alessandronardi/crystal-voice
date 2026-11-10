import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeWav, encodeWav, quantizeInt16, WavFormatError } from '../../../scripts/fixtures/wav.ts';

const ascii = (bytes: Uint8Array, from: number): string => String.fromCharCode(...bytes.slice(from, from + 4));

describe('WAV codec', () => {
  it('writes a canonical 44-byte PCM 16-bit header', () => {
    const wav = encodeWav({ sampleRate: 48000, channels: [new Float32Array(10), new Float32Array(10)] });
    const v = new DataView(wav.buffer);
    expect(wav.byteLength).toBe(44 + 10 * 2 * 2);
    expect(ascii(wav, 0)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(wav.byteLength - 8);
    expect(ascii(wav, 8)).toBe('WAVE');
    expect(ascii(wav, 12)).toBe('fmt ');
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint32(28, true)).toBe(48000 * 4);
    expect(v.getUint16(32, true)).toBe(4);
    expect(v.getUint16(34, true)).toBe(16);
    expect(ascii(wav, 36)).toBe('data');
    expect(v.getUint32(40, true)).toBe(40);
  });

  it('round-trips within one quantization step, interleaving channels', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 1, maxLength: 200 }),
        fc.constantFrom(1, 2),
        fc.constantFrom(16000, 44100, 48000),
        (samples, channelCount, sampleRate) => {
          const channels = Array.from({ length: channelCount }, (_, c) => Float64Array.from(samples, (x) => (c === 0 ? x : -x)));
          const decoded = decodeWav(encodeWav({ sampleRate, channels }));
          expect(decoded.sampleRate).toBe(sampleRate);
          expect(decoded.channels).toHaveLength(channelCount);
          decoded.channels.forEach((ch, c) => {
            expect(ch).toHaveLength(samples.length);
            ch.forEach((v, i) => {
              expect(Math.abs(v - (channels[c]?.[i] ?? 0))).toBeLessThanOrEqual(2 / 32768);
            });
          });
        },
      ),
    );
  });

  it('is byte-deterministic', () => {
    const x = Float64Array.from({ length: 1000 }, (_, i) => Math.sin(i / 7) * 0.5);
    expect(encodeWav({ sampleRate: 48000, channels: [x] })).toEqual(encodeWav({ sampleRate: 48000, channels: [x] }));
  });

  it('saturates out-of-range samples and rejects NaN', () => {
    expect(quantizeInt16(1.5)).toBe(32767);
    expect(quantizeInt16(-1.5)).toBe(-32767);
    expect(quantizeInt16(0)).toBe(0);
    expect(() => quantizeInt16(Number.NaN)).toThrow(WavFormatError);
  });

  it('rejects bad input and malformed files with typed errors', () => {
    expect(() => encodeWav({ sampleRate: 48000, channels: [] })).toThrow(WavFormatError);
    expect(() => encodeWav({ sampleRate: 0, channels: [new Float32Array(1)] })).toThrow(WavFormatError);
    expect(() => encodeWav({ sampleRate: 48000, channels: [new Float32Array(1), new Float32Array(2)] })).toThrow(WavFormatError);
    expect(() => decodeWav(new Uint8Array(8))).toThrow(WavFormatError);
    const wav = encodeWav({ sampleRate: 48000, channels: [new Float32Array(100)] });
    expect(() => decodeWav(wav.slice(0, 60))).toThrow(WavFormatError);
    const float = wav.slice();
    new DataView(float.buffer).setUint16(20, 3, true);
    expect(() => decodeWav(float)).toThrow(WavFormatError);
  });

  it('skips unknown chunks when decoding', () => {
    const wav = encodeWav({ sampleRate: 8000, channels: [Float64Array.from([0.5, -0.5])] });
    const extra = new Uint8Array([0x4c, 0x49, 0x53, 0x54, 2, 0, 0, 0, 9, 9]); // "LIST", 2 bytes
    const spliced = new Uint8Array(wav.byteLength + extra.byteLength);
    spliced.set(wav.slice(0, 36), 0);
    spliced.set(extra, 36);
    spliced.set(wav.slice(36), 36 + extra.byteLength);
    const decoded = decodeWav(spliced);
    expect(Array.from(decoded.channels[0] ?? [])).toEqual([16384 / 32768, -16384 / 32768]);
  });
});
