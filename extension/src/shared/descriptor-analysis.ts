// Descriptors and seed of a whole PCM buffer (I-06b): dsp-core's
// extractor-0-experimental with libfvad, and the seed of mapping-0. The same
// function serves the local file (side panel worker) and the tab or
// microphone session at its end (offscreen worker, ADR-0025), and the E2E
// test calls it in Node for the reference. Only numbers and digests leave
// it, never samples (SPEC §9, AGENTS.md R1).
import { MAPPING_0_VERSION, seedFromRaw } from '@voicecrystal/calibration';
import type { CrystalSeed, DescriptorKey, QualitySummary, QualityWarning, RawMeasureTuple, SeedConfidence } from '@voicecrystal/contracts';
import {
  createWebRtcVad,
  describeFrames,
  extractAcousticFrames,
  qualitySummary,
  type FvadModule,
} from '@voicecrystal/dsp-core';

export interface DescriptorAnalysis {
  extractorVersion: string | null;
  mappingVersion: string;
  status: 'OK' | 'INSUFFICIENT_DATA';
  /** x_i; null = not measurable. Through Math.log2/log10: compared in ULP across engines. */
  raw: RawMeasureTuple;
  /** Integer seed of mapping-0, null when the status is INSUFFICIENT_DATA. */
  seed: CrystalSeed | null;
  confidence: SeedConfidence;
  warnings: QualityWarning[];
  missingFeatureKeys: DescriptorKey[];
  veiledKeys: DescriptorKey[];
  quality: QualitySummary;
  /** One byte per 10 ms frame: the VAD decision it took (SHA-256 of the sequence). */
  vadDecisionsSha256: string;
  vadSpeechFrames: number;
  gainDb: number;
  musicShare: number;
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function analyzeDescriptors(
  channels: readonly Float32Array[],
  sampleRate: number,
  fvad: FvadModule,
): Promise<DescriptorAnalysis> {
  const vad = createWebRtcVad(fvad);
  try {
    const frames = extractAcousticFrames(channels, sampleRate, vad);
    const x = describeFrames(frames, vad);
    const decisions = Uint8Array.from(frames.frames, (f) => (f.vadSpeech ? 1 : 0));
    const mapped = x.status === 'OK' ? seedFromRaw(x.raw) : null;
    return {
      extractorVersion: x.extractorVersion,
      mappingVersion: MAPPING_0_VERSION,
      status: x.status,
      raw: x.raw,
      seed: mapped?.seed ?? null,
      confidence: x.confidence,
      warnings: [...x.warnings],
      missingFeatureKeys: [...x.missingFeatureKeys],
      veiledKeys: [...x.veiledKeys],
      quality: qualitySummary(x),
      vadDecisionsSha256: hex(await crypto.subtle.digest('SHA-256', decisions)),
      vadSpeechFrames: x.vad.speechFrames,
      gainDb: x.gainDb,
      musicShare: x.music.share,
    };
  } finally {
    vad.dispose();
  }
}
