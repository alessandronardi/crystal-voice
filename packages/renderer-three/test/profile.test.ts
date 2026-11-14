import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { chooseProfile, FRAME_COST_P95_LIMIT_MS, frameCostP95, isSoftwareRenderer, PROFILE_SAMPLE_FRAMES, type ProfileInput } from '../src/pure/index.ts';

const fast = (): number[] => Array.from({ length: PROFILE_SAMPLE_FRAMES }, () => 5);
const base: ProfileInput = { userSimplified: false, rendererName: 'ANGLE (AMD, AMD Radeon(TM) RX Vega 10 Graphics)', majorPerformanceCaveat: false, frameCostsMs: null };

describe('chooseProfile (I-13b, D-AN)', () => {
  it('keeps vetrina on a hardware GPU before any frame', () => {
    expect(chooseProfile(base)).toEqual({ profile: 'vetrina', reason: 'DEFAULT' });
  });

  it('keeps vetrina when the first frames are fast (M17 reference: p95 4.7–6.1 ms)', () => {
    expect(chooseProfile({ ...base, frameCostsMs: fast() })).toEqual({ profile: 'vetrina', reason: 'DEFAULT' });
  });

  it('chooses economy for software rasterizers', () => {
    for (const name of ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', 'llvmpipe (LLVM 17.0.6, 256 bits)', 'Microsoft Basic Render Driver']) {
      expect(isSoftwareRenderer(name)).toBe(true);
      expect(chooseProfile({ ...base, rendererName: name })).toEqual({ profile: 'economy', reason: 'SOFTWARE_GPU' });
    }
    expect(isSoftwareRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)')).toBe(false);
  });

  it('an unreadable GPU name is not a reason by itself', () => {
    expect(chooseProfile({ ...base, rendererName: null })).toEqual({ profile: 'vetrina', reason: 'DEFAULT' });
  });

  it('chooses economy when the context with failIfMajorPerformanceCaveat cannot be created', () => {
    expect(chooseProfile({ ...base, majorPerformanceCaveat: true })).toEqual({ profile: 'economy', reason: 'MAJOR_PERFORMANCE_CAVEAT' });
    // A software GPU fails that context too: its name is the reason shown (CI, Linux SwiftShader).
    expect(chooseProfile({ ...base, majorPerformanceCaveat: true, rendererName: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)' }).reason).toBe('SOFTWARE_GPU');
  });

  it('chooses economy when the p95 of the first frames is over the limit, not at it', () => {
    const at = Array.from({ length: PROFILE_SAMPLE_FRAMES }, () => FRAME_COST_P95_LIMIT_MS);
    expect(chooseProfile({ ...base, frameCostsMs: at }).profile).toBe('vetrina');
    const over = Array.from({ length: PROFILE_SAMPLE_FRAMES }, () => FRAME_COST_P95_LIMIT_MS + 0.1);
    expect(chooseProfile({ ...base, frameCostsMs: over })).toEqual({ profile: 'economy', reason: 'SLOW_FRAMES' });
  });

  it('one slow frame (a shader compile) does not switch', () => {
    const one = fast();
    one[0] = 400;
    expect(chooseProfile({ ...base, frameCostsMs: one }).profile).toBe('vetrina');
  });

  it('too few frames are not a measure', () => {
    const few = Array.from({ length: PROFILE_SAMPLE_FRAMES - 1 }, () => 100);
    expect(frameCostP95(few)).toBeNull();
    expect(chooseProfile({ ...base, frameCostsMs: few }).profile).toBe('vetrina');
  });

  it('uses the same quantile as bench:render (M17)', () => {
    const values = Array.from({ length: 30 }, (_, i) => i + 1); // 1..30
    // floor(0.95 * 29) = 27 → the 28th value
    expect(frameCostP95(values)).toBe(28);
  });

  it('the user preference always gives economy (property)', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string(), { nil: null }),
        fc.boolean(),
        fc.option(fc.array(fc.double({ min: 0, max: 1000, noNaN: true }), { maxLength: 40 }), { nil: null }),
        (rendererName, majorPerformanceCaveat, frameCostsMs) => {
          expect(chooseProfile({ userSimplified: true, rendererName, majorPerformanceCaveat, frameCostsMs })).toEqual({ profile: 'economy', reason: 'USER_SIMPLIFIED' });
        },
      ),
    );
  });
});
