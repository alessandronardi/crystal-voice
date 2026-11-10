// I-12 DoD: the SVG plate of every golden seed is byte-identical between Node
// and browsers (ADR-0013), and is valid SVG. crystal-core and renderer-svg
// are bundled with Vite into one IIFE (plain and minified), injected into
// about:blank; the browser renders the plates, Node hashes them and compares
// with tests/fixtures/plates/golden-plates-habit-1.json.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { build } from 'vite';

type Preset = 'clinographic' | 'front' | 'top';
const PRESETS: readonly Preset[] = ['clinographic', 'front', 'top'];

interface GoldenPlatesFile {
  renderer: string;
  geometryVersion: string;
  sizePx: number;
  entries: ({ seed: number[] } & Record<Preset, string>)[];
}

const ROOT = resolve(import.meta.dirname, '../..');
const golden = JSON.parse(readFileSync(resolve(ROOT, 'tests/fixtures/plates/golden-plates-habit-1.json'), 'utf8')) as GoldenPlatesFile;
const bundles: Record<'plain' | 'minified', string> = { plain: '', minified: '' };

async function bundle(minify: boolean): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    root: ROOT,
    build: {
      write: false,
      minify,
      lib: { entry: resolve(ROOT, 'tests/golden-browsers/plate-entry.ts'), formats: ['iife'], name: 'VoiceCrystalPlate' },
    },
  });
  let code = '';
  for (const out of Array.isArray(result) ? result : [result]) {
    if ('output' in out) for (const chunk of out.output) if (chunk.type === 'chunk') code += chunk.code;
  }
  return code;
}

test.beforeAll(async () => {
  bundles.plain = await bundle(false);
  bundles.minified = await bundle(true);
  expect(bundles.minified.length).toBeLessThan(bundles.plain.length);
});

for (const kind of ['plain', 'minified'] as const) {
  test(`golden plates identical to Node and valid SVG (${kind} bundle)`, async ({ page, browserName }) => {
    test.setTimeout(180_000);
    await page.goto('about:blank');
    await page.addScriptTag({ content: bundles[kind] });
    const { svgs, invalid } = await page.evaluate(
      ({ seeds, presets, version, sizePx }) => {
        const lib = (globalThis as unknown as {
          VoiceCrystalPlate: {
            generateCrystalGeometry: (s: number[], c: number[], v: string) => unknown;
            renderPlateSvg: (g: unknown, view: { preset: string; sizePx: number }) => string;
          };
        }).VoiceCrystalPlate;
        const out: string[] = [];
        for (const s of seeds) {
          const g = lib.generateCrystalGeometry(s, [1, 1, 1, 1, 1, 1], version);
          for (const preset of presets) out.push(lib.renderPlateSvg(g, { preset, sizePx }));
        }
        // Real XML/SVG parsing on a sample (every 60th plate).
        const parser = new DOMParser();
        const bad: number[] = [];
        for (let i = 0; i < out.length; i += 60) {
          const doc = parser.parseFromString(out[i] ?? '', 'image/svg+xml');
          const root = doc.documentElement;
          const ok =
            doc.getElementsByTagName('parsererror').length === 0 &&
            root.namespaceURI === 'http://www.w3.org/2000/svg' &&
            root.localName === 'svg' &&
            root.getElementsByTagName('title').length === 1 &&
            root.getElementsByTagName('desc').length === 1;
          if (!ok) bad.push(i);
        }
        return { svgs: out, invalid: bad };
      },
      { seeds: golden.entries.map((e) => e.seed), presets: PRESETS, version: golden.geometryVersion, sizePx: golden.sizePx },
    );
    expect(invalid, `${browserName} (${kind}): plates that do not parse as SVG`).toEqual([]);
    expect(svgs).toHaveLength(golden.entries.length * PRESETS.length);
    const mismatches: string[] = [];
    golden.entries.forEach((e, i) => {
      PRESETS.forEach((p, k) => {
        const hash = createHash('sha256').update(svgs[i * PRESETS.length + k] ?? '', 'utf8').digest('hex');
        if (hash !== e[p]) mismatches.push(`${JSON.stringify(e.seed)} ${p}`);
      });
    });
    expect(mismatches, `${browserName} (${kind}): plates different from Node`).toEqual([]);
  });
}
