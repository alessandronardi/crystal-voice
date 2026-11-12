// Limits of the local-file source (SPEC §9 «File locali [H]», I-18, ADR-0022).
// Pure: numbers in, a plan or a typed refusal out, tested in Node.
//
// - A file longer than FILE_MAX_DURATION_SECONDS is refused (FILE_TOO_LONG).
// - At most FILE_WINDOW_SECONDS are analysed, from a start the user chooses.
// - Decoding happens in the panel's memory. Before decoding, the peak memory
//   is estimated: the bytes read, the decoded buffer, and the copy of the
//   window handed to the DSP worker. Above FILE_MEMORY_BUDGET_BYTES the file
//   is refused with FILE_TOO_LONG («too large to decode»): a whole-file decode
//   of 30 minutes of stereo at 48 kHz alone is about 690 MB.
// - The estimate is not a ceiling. For a non-WAV file it trusts the duration
//   in the metadata and assumes WHOLE_DECODE_ASSUMED_CHANNELS. So the decoded
//   buffer is checked again with its real length and channels
//   (checkDecoded), before the window is copied. A decode that is itself too
//   large is not prevented: it fails, and the panel reports FILE_DECODE_FAILED
//   (review H2).
// All three numbers are [H]; the budget is not measured yet
// (docs/BENCHMARK_PROTOCOL.md §7).

/** [H] SPEC §9: longer files are refused. */
export const FILE_MAX_DURATION_SECONDS = 1800;
/** [H] SPEC §9: analysis window. */
export const FILE_WINDOW_SECONDS = 120;
/** [H] ADR-0022, decision D3 of 2026-11-12: peak decode memory. Not measured. */
export const FILE_MEMORY_BUDGET_BYTES = 256 * 1024 * 1024;
/** Rate of the decoding context for files that are not cut by bytes (not WAV). */
export const WHOLE_DECODE_SAMPLE_RATE = 48000;
/** Channels assumed before decoding a non-WAV file: its channel count is not known yet. */
export const WHOLE_DECODE_ASSUMED_CHANNELS = 2;
const FLOAT32_BYTES = 4;

/**
 * DURATION: over 30 minutes. MEMORY: a whole-file decode too large.
 * MEMORY_WINDOW: even the chosen window of a WAV is too large (very high
 * rate or many channels).
 */
export type FileRefusal =
  | { code: 'FILE_TOO_LONG'; reason: 'DURATION' | 'MEMORY' | 'MEMORY_WINDOW' }
  | { code: 'FILE_DECODE_FAILED'; reason: 'NO_DURATION' | 'EMPTY' };

/** A window in frames of a signal at `sampleRate`. */
export interface FrameWindow {
  startFrame: number;
  frameCount: number;
}

/**
 * Start offset as typed by the user: seconds, finite, at least 0. Anything
 * else is read as 0 (the field starts at 0; a junk value must not move it).
 */
export function readStartSeconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * The analysis window of a signal of `totalFrames` frames: from
 * floor(start × rate), clamped to the last frame, for at most
 * FILE_WINDOW_SECONDS. Null for an empty signal.
 */
export function windowFrames(totalFrames: number, sampleRate: number, startSeconds: number): FrameWindow | null {
  if (!Number.isSafeInteger(totalFrames) || totalFrames <= 0 || !Number.isSafeInteger(sampleRate) || sampleRate <= 0) {
    return null;
  }
  const wanted = Math.floor(readStartSeconds(startSeconds) * sampleRate);
  const startFrame = Math.min(wanted, totalFrames - 1);
  const frameCount = Math.min(totalFrames - startFrame, FILE_WINDOW_SECONDS * sampleRate);
  return { startFrame, frameCount };
}

/** Exact seconds of a window, for AnalysisSource.offsetStartSeconds / offsetEndSeconds. */
export function windowSeconds(window: FrameWindow, sampleRate: number): { offsetStartSeconds: number; offsetEndSeconds: number } {
  return {
    offsetStartSeconds: window.startFrame / sampleRate,
    offsetEndSeconds: (window.startFrame + window.frameCount) / sampleRate,
  };
}

function checkDuration(durationSeconds: number): FileRefusal | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) return { code: 'FILE_DECODE_FAILED', reason: 'NO_DURATION' };
  if (durationSeconds === 0) return { code: 'FILE_DECODE_FAILED', reason: 'EMPTY' };
  if (durationSeconds > FILE_MAX_DURATION_SECONDS) return { code: 'FILE_TOO_LONG', reason: 'DURATION' };
  return null;
}

export type WavPlan = { ok: true; window: FrameWindow; estimatedBytes: number } | ({ ok: false } & FileRefusal);

/**
 * Plan for a WAV cut by bytes: only the window is read and decoded, at the
 * file's own rate. Peak: window bytes + decoded window + its copy for the worker.
 */
export function planWav(
  wav: { frames: number; sampleRate: number; channelCount: number; blockAlign: number },
  startSeconds: number,
): WavPlan {
  const refusal = checkDuration(wav.frames / wav.sampleRate);
  if (refusal !== null) return { ok: false, ...refusal };
  const window = windowFrames(wav.frames, wav.sampleRate, startSeconds);
  if (window === null) return { ok: false, code: 'FILE_DECODE_FAILED', reason: 'EMPTY' };
  const decoded = window.frameCount * wav.channelCount * FLOAT32_BYTES;
  const estimatedBytes = window.frameCount * wav.blockAlign + 2 * decoded;
  if (estimatedBytes > FILE_MEMORY_BUDGET_BYTES) return { ok: false, code: 'FILE_TOO_LONG', reason: 'MEMORY_WINDOW' };
  return { ok: true, window, estimatedBytes };
}

/**
 * After decoding, with the real numbers: the decoded buffer plus the copy of
 * the window must fit the budget, and the real duration must be within the
 * limit (the metadata may have lied). Null when the window may be copied.
 */
export function checkDecoded(decoded: { length: number; sampleRate: number; channels: number }, window: FrameWindow): FileRefusal | null {
  const refusal = checkDuration(decoded.length / decoded.sampleRate);
  if (refusal !== null) return refusal;
  const bytes = (decoded.length + window.frameCount) * decoded.channels * FLOAT32_BYTES;
  return bytes > FILE_MEMORY_BUDGET_BYTES ? { code: 'FILE_TOO_LONG', reason: 'MEMORY' } : null;
}

export type WholePlan = { ok: true; estimatedBytes: number } | ({ ok: false } & FileRefusal);

/**
 * Plan for a file decoded whole (not a WAV cut by bytes): the whole file is
 * read and decoded at WHOLE_DECODE_SAMPLE_RATE, then the window is copied.
 * The channel count is unknown before decoding: WHOLE_DECODE_ASSUMED_CHANNELS.
 */
export function planWhole(durationSeconds: number, fileBytes: number): WholePlan {
  const refusal = checkDuration(durationSeconds);
  if (refusal !== null) return { ok: false, ...refusal };
  const perSecond = WHOLE_DECODE_SAMPLE_RATE * WHOLE_DECODE_ASSUMED_CHANNELS * FLOAT32_BYTES;
  const estimatedBytes =
    fileBytes + Math.ceil(durationSeconds * perSecond) + Math.min(durationSeconds, FILE_WINDOW_SECONDS) * perSecond;
  if (estimatedBytes > FILE_MEMORY_BUDGET_BYTES) return { ok: false, code: 'FILE_TOO_LONG', reason: 'MEMORY' };
  return { ok: true, estimatedBytes };
}
