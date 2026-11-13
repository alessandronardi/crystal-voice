// I-07: split-half division of the valid speech (SPEC §8, ADR-0008).
// Pure tests on synthetic acoustic frames.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  computeDescriptors,
  descriptorsWithOnsets,
  detectOnsets,
  isUseful,
  SPLIT_HALF_BLOCK_FRAMES,
  splitHalfAt,
  validSpeechSeconds,
  type AcousticFrame,
} from '../src/index.ts';

const SR = 16000;

function frame(i: number, over: Partial<AcousticFrame> = {}): AcousticFrame {
  return {
    frameIndex: i,
    sampleStart: i * 160,
    sampleLength: 640,
    centreSeconds: (i * 160 + 320) / SR,
    vadSpeech: true,
    rmsDbfs: -20,
    f0Hz: 150,
    pitchConfidence: 0.95,
    spectralCentroidHz: 900,
    spectralFlatness: 0.2,
    periodicity: 0.97,
    envelopeEnergy: 0.01,
    clipped: false,
    spectralFlux: i === 0 ? null : 0.1,
    bandMagnitude: 10,
    ...over,
  };
}

/** n frames; `useful(i)` false makes frame i non-speech. */
function frames(n: number, over: (i: number) => Partial<AcousticFrame> = () => ({})): AcousticFrame[] {
  return Array.from({ length: n }, (_, i) => frame(i, over(i)));
}

describe('validSpeechSeconds', () => {
  it('counts whole seconds of useful frames (100 per second)', () => {
    expect(SPLIT_HALF_BLOCK_FRAMES).toBe(100);
    expect(validSpeechSeconds(frames(799))).toBe(7);
    expect(validSpeechSeconds(frames(800))).toBe(8);
    // Every other frame silent: 1600 frames hold 800 useful ones.
    expect(validSpeechSeconds(frames(1600, (i) => (i % 2 === 1 ? { vadSpeech: false } : {})))).toBe(8);
  });
});

describe('splitHalfAt', () => {
  it('refuses a second that the valid speech has not reached, and a non-positive or fractional one', () => {
    const f = frames(799);
    expect(splitHalfAt(f, 8)).toBeNull();
    expect(splitHalfAt(f, 0)).toBeNull();
    expect(splitHalfAt(f, 1.5)).toBeNull();
    expect(splitHalfAt(f, 7)).not.toBeNull();
  });

  it('ends the prefix at the last useful frame of the second, with the silent frames between', () => {
    const f = frames(3000, (i) => (i % 3 === 2 ? { vadSpeech: false } : {}));
    const s = splitHalfAt(f, 8);
    expect(s).not.toBeNull();
    // 800 useful frames: two in every three, the 800th is frame 1198.
    expect(s?.prefixFrames).toBe(1199);
    expect(s?.whole.amounts.usefulFrames).toBe(800);
    expect(s?.whole).toEqual(computeDescriptors(f.slice(0, 1199)));
  });

  it('puts the even 1 s blocks in A and the odd ones in B', () => {
    // Block k has f0 = 100 + 10k: A holds 100, 120, 140, 160; B holds 110, 130, 150, 170.
    const f = frames(800, (i) => ({ f0Hz: 100 + 10 * Math.floor(i / 100) }));
    const s = splitHalfAt(f, 8);
    expect(s?.a.amounts.usefulFrames).toBe(400);
    expect(s?.b.amounts.usefulFrames).toBe(400);
    expect(s?.a.raw[0]).toBeCloseTo((Math.log2(120) + Math.log2(140)) / 2, 12);
    expect(s?.b.raw[0]).toBeCloseTo((Math.log2(130) + Math.log2(150)) / 2, 12);
  });

  it('keeps every useful frame of the prefix in exactly one half, A at most one block larger (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 200, maxLength: 2500 }), fc.integer({ min: 1, max: 20 }), (speech, seconds) => {
        const f = speech.map((v, i) => frame(i, { vadSpeech: v }));
        const s = splitHalfAt(f, seconds);
        const reached = f.filter(isUseful).length >= seconds * SPLIT_HALF_BLOCK_FRAMES;
        if (!reached) return s === null;
        if (s === null) return false;
        const a = s.a.amounts.usefulFrames;
        const b = s.b.amounts.usefulFrames;
        return (
          a + b === seconds * SPLIT_HALF_BLOCK_FRAMES &&
          a - b >= 0 &&
          a - b <= SPLIT_HALF_BLOCK_FRAMES &&
          s.whole.amounts.usefulFrames === seconds * SPLIT_HALF_BLOCK_FRAMES
        );
      }),
      { numRuns: 200 },
    );
  });

  it('counts the onsets of the whole prefix, each in the half of its block (none lost at a block edge)', () => {
    // A flux peak every 30 frames, plus frames 99 (end of block 0) and 201
    // (start of block 2): 102 frames apart in the audio, but next to each other
    // once half A is glued together, where the 80 ms distance would drop one.
    const peak = (i: number): boolean => i % 30 === 0 || i === 99 || i === 201;
    const f = frames(1000, (i) => ({ spectralFlux: i === 0 ? null : peak(i) ? 20 : 0.1 }));
    const s = splitHalfAt(f, 10);
    const onsets = detectOnsets(f.slice(0, s?.prefixFrames ?? 0));
    expect(onsets.length).toBe(35);
    expect(onsets).toContain(99);
    expect(onsets).toContain(201);
    expect((s?.a.amounts.onsets ?? 0) + (s?.b.amounts.onsets ?? 0)).toBe(onsets.length);
    const inA = onsets.filter((i) => Math.floor(i / 100) % 2 === 0).length;
    expect(s?.a.amounts.onsets).toBe(inA);
    expect(s?.whole.amounts.onsets).toBe(onsets.length);
  });

  it('applies the SPEC §7.4 minimums to each half (null, never 0)', () => {
    // 8 s of valid speech, onsets far apart: 16 in the prefix, 8 per half (< 20).
    const f = frames(800, (i) => ({ spectralFlux: i === 0 ? null : i % 50 === 25 ? 20 : 0.1 }));
    const s = splitHalfAt(f, 8);
    expect(s?.whole.amounts.onsets).toBe(16);
    expect(s?.a.raw[5]).toBeNull();
    expect(s?.b.raw[5]).toBeNull();
    expect(s?.a.missing).toContain('p6_rhythm');
  });

  it('reports the several-voices heuristic of the prefix', () => {
    // Two pitch groups 10 semitones apart, alternating every second.
    const f = frames(1200, (i) => ({ f0Hz: Math.floor(i / 100) % 2 === 0 ? 120 : 214, spectralCentroidHz: 900 + (i % 7) }));
    const s = splitHalfAt(f, 12);
    expect(s?.speakers.multiSpeakerSuspected).toBe(true);
  });
});

describe('descriptorsWithOnsets', () => {
  it('equals computeDescriptors when given the onsets the frames themselves yield (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ speech: fc.boolean(), f0: fc.double({ min: 50, max: 600, noNaN: true }), flux: fc.double({ min: 0, max: 30, noNaN: true }) }), {
          minLength: 50,
          maxLength: 800,
        }),
        (spec) => {
          const f = spec.map((v, i) => frame(i, { vadSpeech: v.speech, f0Hz: v.f0, spectralFlux: v.flux }));
          expect(descriptorsWithOnsets(f, detectOnsets(f).length)).toEqual(computeDescriptors(f));
        },
      ),
      { numRuns: 100 },
    );
  });
});
