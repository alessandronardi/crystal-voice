// VAD comparison metrics (I-05b, SPEC §7.2, VC-11). Pure functions, unit-tested.
//
// Ground truth per 20 ms VAD frame comes from the fixture's f0 track (one value
// every ~10 ms, null where the synthetic voice is not sounding):
//   - "speech" when every track point inside the frame is voiced,
//   - "pause" when none is,
//   - frames with both, and frames within GUARD_FRAMES of a change, are
//     excluded. The track is sampled every 10 ms and the generator marks as
//     unvoiced the formant ring-out (50 ms), the lower half of the release and
//     of the attack: audible voice energy that no frame-level truth can place
//     exactly (review M-3). The guard keeps only frames well inside a syllable
//     or well inside a pause.
// Fixtures of families without voice are "not speech" in every frame.

/** Frames left out on each side of a speech/pause change: 3 × 20 ms ≥ the 50 ms ring-out. */
export const GUARD_FRAMES = 3;

/** Where a frame's errors are counted. */
export type VadCategory =
  | 'speech' // voice present: a "false" is a false negative
  | 'speech-with-music' // voice + music: false negatives under music
  | 'music-only' // music fixtures, never near a voice: false positives on music
  | 'music-in-pause' // pauses of voice + music: music next to a voice (hangover counts here)
  | 'pause' // pauses of a clean voice: false positives (hangover)
  | 'silence' // digital silence
  | 'tones-noise'; // tones, sweeps, noise, impulses

export const CATEGORIES: readonly VadCategory[] = [
  'speech',
  'speech-with-music',
  'music-only',
  'music-in-pause',
  'pause',
  'silence',
  'tones-noise',
];

export type FrameTruth = boolean | null;

const TONES_NOISE_FAMILIES = ['tone', 'sweep', 'noise', 'impulses'];

/**
 * Families left out of the pooled figures, with the reason (per-fixture shares
 * are still reported):
 *  - antiphase: the mono mix cancels the voice on purpose (ADR-0016), so the
 *    f0 track is not the truth of what the VAD hears;
 *  - a-then-b, alternating-ab: two voices, the meta has no single top-level
 *    f0 track.
 */
export const EXCLUDED_FAMILIES = ['antiphase', 'a-then-b', 'alternating-ab'] as const;

export interface F0Track {
  hopSamples: number;
  valuesHz: readonly (number | null)[];
}

/**
 * Truth of each VAD frame. `frameSeconds` is the VAD frame length (0.02 s);
 * track points are at `i · hopSamples / sampleRate` seconds.
 */
export function frameTruths(track: F0Track, sampleRate: number, frames: number, frameSeconds: number, guard = GUARD_FRAMES): FrameTruth[] {
  if (!(track.hopSamples > 0) || !(sampleRate > 0) || !(frameSeconds > 0) || !(guard >= 0)) throw new RangeError('bad track geometry');
  const hopSeconds = track.hopSamples / sampleRate;
  const raw: FrameTruth[] = [];
  for (let k = 0; k < frames; k++) {
    // Points i with k·F ≤ i·H < (k+1)·F.
    const first = Math.ceil((k * frameSeconds) / hopSeconds - 1e-9);
    const last = Math.ceil(((k + 1) * frameSeconds) / hopSeconds - 1e-9) - 1;
    // A frame that reaches past the track has no complete truth.
    if (first < 0 || last >= track.valuesHz.length || last < first) {
      raw.push(null);
      continue;
    }
    let voiced = 0;
    for (let i = first; i <= last; i++) if (track.valuesHz[i] !== null) voiced++;
    const total = last - first + 1;
    raw.push(voiced === total ? true : voiced === 0 ? false : null);
  }
  // Guard band: a frame counts only if every frame within `guard` has the same truth.
  return raw.map((t, k) => {
    if (t === null) return null;
    for (let j = Math.max(0, k - guard); j <= Math.min(raw.length - 1, k + guard); j++) if (raw[j] !== t) return null;
    return t;
  });
}

/** Category of a frame of a fixture of this family, or null when it is not counted. */
export function categoryOf(family: string, truth: FrameTruth): VadCategory | null {
  if ((EXCLUDED_FAMILIES as readonly string[]).includes(family)) return null;
  if (family === 'music') return 'music-only';
  if (family === 'silence') return 'silence';
  if (TONES_NOISE_FAMILIES.includes(family)) return 'tones-noise';
  if (truth === null) return null;
  if (family === 'voice-music') return truth ? 'speech-with-music' : 'music-in-pause';
  return truth ? 'speech' : 'pause';
}

export interface Tally {
  frames: number;
  /** Frames the engine called speech. */
  speech: number;
}

export type CategoryTallies = Record<VadCategory, Tally>;

export function emptyTallies(): CategoryTallies {
  return Object.fromEntries(CATEGORIES.map((c) => [c, { frames: 0, speech: 0 }])) as CategoryTallies;
}

/** Adds one fixture's decisions; truths and decisions are per frame, same length. */
export function addDecisions(
  tallies: CategoryTallies,
  family: string,
  truths: readonly FrameTruth[],
  decisions: readonly boolean[],
): void {
  if (truths.length !== decisions.length) throw new RangeError('truths and decisions differ in length');
  for (let k = 0; k < decisions.length; k++) {
    const c = categoryOf(family, truths[k] ?? null);
    if (c === null) continue;
    tallies[c].frames++;
    if (decisions[k]) tallies[c].speech++;
  }
}

export interface VadRates {
  /** Speech frames called "not speech". */
  falseNegativeVoice: number | null;
  falseNegativeVoiceWithMusic: number | null;
  /** Music-only frames called "speech". */
  falsePositiveMusicOnly: number | null;
  /** Music frames between syllables of a voice called "speech" (hangover included). */
  falsePositiveMusicInPause: number | null;
  falsePositivePause: number | null;
  falsePositiveSilence: number | null;
  falsePositiveTonesNoise: number | null;
}

const share = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);
const fn = (t: Tally): number | null => share(t.frames - t.speech, t.frames);
const fp = (t: Tally): number | null => share(t.speech, t.frames);

export function rates(t: CategoryTallies): VadRates {
  return {
    falseNegativeVoice: fn(t.speech),
    falseNegativeVoiceWithMusic: fn(t['speech-with-music']),
    falsePositiveMusicOnly: fp(t['music-only']),
    falsePositiveMusicInPause: fp(t['music-in-pause']),
    falsePositivePause: fp(t.pause),
    falsePositiveSilence: fp(t.silence),
    falsePositiveTonesNoise: fp(t['tones-noise']),
  };
}
