import { describe, expect, it } from 'vitest';
import { addDecisions, categoryOf, emptyTallies, frameTruths, rates } from '../benchmarks/vad-metrics.ts';

describe('frameTruths', () => {
  // 10 ms hops at 48 kHz: two track points per 20 ms frame.
  const track = { hopSamples: 480, valuesHz: [100, 100, null, null, 100, null, 100] };

  it('speech only when every point is voiced, pause when none is, mixed excluded', () => {
    expect(frameTruths(track, 48000, 4, 0.02)).toEqual([true, false, null, null]);
  });

  it('a frame past the end of the track has no truth', () => {
    expect(frameTruths({ hopSamples: 480, valuesHz: [100, 100] }, 48000, 2, 0.02)).toEqual([true, null]);
  });

  it('works when hops do not divide the frame (44.1 kHz, 441-sample hops)', () => {
    const t = frameTruths({ hopSamples: 441, valuesHz: [1, 1, 1, 1, null, null] }, 44100, 3, 0.02);
    expect(t).toEqual([true, true, false]);
  });

  it('rejects a bad geometry', () => {
    expect(() => frameTruths({ hopSamples: 0, valuesHz: [] }, 48000, 1, 0.02)).toThrow(RangeError);
  });
});

describe('categories and rates', () => {
  it('maps families and truths to categories', () => {
    expect(categoryOf('music', null)).toBe('music');
    expect(categoryOf('noise', null)).toBe('non-speech');
    expect(categoryOf('voice', true)).toBe('speech');
    expect(categoryOf('voice', false)).toBe('pause');
    expect(categoryOf('voice', null)).toBeNull();
    expect(categoryOf('voice-music', true)).toBe('speech-with-music');
    expect(categoryOf('voice-music', false)).toBe('music');
    expect(categoryOf('antiphase', true)).toBeNull();
    expect(categoryOf('a-then-b', null)).toBeNull();
  });

  it('counts false negatives on speech and false positives elsewhere; null when nothing was counted', () => {
    const t = emptyTallies();
    addDecisions(t, 'voice', [true, true, true, true, false, null], [true, true, true, false, true, true]);
    addDecisions(t, 'music', [null, null], [true, false]);
    const r = rates(t);
    expect(r.falseNegativeVoice).toBe(0.25);
    expect(r.falsePositivePause).toBe(1);
    expect(r.falsePositiveMusic).toBe(0.5);
    expect(r.falsePositiveNonSpeech).toBeNull();
    expect(r.falseNegativeVoiceWithMusic).toBeNull();
  });

  it('refuses decisions that do not match the truths', () => {
    expect(() => {
      addDecisions(emptyTallies(), 'voice', [true], []);
    }).toThrow(RangeError);
  });
});
