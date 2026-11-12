// The committed mapping-0 table is exactly the generator's output (SPEC §7.5).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildMapping0, MAPPING_0_PATH } from '../../scripts/calibration/build-mapping-0.ts';

describe('mapping-0-experimental.json', () => {
  it('is the committed output of scripts/calibration/build-mapping-0.ts', () => {
    expect(readFileSync(MAPPING_0_PATH, 'utf8').replace(/\r\n/g, '\n')).toBe(buildMapping0());
  });
});
