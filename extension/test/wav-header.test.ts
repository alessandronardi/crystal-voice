// WAV header reader and window cutting of the local-file source (I-18).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeWav, encodeWav } from '../../scripts/fixtures/wav.ts';
import { fmtChunk, parseWavHeader, windowByteRange, windowWavHeader, type WavLayout } from '../src/sidepanel/wav-header.ts';

function tone(frames: number, channels: number, sampleRate: number): Float32Array[] {
  return Array.from({ length: channels }, (_, c) =>
    Float32Array.from({ length: frames }, (_, i) => Math.sin((2 * Math.PI * 220 * (c + 1) * i) / sampleRate) * 0.5),
  );
}

/** A WAV with an arbitrary fmt chunk body and optional chunks before data. */
function craft(options: {
  fmt: Uint8Array;
  data: Uint8Array;
  before?: { id: string; body: Uint8Array }[];
  dataSizeField?: number;
}): Uint8Array {
  const chunks: Uint8Array[] = [];
  const chunk = (id: string, body: Uint8Array, sizeField = body.byteLength): void => {
    const head = new Uint8Array(8);
    for (let i = 0; i < 4; i++) head[i] = id.charCodeAt(i);
    new DataView(head.buffer).setUint32(4, sizeField, true);
    chunks.push(head, body);
    if (body.byteLength % 2 === 1 && id !== 'data') chunks.push(new Uint8Array(1));
  };
  for (const extra of options.before ?? []) chunk(extra.id, extra.body);
  chunk('fmt ', options.fmt);
  chunk('data', options.data, options.dataSizeField);
  const bodyBytes = chunks.reduce((s, c) => s + c.byteLength, 0);
  const out = new Uint8Array(12 + bodyBytes);
  const view = new DataView(out.buffer);
  'RIFF'.split('').forEach((ch, i) => (out[i] = ch.charCodeAt(0)));
  view.setUint32(4, 4 + bodyBytes, true);
  'WAVE'.split('').forEach((ch, i) => (out[8 + i] = ch.charCodeAt(0)));
  let p = 12;
  for (const c of chunks) {
    out.set(c, p);
    p += c.byteLength;
  }
  return out;
}

function fmtBody(o: { tag: number; channels: number; rate: number; bits: number; extensibleSub?: number; blockAlign?: number }): Uint8Array {
  const ext = o.extensibleSub !== undefined;
  const body = new Uint8Array(ext ? 40 : 16);
  const v = new DataView(body.buffer);
  const blockAlign = o.blockAlign ?? (o.channels * o.bits) / 8;
  v.setUint16(0, o.tag, true);
  v.setUint16(2, o.channels, true);
  v.setUint32(4, o.rate, true);
  v.setUint32(8, o.rate * blockAlign, true);
  v.setUint16(12, blockAlign, true);
  v.setUint16(14, o.bits, true);
  if (ext) {
    v.setUint16(16, 22, true);
    v.setUint16(18, o.bits, true);
    v.setUint32(20, 3, true);
    v.setUint16(24, o.extensibleSub ?? 1, true);
    body.set([0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71], 26);
  }
  return body;
}

describe('parseWavHeader', () => {
  it('reads the fixtures encoder layout (44-byte header, PCM 16)', () => {
    const wav = encodeWav({ sampleRate: 44100, channels: tone(4410, 2, 44100) });
    const layout = parseWavHeader(wav, wav.byteLength);
    expect(layout).toEqual<WavLayout>({
      sampleFormat: 'pcm',
      channelCount: 2,
      sampleRate: 44100,
      bitsPerSample: 16,
      blockAlign: 4,
      fmtOffset: 20,
      fmtSize: 16,
      dataOffset: 44,
      frames: 4410,
      durationSeconds: 0.1,
    });
  });

  it('reads IEEE float and WAVE_FORMAT_EXTENSIBLE (PCM and float subformats)', () => {
    const data = new Uint8Array(8 * 10);
    expect(parseWavHeader(craft({ fmt: fmtBody({ tag: 3, channels: 2, rate: 48000, bits: 32 }), data }), 1e6)).toMatchObject({
      sampleFormat: 'float',
      frames: 10,
    });
    const extPcm = craft({ fmt: fmtBody({ tag: 0xfffe, channels: 2, rate: 48000, bits: 32, extensibleSub: 1 }), data });
    expect(parseWavHeader(extPcm, extPcm.byteLength)).toMatchObject({ sampleFormat: 'pcm', fmtSize: 40, frames: 10 });
    const extFloat = craft({ fmt: fmtBody({ tag: 0xfffe, channels: 2, rate: 48000, bits: 32, extensibleSub: 3 }), data });
    expect(parseWavHeader(extFloat, extFloat.byteLength)).toMatchObject({ sampleFormat: 'float' });
  });

  it('skips chunks before data, with odd-size padding', () => {
    const data = new Uint8Array(2 * 7);
    const wav = craft({
      fmt: fmtBody({ tag: 1, channels: 1, rate: 8000, bits: 16 }),
      data,
      before: [{ id: 'LIST', body: new Uint8Array(5) }, { id: 'bext', body: new Uint8Array(3) }],
    });
    const layout = parseWavHeader(wav, wav.byteLength);
    expect(layout?.frames).toBe(7);
    expect(layout?.dataOffset).toBe(wav.byteLength - data.byteLength);
  });

  it('reads a data size of 0, 0xFFFFFFFF or past the end as «up to the end of the file», whole frames only', () => {
    const fmt = fmtBody({ tag: 1, channels: 2, rate: 8000, bits: 16 });
    const data = new Uint8Array(4 * 9 + 3); // 9 whole frames and a partial one
    for (const size of [0, 0xffffffff, 1_000_000]) {
      const wav = craft({ fmt, data, dataSizeField: size });
      expect(parseWavHeader(wav, wav.byteLength)?.frames, String(size)).toBe(9);
    }
    // A declared size shorter than the file wins.
    const wav = craft({ fmt, data, dataSizeField: 8 });
    expect(parseWavHeader(wav, wav.byteLength)?.frames).toBe(2);
    // The header alone is enough: the size comes from the file, not from the bytes read.
    expect(parseWavHeader(wav.subarray(0, 44), 44 + 4 * 1000)?.frames).toBe(2);
    const open = craft({ fmt, data, dataSizeField: 0 });
    expect(parseWavHeader(open.subarray(0, 44), 44 + 4 * 1000)?.frames).toBe(1000);
  });

  it('returns null for what it cannot cut by bytes', () => {
    const data = new Uint8Array(16);
    const cases: [string, Uint8Array][] = [
      ['not RIFF', new TextEncoder().encode('ID3\u0004 this is an mp3 actually......')],
      ['too short', new Uint8Array([0x52, 0x49, 0x46, 0x46])],
      ['ADPCM', craft({ fmt: fmtBody({ tag: 2, channels: 1, rate: 8000, bits: 4, blockAlign: 256 }), data })],
      ['µ-law', craft({ fmt: fmtBody({ tag: 7, channels: 1, rate: 8000, bits: 8 }), data })],
      ['12-bit PCM', craft({ fmt: fmtBody({ tag: 1, channels: 1, rate: 8000, bits: 12, blockAlign: 2 }), data })],
      ['16-bit float', craft({ fmt: fmtBody({ tag: 3, channels: 1, rate: 8000, bits: 16 }), data })],
      ['wrong blockAlign', craft({ fmt: fmtBody({ tag: 1, channels: 2, rate: 8000, bits: 16, blockAlign: 3 }), data })],
      ['no channels', craft({ fmt: fmtBody({ tag: 1, channels: 0, rate: 8000, bits: 16, blockAlign: 0 }), data })],
      ['rate too low for a context', craft({ fmt: fmtBody({ tag: 1, channels: 1, rate: 2000, bits: 16 }), data })],
      ['rate too high', craft({ fmt: fmtBody({ tag: 1, channels: 1, rate: 800_000, bits: 16 }), data })],
      ['extensible, other subformat', craft({ fmt: fmtBody({ tag: 0xfffe, channels: 1, rate: 8000, bits: 16, extensibleSub: 2 }), data })],
    ];
    for (const [name, bytes] of cases) expect(parseWavHeader(bytes, bytes.byteLength), name).toBeNull();
    // fmt chunk cut by the end of the bytes read; data chunk never reached.
    const wav = encodeWav({ sampleRate: 8000, channels: tone(10, 1, 8000) });
    expect(parseWavHeader(wav.subarray(0, 30), wav.byteLength)).toBeNull();
    expect(parseWavHeader(wav.subarray(0, 36), wav.byteLength)).toBeNull();
    // data before fmt.
    const swapped = wav.slice();
    swapped.set(wav.subarray(36, 44), 12);
    swapped.set(wav.subarray(12, 36), 20);
    expect(parseWavHeader(swapped, swapped.byteLength)).toBeNull();
    expect(parseWavHeader(wav, Number.NaN)).toBeNull();
  });

  it('property: any encoder output is read back with its rate, channels and length', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3000, max: 192000 }),
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 400 }),
        (rate, channels, frames) => {
          const wav = encodeWav({ sampleRate: rate, channels: tone(frames, channels, rate) });
          const layout = parseWavHeader(wav, wav.byteLength);
          return layout !== null && layout.sampleRate === rate && layout.channelCount === channels && layout.frames === frames;
        },
      ),
      { seed: 18, numRuns: 200 },
    );
  });
});

describe('window file (header + byte range)', () => {
  it('decodes to exactly the samples of the window', () => {
    const rate = 16000;
    const source = tone(5000, 2, rate);
    const wav = encodeWav({ sampleRate: rate, channels: source });
    const full = decodeWav(wav);
    const layout = parseWavHeader(wav, wav.byteLength);
    if (layout === null) throw new Error('layout');
    for (const [start, count] of [
      [0, 5000],
      [1234, 1000],
      [4999, 1],
      [0, 1],
    ] as const) {
      const range = windowByteRange(layout, start, count);
      const header = windowWavHeader(fmtChunk(wav, layout), range.end - range.start);
      const file = new Uint8Array(header.byteLength + range.end - range.start);
      file.set(header, 0);
      file.set(wav.subarray(range.start, range.end), header.byteLength);
      const cut = decodeWav(file);
      expect(cut.sampleRate).toBe(rate);
      for (let c = 0; c < 2; c++) {
        expect(cut.channels[c]).toEqual(full.channels[c]?.subarray(start, start + count));
      }
      // The window file is itself a WAV this reader accepts.
      expect(parseWavHeader(file, file.byteLength)).toMatchObject({ frames: count, sampleRate: rate, channelCount: 2 });
    }
  });

  it('copies an extensible fmt chunk verbatim', () => {
    const fmt = fmtBody({ tag: 0xfffe, channels: 1, rate: 8000, bits: 16, extensibleSub: 1 });
    const wav = craft({ fmt, data: new Uint8Array(20) });
    const layout = parseWavHeader(wav, wav.byteLength);
    if (layout === null) throw new Error('layout');
    const header = windowWavHeader(fmtChunk(wav, layout), 4);
    expect(header.subarray(20, 60)).toEqual(fmt);
    expect(parseWavHeader(new Uint8Array([...header, 1, 2, 3, 4]), header.byteLength + 4)).toMatchObject({
      sampleFormat: 'pcm',
      frames: 2,
    });
  });
});
