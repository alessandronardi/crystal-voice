// Choice of the showcase profile (I-13b, BACKLOG I-13 DoD). Pure.
//
// Economy when the user asked for it («Resa semplificata»), when the context
// with failIfMajorPerformanceCaveat cannot be created, when the GPU is a
// software rasterizer, or when the first frames of the vetrina cost too much.
// The GPU name is an input read in memory only: it is never stored, logged or
// sent (decision of the product owner, 2026-11-10).
import type { RenderProfile } from './look.ts';

/** [H] p95 of the cost of frames 2–31 of the vetrina, ms (D-AN, BENCHMARK_PROTOCOL §7; M17 reference p95 4.7–6.1 ms). */
export const FRAME_COST_P95_LIMIT_MS = 33;
/** Frames measured after the first one (which includes shader compilation). */
export const PROFILE_SAMPLE_FRAMES = 30;

export type ProfileReason = 'USER_SIMPLIFIED' | 'MAJOR_PERFORMANCE_CAVEAT' | 'SOFTWARE_GPU' | 'SLOW_FRAMES' | 'DEFAULT';

export interface ProfileInput {
  /** The «Resa semplificata» option. */
  userSimplified: boolean;
  /** WebGL unmasked renderer string; null when the browser does not expose it. */
  rendererName: string | null;
  /** True when a context with failIfMajorPerformanceCaveat could not be created. */
  majorPerformanceCaveat: boolean;
  /** Cost of frames 2–31 of the vetrina (render + 1-pixel readPixels, as M17); null before the measure. */
  frameCostsMs: readonly number[] | null;
}

export interface ProfileChoice {
  profile: RenderProfile;
  reason: ProfileReason;
}

/** The same rule as tests/benchmarks/render.ts (M17). */
export const isSoftwareRenderer = (name: string): boolean => /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);

/** p95 with the quantile of bench:render; null with fewer than PROFILE_SAMPLE_FRAMES values. */
export function frameCostP95(costs: readonly number[]): number | null {
  if (costs.length < PROFILE_SAMPLE_FRAMES) return null;
  const s = [...costs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(0.95 * (s.length - 1)))] ?? null;
}

export function chooseProfile(input: ProfileInput): ProfileChoice {
  if (input.userSimplified) return { profile: 'economy', reason: 'USER_SIMPLIFIED' };
  // A software rasterizer also fails the major-performance-caveat context (measured in CI, Linux
  // SwiftShader, 2026-11-14): its name, when readable, is the clearer reason, so it comes first.
  if (input.rendererName !== null && isSoftwareRenderer(input.rendererName)) return { profile: 'economy', reason: 'SOFTWARE_GPU' };
  if (input.majorPerformanceCaveat) return { profile: 'economy', reason: 'MAJOR_PERFORMANCE_CAVEAT' };
  const p95 = input.frameCostsMs === null ? null : frameCostP95(input.frameCostsMs);
  if (p95 !== null && p95 > FRAME_COST_P95_LIMIT_MS) return { profile: 'economy', reason: 'SLOW_FRAMES' };
  return { profile: 'vetrina', reason: 'DEFAULT' };
}
