// VAD comparison metrics (I-05b, SPEC §7.2, VC-11). Pure functions, unit-tested.
//
// Ground truth per 20 ms VAD frame comes from the fixture's f0 track (one value
// every ~10 ms, null where the synthetic voice is not sounding):
//   - "speech" when every track point inside the frame is voiced,
//   - "silence of voice" when none is,
//   - mixed frames (a syllable edge) are excluded: neither answer is wrong.
// Fixtures of families without voice are "not speech" in every frame.

/** Where a frame's errors are counted. */
export type VadCategory =
  | 'speech' // voice present: a "false" is a false negative
  | 'speech-with-music' // voice + music: false negatives under music
  | 'music' // music only (music fixtures, pauses of voice + music): false positives on music
  | 'pause' // pauses of a clean voice: false positives (hangover)
  | 'non-speech'; // silence, tones, sweeps, noise, impulses: false positives

export type FrameTruth = boolean | null;

/** Families whose fixtures contain no voice at all. */
export const NO_VOICE_FAMILIES = ['silence', 'tone', 'sweep', 'noise', 'impulses', 'music'] as const;
/**
 * Families left out of the pooled figures, with the reason (reported per fixture):
 *  - antiphase: the mono mix cancels the voice on purpose (ADR-0016), so the
 *    f0 track is not the truth of what the VAD hears;
 *  - a-then-b: two voices, the meta has no single top-level f0 track.
 */
export const EXCLUDED_FAMILIES = ['antiphase', 'a-then-b'] as const;

export interface F0Track {
  hopSamples: number;
  valuesHz: readonly (number | null)[];
}

/**
 * Truth of each VAD frame. `frameSeconds` is the VAD frame length (0.02 s);
 * track points are at `i · hopSamples / sampleRate` seconds.
 */
export function frameTruths(track: F0Track, sampleRate: number, frames: number, frameSeconds: number): FrameTruth[] {
  if (!(track.hopSamples > 0) || !(sampleRate > 0) || !(frameSeconds > 0)) throw new RangeError('bad track geometry');
  const hopSeconds = track.hopSamples / sampleRate;
  const out: FrameTruth[] = [];
  for (let k = 0; k < frames; k++) {
    // Integer arithmetic on indices: points i with k·F ≤ i·H < (k+1)·F.
    const first = Math.ceil((k * frameSeconds) / hopSeconds - 1e-9);
    const last = Math.ceil(((k + 1) * frameSeconds) / hopSeconds - 1e-9) - 1;
    // A frame that reaches past the track has no complete truth.
    if (first < 0 || last >= track.valuesHz.length || last < first) {
      out.push(null);
      continue;
    }
    let voiced = 0;
    for (let i = first; i <= last; i++) if (track.valuesHz[i] !== null) voiced++;
    const total = last - first + 1;
    out.push(voiced === total ? true : voiced === 0 ? false : null);
  }
  return out;
}

/** Category of a frame of a fixture of this family, or null when it is not counted. */
export function categoryOf(family: string, truth: FrameTruth): VadCategory | null {
  if ((EXCLUDED_FAMILIES as readonly string[]).includes(family)) return null;
  if (family === 'music') return 'music';
  if ((NO_VOICE_FAMILIES as readonly string[]).includes(family)) return 'non-speech';
  if (truth === null) return null;
  if (family === 'voice-music') return truth ? 'speech-with-music' : 'music';
  return truth ? 'speech' : 'pause';
}

export interface Tally {
  frames: number;
  /** Frames the engine called speech. */
  speech: number;
}

export type CategoryTallies = Record<VadCategory, Tally>;

export function emptyTallies(): CategoryTallies {
  return {
    speech: { frames: 0, speech: 0 },
    'speech-with-music': { frames: 0, speech: 0 },
    music: { frames: 0, speech: 0 },
    pause: { frames: 0, speech: 0 },
    'non-speech': { frames: 0, speech: 0 },
  };
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
  falsePositiveMusic: number | null;
  falsePositivePause: number | null;
  falsePositiveNonSpeech: number | null;
}

const share = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

export function rates(t: CategoryTallies): VadRates {
  return {
    falseNegativeVoice: share(t.speech.frames - t.speech.speech, t.speech.frames),
    falseNegativeVoiceWithMusic: share(t['speech-with-music'].frames - t['speech-with-music'].speech, t['speech-with-music'].frames),
    falsePositiveMusic: share(t.music.speech, t.music.frames),
    falsePositivePause: share(t.pause.speech, t.pause.frames),
    falsePositiveNonSpeech: share(t['non-speech'].speech, t['non-speech'].frames),
  };
}
