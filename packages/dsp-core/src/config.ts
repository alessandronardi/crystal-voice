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

// --- WebRTC VAD (libfvad, I-05b) --------------------------------------------

/** libfvad aggressiveness: 0 = quality … 3 = very aggressive. */
export type FvadMode = 0 | 1 | 2 | 3;
/**
 * Mode used by default. [H] — proposed in ADR-0023 from `pnpm bench:vad`
 * (2026-11-12, BENCHMARK_PROTOCOL §7). Every mode calls 100% of music-only
 * frames speech; mode 3 only shortens the hangover next to a voice and loses
 * 6.6% of voice frames under music (mode 2: 0.0%). Music is not the VAD's job
 * (ADR-0023): mode 2 keeps the voice. To be revised at G1 on real data.
 */
export const FVAD_MODE: FvadMode = 2;

// --- Spectral features of the acoustic frames (SPEC §7.3, I-06) -------------

/** FFT size for the 640-sample pitch frame, zero-padded (15.625 Hz bins at 16 kHz). */
export const SPECTRAL_FFT_SIZE = 1024;
/** Band of the spectral centroid, flatness and flux (SPEC §7.4, p5). */
export const SPECTRAL_LOW_HZ = 300;
export const SPECTRAL_HIGH_HZ = 4000;

// --- Level normalization (D-V, ADR-0024) ------------------------------------

/**
 * One gain for the whole analysis signal brings the P95 of its 20 ms frame
 * RMS (frames with energy) to this level, before VAD and frames. [H] —
 * D-V: makes the descriptors independent of recording gain (BACKLOG I-06
 * invariance ±6 dB); "−60 dBFS" of the useful frame is then relative to it.
 */
export const NORMALIZE_TARGET_DBFS = -20;
/** Largest amplification, so that dither or hiss alone is not raised to speech level. [H] */
export const NORMALIZE_MAX_GAIN_DB = 40;

// --- Six descriptors EXPERIMENTAL v0 (SPEC §7.4, I-06) ---------------------

/** Seconds per acoustic frame step (10 ms). */
export const FRAME_HOP_SECONDS = PITCH_HOP_SAMPLES / ANALYSIS_SAMPLE_RATE;
/** "Useful frame": VAD speech, not clipped, level above this. [H] */
export const USEFUL_MIN_DBFS = -60;
/** Minimum amounts per descriptor (SPEC §7.4). [H] */
export const MIN_INTONATED_SECONDS = 2;
export const MIN_USEFUL_SECONDS = 4;
export const MIN_ONSETS = 20;
/** Onsets: peaks of the spectral flux at least 80 ms apart (SPEC §7.4). */
export const ONSET_MIN_DISTANCE_SECONDS = 0.08;
/**
 * Onset threshold on the flux divided by the median band magnitude of the
 * useful frames (a gain-free scale). [H] — I-06a exploration on the fixtures:
 * 22 onsets on voice-a (29 syllables), 7 on white noise, 1 on chords.
 */
export const ONSET_FLUX_THRESHOLD = 0.3;

// --- Music heuristic (SPEC §7.2) ---------------------------------------------

/** Cue 1, stable pitch: f0 within ±25 cents … [H] */
export const MUSIC_STABLE_CENTS = 25;
/** … over at least this many consecutive frames (21 × 10 ms: more than 200 ms). [H] */
export const MUSIC_STABLE_MIN_FRAMES = 21;
/** Cue 2, sustained harmonic energy without a single pitch: useful, not intonated, flatness below this … [H] */
export const MUSIC_HARMONIC_MAX_FLATNESS = 0.05;
/** … in runs of at least this many frames (200 ms). [H] */
export const MUSIC_HARMONIC_MIN_FRAMES = 20;
/** Cue 3, periodic flux: autocorrelation of the flux in windows of this length … [H] */
export const MUSIC_FLUX_WINDOW_SECONDS = 4;
/** … at lags in this range … [H] */
export const MUSIC_FLUX_MIN_LAG_SECONDS = 0.3;
export const MUSIC_FLUX_MAX_LAG_SECONDS = 2;
/** … above this normalized value. [H] */
export const MUSIC_FLUX_PERIODICITY = 0.5;
/** MIXED_AUDIO_UNCERTAIN above this share of useful frames with a music cue (SPEC §7.2). [H] */
export const MUSIC_SHARE_THRESHOLD = 0.2;

// --- Several-voices heuristic (SPEC §7.2, D-T) ---------------------------------

/** Bimodality coefficient of log2(f0) above this … (SPEC §7.2) [H] */
export const SPEAKER_BIMODALITY = 0.555;
/** … on at least this much intonated voice (SPEC §7.2) [H] */
export const SPEAKER_MIN_SECONDS = 4;
/** … and the two pitch groups at least this far apart (D-T, ADR-0024). [H] */
export const SPEAKER_MIN_GAP_SEMITONES = 6;
/** … with the smaller group holding at least this share (D-T). [H] */
export const SPEAKER_MIN_GROUP_SHARE = 0.2;
/** Centroid criterion: blocks of this much useful voice … (SPEC §7.2) */
export const SPEAKER_BLOCK_SECONDS = 1;
/** … a jump is a change of the block median centroid above this, in octaves … [H] */
export const SPEAKER_CENTROID_JUMP_OCTAVES = 0.3;
/** … "repeated" = at least this share of block transitions, with at least SPEAKER_MIN_TRANSITIONS. [H] */
export const SPEAKER_MIN_JUMP_SHARE = 0.6;
export const SPEAKER_MIN_TRANSITIONS = 4;

// --- Confidence per parameter (SPEC §7.2 D3, ADR-0014, D-U) ------------------

/** Below this a trait is veiled (ADR-0014). [H] */
export const VEIL_CONFIDENCE = 0.5;
/** INSUFFICIENT_DATA if more than this many traits are veiled (ADR-0014). */
export const MAX_VEILED_PARAMETERS = 2;

// --- Band-energy pre-filter (diagnostic only, SPEC §7.2) ---------------------

export const PREFILTER_LOW_HZ = 85;
export const PREFILTER_HIGH_HZ = 3400;
/** Minimum frame RMS for the pre-filter to say "speech-like". [H] */
export const PREFILTER_MIN_DBFS = -50;
/** Minimum share of energy inside the band. [H] */
export const PREFILTER_MIN_BAND_RATIO = 0.6;
