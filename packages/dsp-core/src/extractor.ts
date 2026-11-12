// Extractor `extractor-0-experimental` (SPEC §7.2–§7.4, I-06a): acoustic
// frames → six raw measures, confidence per parameter, music and several-voices
// warnings, and the INSUFFICIENT_DATA decision. Whole-buffer; the block-wise
// path for tab and microphone is I-06b.
//
// Confidence (SPEC §7.2 D3, ADR-0014, decision D-U):
//   coverage_i   = min(1, amount_i / (2 · minimum_i))   (0.5 exactly at the minimum;
//                  the scarcest requirement when a parameter has two)
//   confidence_i = coverage_i · (1 − musicShare)  for MUSIC_EXPOSED parameters, else coverage_i
//   an unmeasurable parameter has confidence 0 (its measure stays null).
// Status: INSUFFICIENT_DATA if any measure is null or more than
// MAX_VEILED_PARAMETERS have confidence < VEIL_CONFIDENCE (ADR-0014).
// MULTI_SPEAKER_SUSPECTED never lowers confidence: the user answers (SPEC §7.2).
//
// extractorVersion is EXTRACTOR_VERSION only with the canonical VAD (libfvad,
// FVAD_MODE): any other engine (tests, bench) gives null, which the result
// builder must refuse.

import type { DescriptorKey, QualitySummary, QualityWarning, SeedConfidence } from '@voicecrystal/contracts';
import { extractAcousticFrames, type AcousticFrames } from './acoustic-frames.ts';
import {
  FRAME_HOP_SECONDS,
  FVAD_MODE,
  MAX_VEILED_PARAMETERS,
  MIN_INTONATED_SECONDS,
  MIN_ONSETS,
  MIN_USEFUL_SECONDS,
  VEIL_CONFIDENCE,
} from './config.ts';
import { computeDescriptors, type DescriptorAmounts, type RawMeasures } from './descriptors.ts';
import { assessMusic, type MusicAssessment } from './music-heuristic.ts';
import { assessSpeakers, type SpeakerAssessment } from './speaker-heuristic.ts';
import type { VadEngine } from './vad.ts';
import { WEBRTC_VAD_ID } from './vad-fvad.ts';

export const EXTRACTOR_VERSION = 'extractor-0-experimental';

/**
 * Parameters that music moves (D-U, ADR-0024), from the I-06a measurement on
 * voice-music-12db-v1…v5 against voice-a (BENCHMARK_PROTOCOL §7): p2 up to
 * 10 points, p3 up to 20, p6 up to 60, p4 raw ×20 (saturated at 0 on synthetic
 * voices); p1 (≤ 2 points) and p5 (≤ 4) barely move and are not exposed.
 */
export const MUSIC_EXPOSED: ReadonlySet<DescriptorKey> = new Set<DescriptorKey>(['p2_intonation', 'p3_dynamics', 'p4_roughness', 'p6_rhythm']);

const KEYS: readonly DescriptorKey[] = ['p1_pitch', 'p2_intonation', 'p3_dynamics', 'p4_roughness', 'p5_brightness', 'p6_rhythm'];

export type ExtractionStatus = 'OK' | 'INSUFFICIENT_DATA';

export interface Extraction {
  extractorVersion: typeof EXTRACTOR_VERSION | null;
  vad: { id: string; mode: number | null; frames: number; speechFrames: number };
  /** Level normalization gain (D-V), dB. */
  gainDb: number;
  sourceSampleRate: number;
  channelCount: number;
  mono: AcousticFrames['mono'];
  frames: number;
  clippedFrames: number;
  raw: RawMeasures;
  amounts: DescriptorAmounts;
  coverage: SeedConfidence;
  confidence: SeedConfidence;
  missingFeatureKeys: DescriptorKey[];
  veiledKeys: DescriptorKey[];
  music: MusicAssessment;
  speakers: SpeakerAssessment;
  warnings: QualityWarning[];
  status: ExtractionStatus;
}

/** Amount / minimum for each requirement of a parameter; the scarcest one counts (D-V: p3 and p6 also need intonated frames). */
function coverageOf(key: DescriptorKey, amounts: DescriptorAmounts): number {
  const intonated = (amounts.intonatedFrames * FRAME_HOP_SECONDS) / MIN_INTONATED_SECONDS;
  const useful = (amounts.usefulFrames * FRAME_HOP_SECONDS) / MIN_USEFUL_SECONDS;
  const onsets = amounts.onsets / MIN_ONSETS;
  const ratio = (() => {
    switch (key) {
      case 'p1_pitch':
      case 'p2_intonation':
      case 'p4_roughness':
        return intonated;
      case 'p3_dynamics':
        return Math.min(useful, intonated);
      case 'p5_brightness':
        return useful;
      case 'p6_rhythm':
        return Math.min(onsets, intonated);
    }
  })();
  return Math.min(1, ratio / 2);
}

const six = (v: readonly number[]): SeedConfidence => {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = v;
  return [a, b, c, d, e, f];
};

export function extractDescriptors(
  channels: readonly Float32Array[],
  sampleRate: number,
  vad: VadEngine & { readonly mode?: number },
): Extraction {
  const af = extractAcousticFrames(channels, sampleRate, vad);
  const d = computeDescriptors(af.frames);
  const music = assessMusic(af.frames);
  const speakers = assessSpeakers(af.frames);

  const coverage = KEYS.map((key, i) => (d.raw[i] === null ? 0 : coverageOf(key, d.amounts)));
  const confidence = KEYS.map((key, i) => {
    const c = coverage[i] ?? 0;
    return MUSIC_EXPOSED.has(key) ? c * (1 - music.share) : c;
  });
  const veiledKeys = KEYS.filter((_, i) => d.raw[i] !== null && (confidence[i] ?? 0) < VEIL_CONFIDENCE);
  const status: ExtractionStatus = d.missing.length > 0 || veiledKeys.length > MAX_VEILED_PARAMETERS ? 'INSUFFICIENT_DATA' : 'OK';

  const warnings: QualityWarning[] = [...af.mono.warnings];
  if (music.mixedAudioUncertain) warnings.push('MIXED_AUDIO_UNCERTAIN');
  if (speakers.multiSpeakerSuspected) warnings.push('MULTI_SPEAKER_SUSPECTED');
  if (veiledKeys.length > 0) warnings.push('LOW_CONFIDENCE_PARAMETER');
  warnings.push('EXPERIMENTAL_MAPPING');

  const mode = vad.mode ?? null;
  return {
    extractorVersion: vad.id === WEBRTC_VAD_ID && mode === FVAD_MODE ? EXTRACTOR_VERSION : null,
    vad: { id: vad.id, mode, frames: af.vadFrames, speechFrames: af.vadSpeechFrames },
    gainDb: af.gainDb,
    sourceSampleRate: af.sourceSampleRate,
    channelCount: af.channelCount,
    mono: af.mono,
    frames: af.frames.length,
    clippedFrames: af.frames.filter((f) => f.clipped).length,
    raw: d.raw,
    amounts: d.amounts,
    coverage: six(coverage),
    confidence: six(confidence),
    missingFeatureKeys: d.missing,
    veiledKeys,
    music,
    speakers,
    warnings,
    status,
  };
}

/**
 * The SPEC §9 quality summary of an extraction (whole buffer: nothing dropped).
 * Units: `pitchUsableFrames` counts 10 ms acoustic frames (intonated);
 * `vadSpeechFrames` counts 20 ms VAD frames called speech; `validSpeechMs`
 * is the time of the useful 10 ms frames. Fail closed: a run without the
 * canonical extractor (extractorVersion null) is never accepted.
 */
export function qualitySummary(x: Extraction): QualitySummary {
  return {
    accepted: x.status === 'OK' && x.extractorVersion !== null,
    validSpeechMs: Math.round(x.amounts.usefulFrames * FRAME_HOP_SECONDS * 1000),
    pitchUsableFrames: x.amounts.intonatedFrames,
    vadSpeechFrames: x.vad.speechFrames,
    droppedFrames: 0,
    clippedFraction: x.frames > 0 ? x.clippedFrames / x.frames : 0,
    confidence: x.confidence,
    missingFeatureKeys: [...x.missingFeatureKeys],
    warnings: [...x.warnings],
  };
}
