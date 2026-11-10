// Single home for dsp-core thresholds (packages/dsp-core/CLAUDE.md). [H]
// values change only with a measurement recorded in docs/BENCHMARK_PROTOCOL.md
// or a gate report (AGENTS.md R15).

/** |sample| at or above this is counted as clipped: int16 full scale, 32767/32768. */
export const CLIP_THRESHOLD = 32767 / 32768;
