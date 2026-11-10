// Single home for dsp-core thresholds (packages/dsp-core/CLAUDE.md). [H]
// values change only with a measurement recorded in docs/BENCHMARK_PROTOCOL.md
// or a gate report (AGENTS.md R15).

/** |sample| at or above this is counted as clipped: int16 full scale, 32767/32768. */
export const CLIP_THRESHOLD = 32767 / 32768;

/** Analysis sample rate for VAD and pitch (SPEC §7.1). */
export const ANALYSIS_SAMPLE_RATE = 16000;

// --- Mono mix (ADR-0016) ---------------------------------------------------

/** Frame length for the phase-cancellation check, in seconds. */
export const MONO_CHECK_FRAME_SECONDS = 0.02;
/** A frame is "active" when its loudest channel exceeds this RMS. [H] */
export const ACTIVE_FRAME_DBFS = -60;
/** Median cancellation above this declares PHASE_CANCELLATION. [H] */
export const PHASE_CANCELLATION_DB = 20;
/** Cancellation reported for a frame whose mono mix is digital silence (int16 range ≈ 96 dB). */
export const CANCELLATION_CAP_DB = 120;

// --- Resampling --------------------------------------------------------------

/** Pass-band edge as a fraction of the output Nyquist frequency. */
export const RESAMPLE_CUTOFF = 0.9;
/** Kernel half-width in output-rate zero crossings. */
export const RESAMPLE_HALF_TAPS = 32;
/** Kaiser window β (≈ 90 dB side-lobe attenuation). */
export const RESAMPLE_KAISER_BETA = 9;

// --- Framing -----------------------------------------------------------------

/** VAD frames: 20 ms at 16 kHz, no overlap (SPEC §7.2). */
export const VAD_FRAME_SAMPLES = 320;
/** Pitch frames: 40 ms window (≥ 2 periods at 60 Hz), 10 ms hop. */
export const PITCH_FRAME_SAMPLES = 640;
export const PITCH_HOP_SAMPLES = 160;

// --- YIN (SPEC §7.4, ADR-0017) ----------------------------------------------

/** Absolute threshold on the cumulative mean normalized difference. [H] */
export const YIN_THRESHOLD = 0.15;
/** Estimator range: up to 1100 Hz so that singing is measured, not null (ADR-0017). */
export const F0_MIN_HZ = 60;
export const F0_MAX_HZ = 1100;
/** YIN looks for dips down to this period, so pitches above F0_MAX_HZ are recognised and rejected. */
export const YIN_SEARCH_MAX_HZ = 2200;
/** "Intonated frame" range for the descriptors (SPEC §7.4) — narrower than the estimator range. [H] */
export const INTONATED_MIN_HZ = 60;
export const INTONATED_MAX_HZ = 500;
/** Relative tolerance on the range edges: interpolation may land just past 500 or 60 Hz. */
export const F0_RANGE_TOLERANCE = 0.005;
/** Pitch confidence for an "intonated" frame (SPEC §7.4). [H] */
export const INTONATED_MIN_CONFIDENCE = 0.8;

// --- Band-energy pre-filter (diagnostic only, SPEC §7.2) ---------------------

export const PREFILTER_LOW_HZ = 85;
export const PREFILTER_HIGH_HZ = 3400;
/** Minimum frame RMS for the pre-filter to say "speech-like". [H] */
export const PREFILTER_MIN_DBFS = -50;
/** Minimum share of energy inside the band. [H] */
export const PREFILTER_MIN_BAND_RATIO = 0.6;
