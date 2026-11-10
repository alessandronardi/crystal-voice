// Smoke test of the offline harness (I-04): a few small fixtures in a temp
// directory, then runBench must produce a report with the fields required by
// BENCHMARK_PROTOCOL §1 and fail loudly on missing or tampered files.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildFixture, buildManifest, selectSpecs, stableJson } from '../../scripts/fixtures/build.ts';
import { writeFixtures } from '../../scripts/fixtures/generate.ts';
import { BenchError, describeEnvironment, runBench } from '../benchmarks/harness.ts';

const specs = selectSpecs(['silence', 'tone-200hz', 'voice-a-antiphase']);
const built = specs.map(buildFixture);
const manifestText = stableJson(buildManifest(specs, built));
const dir = mkdtempSync(join(tmpdir(), 'vc-bench-'));
writeFixtures(dir, built, manifestText);
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('bench harness', () => {
  it('reports environment, per-fixture summaries and timing', () => {
    const report = runBench(dir, describeEnvironment(new Date('2026-11-10T00:00:00Z')));
    expect(report.environment.node).toBe(process.version);
    expect(report.environment.date).toBe('2026-11-10T00:00:00.000Z');
    expect(report.environment.extractorVersion).toBeNull();
    expect(report.environment.analyzers).toEqual(['signal-summary-0']);
    expect(report.totals.fixtures).toBe(3);
    const byName = Object.fromEntries(report.fixtures.map((f) => [f.name, f]));
    expect(byName['silence']?.channels[0]?.rmsDbfs).toBeNull();
    expect(byName['tone-200hz']?.channels[0]?.rmsDbfs).toBeCloseTo(-12, 1);
    expect(byName['voice-a-antiphase']?.channels).toHaveLength(2);
    for (const f of report.fixtures) {
      expect(Number.isFinite(f.secondsPerAudioSecond)).toBe(true);
      expect(f.durationSeconds).toBeGreaterThan(0);
    }
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it('fails on a tampered WAV', () => {
    const tampered = mkdtempSync(join(tmpdir(), 'vc-bench-bad-'));
    try {
      writeFixtures(tampered, built, manifestText);
      writeFileSync(join(tampered, 'silence.wav'), new Uint8Array([1, 2, 3]));
      expect(() => runBench(tampered, describeEnvironment(new Date()))).toThrow(BenchError);
    } finally {
      rmSync(tampered, { recursive: true, force: true });
    }
  });

  it('fails when the manifest is missing', () => {
    expect(() => runBench(join(dir, 'nope'), describeEnvironment(new Date()))).toThrow(BenchError);
  });
});
