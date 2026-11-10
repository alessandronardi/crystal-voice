// SPEC §10 continuity property, sampled (300 pairs). The full 10,000-pair
// measurement is `pnpm bench:continuity` (scripts/golden/continuity.ts).
import { describe, expect, it } from 'vitest';
import { CONTINUITY_THRESHOLD, measureContinuity } from '../../../scripts/golden/continuity.ts';

describe('continuity (SPEC §10, ADR-0005, ADR-0018)', () => {
  // Compute-heavy (~3 s alone): explicit timeout, the 5 s default fails under a full parallel run.
  it('a 100-unit step in one parameter keeps 1 − IoU of the silhouettes ≤ 0.03 [H]', () => {
    for (const s of measureContinuity(300, 7)) expect(s.max).toBeLessThanOrEqual(CONTINUITY_THRESHOLD);
    // Appearance parameters never move the geometry.
    for (const s of measureContinuity(40, 8, [4, 5])) expect(s.max).toBe(0);
  }, 30_000);
});
