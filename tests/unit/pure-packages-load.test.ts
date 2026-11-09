// R10: every pure package must load in plain Node, with no DOM or chrome.*
// globals present. If a pure package touched `window` or `chrome` at import
// time, the dynamic import below would throw.
import { describe, expect, it } from 'vitest';

const PURE_PACKAGES = [
  '@voicecrystal/contracts',
  '@voicecrystal/dsp-core',
  '@voicecrystal/calibration',
  '@voicecrystal/crystal-core',
  '@voicecrystal/renderer-svg',
  '@voicecrystal/comparator',
] as const;

describe('pure packages', () => {
  it('run in an environment without DOM or chrome globals', () => {
    expect('window' in globalThis).toBe(false);
    expect('document' in globalThis).toBe(false);
    expect('chrome' in globalThis).toBe(false);
  });

  it.each(PURE_PACKAGES)('%s loads in Node', async (name) => {
    await expect(import(name)).resolves.toBeTypeOf('object');
  });
});
