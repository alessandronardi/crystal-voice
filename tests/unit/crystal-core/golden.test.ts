// Golden seeds in Node (I-10): the 1,000 hashes in
// tests/fixtures/seeds/golden-habit-1.json must be reproduced exactly.
// Browsers: tests/golden-browsers/golden.spec.ts (`pnpm test:golden:browsers`).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeGolden, goldenPath, GOLDEN_COUNT, serializeGolden } from '../../../scripts/golden/seeds.ts';

describe('golden seeds habit-1', () => {
  // Compute-heavy (~3 s alone): explicit timeout, the 5 s default fails under a full parallel run.
  it('reproduces the committed file byte for byte', () => {
    const fresh = computeGolden('habit-1');
    expect(fresh.count).toBe(GOLDEN_COUNT);
    expect(serializeGolden(fresh)).toBe(readFileSync(goldenPath('habit-1'), 'utf8'));
  }, 30_000);
});
