// Golden plates in Node (I-12): the SHA-256 of the 3,000 plates in
// tests/fixtures/plates/golden-plates-habit-1.json must be reproduced exactly,
// and every plate stays inside its frame.
// Browsers: tests/golden-browsers/plates.spec.ts (`pnpm test:golden:browsers`).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLATE_PRESETS } from '@voicecrystal/contracts';
import { computeGoldenPlates, goldenPlatesPath, plateSvg, serializeGoldenPlates } from '../../../scripts/golden/plates.ts';
import { goldenSeeds } from '../../../scripts/golden/seeds.ts';

describe('golden plates habit-1', () => {
  it('reproduces the committed file byte for byte', () => {
    const fresh = computeGoldenPlates('habit-1');
    expect(fresh.count).toBe(1000);
    expect(serializeGoldenPlates(fresh)).toBe(readFileSync(goldenPlatesPath('habit-1'), 'utf8'));
  }, 60_000);

  it('keeps every golden plate inside the 512 px frame', () => {
    let coords = 0;
    for (const seed of goldenSeeds()) {
      for (const preset of PLATE_PRESETS) {
        for (const m of plateSvg(seed, preset).matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) {
          for (const c of [Number(m[1]), Number(m[2])]) {
            coords++;
            expect(c >= 0 && c <= 512, `${JSON.stringify(seed)} ${preset}: ${c}`).toBe(true);
          }
        }
      }
    }
    expect(coords).toBeGreaterThan(3000 * 20);
  }, 60_000);
});
