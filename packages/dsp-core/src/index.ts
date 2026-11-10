// @voicecrystal/dsp-core — DSP pipeline (SPEC §7, §8).
// Pure package: no chrome.*, DOM, window or Three.js (AGENTS.md R10).
// I-04 adds only shared statistics and a whole-signal summary for the offline
// harness; pitch, VAD and descriptors arrive with I-05/I-06.
export { CLIP_THRESHOLD } from './config.ts';
export { DspInputError, type DspInputErrorCode } from './errors.ts';
export { iqr, median, quantile, quantiles } from './stats.ts';
export { SIGNAL_SUMMARY_VERSION, signalSummary, type SignalSummary } from './signal-summary.ts';
