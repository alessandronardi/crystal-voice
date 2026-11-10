// Minimal WAV codec for synthetic fixtures (I-04).
//
// Encoder: canonical 44-byte header (RIFF, "fmt " PCM 16-bit, "data"), no
// optional chunks, little-endian. The same input always produces the same
// bytes, so SHA-256 of the file is a stable fingerprint.
//
// Quantization: each float sample is clamped to [-1, 1] and mapped to
// round-half-away-from-zero(x * 32767), symmetric in sign so that a channel
// and its inverse quantize to exact opposites (antiphase fixture). Clamping is the only saturation; generators that are
// not meant to clip assert their peak before encoding (see build.ts).
// Decoder: int16 / 32768, the usual convention, so decode(encode(x)) differs
// from x by at most one quantization step.

export interface PcmAudio {
  sampleRate: number;
  /** One Float32Array per channel, all the same length. */
  channels: readonly Float32Array[];
}

export type WavErrorCode = 'NOT_RIFF_WAVE' | 'MISSING_CHUNK' | 'UNSUPPORTED_FORMAT' | 'TRUNCATED' | 'BAD_INPUT';

export class WavFormatError extends Error {
  override readonly name = 'WavFormatError';
  readonly code: WavErrorCode;
  constructor(code: WavErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const HEADER_BYTES = 44;
const BITS = 16;

export function quantizeInt16(x: number): number {
  if (Number.isNaN(x)) throw new WavFormatError('BAD_INPUT', 'NaN sample');
  const clamped = x > 1 ? 1 : x < -1 ? -1 : x;
  const q = Math.round(Math.abs(clamped) * 32767);
  return clamped < 0 ? -q : q;
}

export interface PcmInput {
  sampleRate: number;
  channels: readonly ArrayLike<number>[];
}

export function encodeWav(audio: PcmInput): Uint8Array {
  const { sampleRate, channels } = audio;
  const channelCount = channels.length;
  const first = channels[0];
  if (first === undefined) throw new WavFormatError('BAD_INPUT', 'no channels');
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new WavFormatError('BAD_INPUT', `bad sample rate ${String(sampleRate)}`);
  }
  const frames = first.length;
  for (const ch of channels) {
    if (ch.length !== frames) throw new WavFormatError('BAD_INPUT', 'channel lengths differ');
  }
  const blockAlign = channelCount * (BITS / 8);
  const dataBytes = frames * blockAlign;
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  let offset = HEADER_BYTES;
  for (let i = 0; i < frames; i++) {
    for (const ch of channels) {
      view.setInt16(offset, quantizeInt16(ch[i] ?? 0), true);
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
}

export function decodeWav(bytes: Uint8Array): PcmAudio {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number): string =>
    String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
  if (bytes.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    throw new WavFormatError('NOT_RIFF_WAVE', 'not a RIFF/WAVE file');
  }
  let channelCount = 0;
  let sampleRate = 0;
  let dataOffset = -1;
  let dataBytes = 0;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > bytes.byteLength) throw new WavFormatError('TRUNCATED', 'short fmt chunk');
      const format = view.getUint16(body, true);
      const bits = view.getUint16(body + 14, true);
      if (format !== 1 || bits !== BITS) {
        throw new WavFormatError('UNSUPPORTED_FORMAT', `format ${format}, ${bits} bit`);
      }
      channelCount = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
    } else if (id === 'data') {
      dataOffset = body;
      dataBytes = size;
    }
    offset = body + size + (size % 2);
  }
  if (channelCount === 0 || dataOffset < 0) throw new WavFormatError('MISSING_CHUNK', 'fmt or data missing');
  if (dataOffset + dataBytes > bytes.byteLength) throw new WavFormatError('TRUNCATED', 'data chunk truncated');
  const frames = Math.floor(dataBytes / (channelCount * 2));
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
  let p = dataOffset;
  for (let i = 0; i < frames; i++) {
    for (const ch of channels) {
      ch[i] = view.getInt16(p, true) / 32768;
      p += 2;
    }
  }
  return { sampleRate, channels };
}
