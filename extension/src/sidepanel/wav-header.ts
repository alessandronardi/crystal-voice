// RIFF/WAVE header reader for local files (I-18, ADR-0022). Pure: bytes in,
// layout out, so it runs in Node tests. Only uncompressed layouts are read
// (integer PCM 8/16/24/32 bit, IEEE float 32/64 bit, and the same under
// WAVE_FORMAT_EXTENSIBLE): those can be cut to a time window by bytes, so
// only the chosen 120 s are decoded. Anything else (ADPCM, µ-law, a header
// this reader cannot follow) returns null and takes the whole-file path,
// where decodeAudioData decides. A file is never trusted: every field is
// bounded before use (AGENTS.md R17).

/** How many leading bytes of a file the panel reads to find the header. */
export const WAV_HEAD_BYTES = 64 * 1024;

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;
/** Bytes 2..15 of the KSDATAFORMAT_SUBTYPE_PCM / _IEEE_FLOAT GUIDs (the first two hold the format tag). */
const SUBFORMAT_GUID_TAIL = [0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71];
const MAX_CHANNELS = 32;
/** decodeAudioData runs in an OfflineAudioContext, whose rate must lie in this range (Web Audio API). */
export const MIN_CONTEXT_RATE = 3000;
export const MAX_CONTEXT_RATE = 768000;

export type WavSampleFormat = 'pcm' | 'float';

export interface WavLayout {
  sampleFormat: WavSampleFormat;
  channelCount: number;
  sampleRate: number;
  bitsPerSample: number;
  /** Bytes per frame (all channels). */
  blockAlign: number;
  /** Offset and size of the "fmt " chunk body: copied verbatim into the window file. */
  fmtOffset: number;
  fmtSize: number;
  /** First byte of the sample data. */
  dataOffset: number;
  /** Whole frames of sample data present in the file. */
  frames: number;
  durationSeconds: number;
}

function tag(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0);
}

function sampleFormatOf(view: DataView, body: number, size: number): WavSampleFormat | null {
  const formatTag = view.getUint16(body, true);
  if (formatTag === FORMAT_PCM) return 'pcm';
  if (formatTag === FORMAT_FLOAT) return 'float';
  if (formatTag !== FORMAT_EXTENSIBLE || size < 40 || view.getUint16(body + 16, true) < 22) return null;
  const sub = view.getUint16(body + 24, true);
  for (let i = 0; i < SUBFORMAT_GUID_TAIL.length; i++) {
    if (view.getUint8(body + 26 + i) !== SUBFORMAT_GUID_TAIL[i]) return null;
  }
  return sub === FORMAT_PCM ? 'pcm' : sub === FORMAT_FLOAT ? 'float' : null;
}

function bitsAllowed(format: WavSampleFormat, bits: number): boolean {
  return format === 'pcm' ? [8, 16, 24, 32].includes(bits) : bits === 32 || bits === 64;
}

/**
 * Reads the layout of an uncompressed WAV from its first bytes (`head`, at
 * most WAV_HEAD_BYTES) and the total file size. Null when the file is not a
 * WAV this reader can cut by bytes.
 */
export function parseWavHeader(head: Uint8Array, fileSize: number): WavLayout | null {
  if (!Number.isSafeInteger(fileSize) || fileSize < 12 || head.byteLength < 12) return null;
  if (tag(head, 0) !== 'RIFF' || tag(head, 8) !== 'WAVE') return null;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  let fmt: Omit<WavLayout, 'dataOffset' | 'frames' | 'durationSeconds'> | null = null;
  let offset = 12;
  while (offset + 8 <= head.byteLength) {
    const id = tag(head, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + size > head.byteLength) return null;
      const sampleFormat = sampleFormatOf(view, body, size);
      const channelCount = view.getUint16(body + 2, true);
      const sampleRate = view.getUint32(body + 4, true);
      const blockAlign = view.getUint16(body + 12, true);
      const bitsPerSample = view.getUint16(body + 14, true);
      if (
        sampleFormat === null ||
        channelCount < 1 ||
        channelCount > MAX_CHANNELS ||
        !bitsAllowed(sampleFormat, bitsPerSample) ||
        blockAlign !== channelCount * (bitsPerSample / 8) ||
        sampleRate < MIN_CONTEXT_RATE ||
        sampleRate > MAX_CONTEXT_RATE
      ) {
        return null;
      }
      fmt = { sampleFormat, channelCount, sampleRate, bitsPerSample, blockAlign, fmtOffset: body, fmtSize: size };
    } else if (id === 'data') {
      if (fmt === null) return null; // "data" before "fmt ": not a layout we follow
      // A size of 0 or 0xFFFFFFFF (streamed writers) or one past the end of the
      // file means «up to the end of the file».
      const available = fileSize - body;
      const declared = size === 0 || size === 0xffffffff || size > available ? available : size;
      const frames = Math.floor(Math.max(0, declared) / fmt.blockAlign);
      return { ...fmt, dataOffset: body, frames, durationSeconds: frames / fmt.sampleRate };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

/** Byte range of `frameCount` frames from `startFrame`, for File.slice. */
export function windowByteRange(layout: WavLayout, startFrame: number, frameCount: number): { start: number; end: number } {
  const start = layout.dataOffset + startFrame * layout.blockAlign;
  return { start, end: start + frameCount * layout.blockAlign };
}

/**
 * A copy of the "fmt " chunk body: all the window file needs from the head,
 * so the head itself (which may hold samples) is not kept (review L1).
 */
export function fmtChunk(head: Uint8Array, layout: WavLayout): Uint8Array {
  return head.slice(layout.fmtOffset, layout.fmtOffset + layout.fmtSize);
}

/**
 * Header of a WAV holding only a window of the original: RIFF, the original
 * "fmt " chunk verbatim (`fmt`, from fmtChunk), and a "data" chunk of
 * `dataBytes`. Followed by the bytes of windowByteRange it is a complete file
 * for decodeAudioData.
 */
export function windowWavHeader(fmt: Uint8Array, dataBytes: number): Uint8Array {
  const fmtSize = fmt.byteLength;
  const fmtPadded = fmtSize + (fmtSize % 2);
  const headerBytes = 12 + 8 + fmtPadded + 8;
  const out = new Uint8Array(headerBytes);
  const view = new DataView(out.buffer);
  const ascii = (at: number, text: string): void => {
    for (let i = 0; i < text.length; i++) out[at + i] = text.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, headerBytes - 8 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, fmtSize, true);
  out.set(fmt, 20);
  ascii(20 + fmtPadded, 'data');
  view.setUint32(24 + fmtPadded, dataBytes, true);
  return out;
}
