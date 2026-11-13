// Constants of the split-half stopping rule (SPEC §8, ADR-0008, ADR-0026).
// Kept apart from config.ts on purpose: they decide when a capture stops, not
// what the extractor measures, so they never change extractorVersion or a
// seed. Any change here bumps STOP_RULE_VERSION and needs a measured row in
// docs/BENCHMARK_PROTOCOL.md (R15).

export const STOP_RULE_VERSION = 'split-half-0';

/** Valid speech is cut into blocks of this length; even blocks form half A, odd ones half B (SPEC §8). */
export const SPLIT_HALF_BLOCK_SECONDS = 1;
/** Stable when the largest half-to-half difference is at most this, in points 0–100 (SPEC §8). [H] */
export const SPLIT_HALF_TAU_POINTS = 6;
/** Stable evaluations needed in a row, one per second of valid speech (SPEC §8). [H] */
export const SPLIT_HALF_CONSECUTIVE = 3;
