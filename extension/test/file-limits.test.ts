// Limits of the local-file source (SPEC §9 «File locali [H]», I-18).
import { describe, expect, it } from 'vitest';
import {
  checkDecoded,
  FILE_MAX_DURATION_SECONDS,
  FILE_MEMORY_BUDGET_BYTES,
  FILE_WINDOW_SECONDS,
  planWav,
  planWhole,
  readStartSeconds,
  windowFrames,
  windowSeconds,
} from '../src/sidepanel/file-limits.ts';

const mono8k = (seconds: number) => ({ frames: Math.round(seconds * 8000), sampleRate: 8000, channelCount: 1, blockAlign: 2 });

describe('duration limit (FILE_TOO_LONG over 30 minutes)', () => {
  it('accepts exactly 30 minutes and refuses one frame more', () => {
    expect(FILE_MAX_DURATION_SECONDS).toBe(1800);
    expect(planWav(mono8k(1800), 0)).toMatchObject({ ok: true });
    expect(planWav({ ...mono8k(1800), frames: 1800 * 8000 + 1 }, 0)).toEqual({ ok: false, code: 'FILE_TOO_LONG', reason: 'DURATION' });
    // A whole-file decode of 30 minutes passes the duration check and is then
    // stopped by the memory budget (see below); a little more is too long.
    expect(planWhole(1800, 1000)).toMatchObject({ ok: false, reason: 'MEMORY' });
    expect(planWhole(1800.001, 1000)).toEqual({ ok: false, code: 'FILE_TOO_LONG', reason: 'DURATION' });
  });

  it('a duration that cannot be read, or zero, is a decode failure, never 0 s of audio', () => {
    for (const d of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(planWhole(d, 1000)).toEqual({ ok: false, code: 'FILE_DECODE_FAILED', reason: 'NO_DURATION' });
    }
    expect(planWhole(0, 1000)).toEqual({ ok: false, code: 'FILE_DECODE_FAILED', reason: 'EMPTY' });
    expect(planWav({ ...mono8k(0), frames: 0 }, 0)).toEqual({ ok: false, code: 'FILE_DECODE_FAILED', reason: 'EMPTY' });
  });
});

describe('analysis window (first 120 s from the chosen start)', () => {
  it('takes at most 120 s, from floor(start × rate)', () => {
    expect(FILE_WINDOW_SECONDS).toBe(120);
    expect(windowFrames(48000 * 600, 48000, 0)).toEqual({ startFrame: 0, frameCount: 48000 * 120 });
    expect(windowFrames(48000 * 600, 48000, 10.00001)).toEqual({ startFrame: 480000, frameCount: 48000 * 120 });
    expect(windowFrames(48000 * 12, 48000, 0)).toEqual({ startFrame: 0, frameCount: 48000 * 12 });
    expect(windowFrames(48000 * 12, 48000, 5)).toEqual({ startFrame: 240000, frameCount: 48000 * 7 });
  });

  it('clamps a start past the end to the last frame, and reads junk as 0', () => {
    expect(windowFrames(1000, 8000, 99)).toEqual({ startFrame: 999, frameCount: 1 });
    for (const junk of [Number.NaN, -5, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
      expect(readStartSeconds(junk)).toBe(0);
      expect(windowFrames(1000, 8000, junk)).toEqual({ startFrame: 0, frameCount: 1000 });
    }
    expect(windowFrames(0, 8000, 0)).toBeNull();
    expect(windowFrames(10, 0, 0)).toBeNull();
    expect(windowFrames(10.5, 8000, 0)).toBeNull();
  });

  it('reports the exact seconds of the frames analysed', () => {
    expect(windowSeconds({ startFrame: 441, frameCount: 44100 }, 44100)).toEqual({ offsetStartSeconds: 0.01, offsetEndSeconds: 1.01 });
  });
});

describe('memory budget [H] before decoding', () => {
  it('a WAV counts only its window: 30 minutes of 48 kHz stereo 16-bit pass', () => {
    const plan = planWav({ frames: 48000 * 1800, sampleRate: 48000, channelCount: 2, blockAlign: 4 }, 0);
    expect(plan).toMatchObject({ ok: true, estimatedBytes: 48000 * 120 * (4 + 2 * 2 * 4) });
  });

  it('a WAV window above the budget is refused as too large (192 kHz, 8 channels)', () => {
    expect(planWav({ frames: 192000 * 200, sampleRate: 192000, channelCount: 8, blockAlign: 32 }, 0)).toEqual({
      ok: false,
      code: 'FILE_TOO_LONG',
      reason: 'MEMORY_WINDOW',
    });
  });

  it('after decoding, the real channels and length decide (review H2)', () => {
    const window = (seconds: number, rate: number) => ({ startFrame: 0, frameCount: seconds * rate });
    // Estimated with 2 channels, decoded with 6 (5.1): 9 minutes at 48 kHz no longer fits.
    expect(checkDecoded({ length: 48000 * 540, sampleRate: 48000, channels: 6 }, window(120, 48000))).toEqual({
      code: 'FILE_TOO_LONG',
      reason: 'MEMORY',
    });
    expect(checkDecoded({ length: 48000 * 60, sampleRate: 48000, channels: 2 }, window(60, 48000))).toBeNull();
    // Metadata that understated the duration: the decoded length is the truth.
    expect(checkDecoded({ length: 8000 * 1801, sampleRate: 8000, channels: 1 }, window(120, 8000))).toEqual({
      code: 'FILE_TOO_LONG',
      reason: 'DURATION',
    });
    expect(checkDecoded({ length: 0, sampleRate: 48000, channels: 1 }, window(0, 48000))).toEqual({
      code: 'FILE_DECODE_FAILED',
      reason: 'EMPTY',
    });
    // Boundary: buffer + window copy exactly at the budget passes.
    const frames = FILE_MEMORY_BUDGET_BYTES / 4 / 2;
    expect(checkDecoded({ length: frames, sampleRate: 48000, channels: 1 }, { startFrame: 0, frameCount: frames })).toBeNull();
    expect(checkDecoded({ length: frames + 1, sampleRate: 48000, channels: 1 }, { startFrame: 0, frameCount: frames })).not.toBeNull();
  });

  it('a whole-file decode counts the file, the whole decoded signal at 48 kHz stereo and the window copy', () => {
    const perSecond = 48000 * 2 * 4;
    expect(planWhole(60, 1_000_000)).toEqual({ ok: true, estimatedBytes: 1_000_000 + 60 * perSecond + 60 * perSecond });
    // Boundary: the largest duration under the budget passes, a little more does not.
    const fileBytes = 5_000_000;
    const longest = (FILE_MEMORY_BUDGET_BYTES - fileBytes - FILE_WINDOW_SECONDS * perSecond) / perSecond;
    expect(planWhole(Math.floor(longest), fileBytes)).toMatchObject({ ok: true });
    expect(planWhole(Math.floor(longest) + 1, fileBytes)).toEqual({ ok: false, code: 'FILE_TOO_LONG', reason: 'MEMORY' });
    // 30 minutes of a compressed file do not fit: about 690 MB decoded.
    expect(planWhole(1800, 30_000_000)).toMatchObject({ ok: false, reason: 'MEMORY' });
  });
});
