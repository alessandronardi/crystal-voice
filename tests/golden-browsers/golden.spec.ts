// I-10 DoD: geometryHash of the 1,000 golden seeds identical in Node, Chrome
// and Firefox (SPEC §10, ADR-0010). crystal-core is bundled with Vite into one
// IIFE, injected into about:blank, and asked for the hashes of the seeds in
// tests/fixtures/seeds/golden-habit-1.json.
//   pnpm test:golden:browsers                     chromium and firefox
//   pnpm test:golden:browsers --project=chromium   chromium only (local default)

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { build } from 'vite';

interface GoldenFile {
  geometryVersion: string;
  entries: { seed: number[]; hash: string }[];
}

const ROOT = resolve(import.meta.dirname, '../..');
const golden = JSON.parse(readFileSync(resolve(ROOT, 'tests/fixtures/seeds/golden-habit-1.json'), 'utf8')) as GoldenFile;

// Both a plain and a minified bundle: the extension ships minified code, and
// a minifier must not change the arithmetic (review I-10, L3).
const bundles: Record<'plain' | 'minified', string> = { plain: '', minified: '' };

async function bundleCore(minify: boolean): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    root: ROOT,
    build: {
      write: false,
      minify,
      lib: { entry: resolve(ROOT, 'packages/crystal-core/src/index.ts'), formats: ['iife'], name: 'VoiceCrystalCore' },
    },
  });
  let code = '';
  const outputs = Array.isArray(result) ? result : [result];
  for (const out of outputs) {
    if ('output' in out) {
      for (const chunk of out.output) if (chunk.type === 'chunk') code += chunk.code;
    }
  }
  return code;
}

test.beforeAll(async () => {
  bundles.plain = await bundleCore(false);
  bundles.minified = await bundleCore(true);
  expect(bundles.plain.length).toBeGreaterThan(1000);
  expect(bundles.minified.length).toBeLessThan(bundles.plain.length);
});

for (const kind of ['plain', 'minified'] as const) test(`golden geometryHash identical to Node (${kind} bundle)`, async ({ page, browserName }) => {
  test.setTimeout(120_000);
  await page.goto('about:blank');
  await page.addScriptTag({ content: bundles[kind] });
  const seeds = golden.entries.map((e) => e.seed);
  const hashes = await page.evaluate(
    ({ seeds, version }) => {
      const core = (globalThis as unknown as {
        VoiceCrystalCore: { generateCrystalGeometry: (s: number[], c: number[], v: string) => { geometryHash: string } };
      }).VoiceCrystalCore;
      return seeds.map((s) => core.generateCrystalGeometry(s, [1, 1, 1, 1, 1, 1], version).geometryHash);
    },
    { seeds, version: golden.geometryVersion },
  );
  const mismatches = hashes.flatMap((h, i) => (h === golden.entries[i]?.hash ? [] : [i]));
  expect(mismatches, `${browserName} (${kind}): seeds with a different hash`).toEqual([]);
  expect(hashes).toHaveLength(1000);
});
