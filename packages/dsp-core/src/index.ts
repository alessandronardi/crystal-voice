// @voicecrystal/dsp-core — DSP pipeline (SPEC §7, §8).
// Pure package: no chrome.*, DOM, window or Three.js (AGENTS.md R10).
// I-04 adds only shared statistics and a whole-signal summary for the offline
// harness; pitch, VAD and descriptors arrive with I-05/I-06.
export { CLIP_THRESHOLD } from './config.ts';
export { DspInputError, type DspInputErrorCode } from './errors.ts';
export { iqr, median, quantile, quantiles } from './stats.ts';
export { SIGNAL_SUMMARY_VERSION, signalSummary, type SignalSummary } from './signal-summary.ts';
export {
  ACTIVE_FRAME_DBFS,
  ANALYSIS_SAMPLE_RATE,
  CANCELLATION_CAP_DB,
  F0_MAX_HZ,
  F0_MIN_HZ,
  INTONATED_MAX_HZ,
  INTONATED_MIN_CONFIDENCE,
  INTONATED_MIN_HZ,
  PHASE_CANCELLATION_DB,
  PITCH_FRAME_SAMPLES,
  PITCH_HOP_SAMPLES,
  VAD_FRAME_SAMPLES,
  YIN_THRESHOLD,
} from './config.ts';
export { mixToMono, type MonoMix, type MonoRule } from './mono.ts';
export { createResampler, resample, type Resampler } from './resample.ts';
export { frameAt, frameCount } from './frames.ts';
export { yinFrame, type YinResult } from './yin.ts';
export { createBandEnergyPrefilter, PREFILTER_ID, type VadEngine, type VadFrameResult } from './vad.ts';
export { FVAD_MODE, type FvadMode } from './config.ts';
export {
  asFvadExports,
  createWebRtcVad,
  FvadError,
  FVAD_IMPORTS,
  FVAD_WASM_SHA256,
  fvadImportObject,
  instantiateFvad,
  toInt16,
  WEBRTC_VAD_ID,
  type FvadExports,
  type FvadModule,
  type WasmImportDescriptor,
  type WasmRuntime,
  type WebRtcVad,
} from './vad-fvad.ts';
export { PITCH_TRACK_VERSION, trackPitch, type PitchFrame, type PitchTrack } from './pitch-track.ts';
export { createRealFft, type RealFft } from './fft.ts';
export {
  ACOUSTIC_FRAMES_VERSION,
  extractAcousticFrames,
  type AcousticFrame,
  type AcousticFrames,
} from './acoustic-frames.ts';
export {
  computeDescriptors,
  descriptorsWithOnsets,
  detectOnsets,
  isIntonated,
  isUseful,
  type DescriptorAmounts,
  type Descriptors,
  type RawMeasures,
} from './descriptors.ts';
export { SPLIT_HALF_BLOCK_FRAMES, splitHalfAt, validSpeechSeconds, type SplitHalf } from './split-half.ts';
export { SPLIT_HALF_BLOCK_SECONDS, SPLIT_HALF_CONSECUTIVE, SPLIT_HALF_TAU_POINTS, STOP_RULE_VERSION } from './stop-config.ts';
export { assessMusic, peakAutocorrelation, type MusicAssessment } from './music-heuristic.ts';
export { assessSpeakers, bimodalityCoefficient, twoGroupSplit, type SpeakerAssessment } from './speaker-heuristic.ts';
export {
  describeFrames,
  EXTRACTOR_VERSION,
  extractDescriptors,
  MUSIC_EXPOSED,
  qualitySummary,
  type Extraction,
  type ExtractionStatus,
} from './extractor.ts';
