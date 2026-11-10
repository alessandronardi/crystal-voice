// I-04 DoD: `pnpm fixtures` is deterministic (stable WAV hashes). The committed
// manifest and meta files are the reference: this test rebuilds every fixture
// in memory and compares, without needing the (unversioned) WAV files.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFixture, buildManifest, stableJson } from '../../../scripts/fixtures/build.ts';
import { CATALOG } from '../../../scripts/fixtures/catalog.ts';
import { checkFixtures, DEFAULT_FIXTURE_DIR, writeFixtures } from '../../../scripts/fixtures/generate.ts';

describe('fixture determinism', () => {
  const built = CATALOG.map(buildFixture);
  const manifestText = stableJson(buildManifest(CATALOG, built));

  it('a fresh build matches the committed manifest.json and meta files', () => {
    expect(checkFixtures(DEFAULT_FIXTURE_DIR, built, manifestText)).toEqual([]);
  });

  it('two builds in the same process are byte-identical', () => {
    for (const name of ['noise-pink', 'voice-a', 'alternating-ab-v1']) {
      const s = CATALOG.find((x) => x.name === name);
      if (s === undefined) throw new Error(name);
      const a = buildFixture(s);
      const b = buildFixture(s);
      expect(b.sha256).toBe(a.sha256);
      expect(b.metaText).toBe(a.metaText);
    }
  });

  it('meta files contain no clock or machine data', () => {
    for (const b of built) expect(b.metaText).not.toMatch(/\d{4}-\d{2}-\d{2}T|[A-Z]:\\|\/home\//);
  });

  it('written files round-trip through --check', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-fixtures-'));
    try {
      const subset = built.slice(0, 2);
      const text = stableJson(buildManifest(CATALOG.slice(0, 2), subset));
      writeFixtures(dir, subset, text);
      expect(checkFixtures(dir, subset, text)).toEqual([]);
      const first = subset[0];
      if (first === undefined) throw new Error('empty catalog');
      expect(readFileSync(join(dir, `${first.name}.wav`))).toHaveLength(first.wav.byteLength);
      expect(checkFixtures(dir, subset, `${text} `)).toEqual(['manifest.json differs from a fresh build']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
