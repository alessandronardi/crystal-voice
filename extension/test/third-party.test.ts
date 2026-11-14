// I-13b, review L-6 of I-13a: the license texts in THIRD_PARTY/ are the ones
// of the packages actually installed (three.js, Tailwind CSS), byte for byte,
// so an update of a dependency cannot leave an old text in the bundle. The
// OFL fonts are pinned by their committed bytes in the bundle guard (D-AQ).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(import.meta.dirname, '../..');

/** The installed package folder (some packages do not export package.json, so no require.resolve). */
function installed(from: string, name: string): string {
  return join(REPO, from, 'node_modules', name);
}

describe('THIRD_PARTY license texts match the installed packages (L-6)', () => {
  it('three.js', () => {
    expect(readFileSync(join(REPO, 'THIRD_PARTY/three/LICENSE'))).toEqual(readFileSync(join(installed('packages/renderer-three', 'three'), 'LICENSE')));
  });

  it('Tailwind CSS', () => {
    expect(readFileSync(join(REPO, 'THIRD_PARTY/tailwindcss/LICENSE'))).toEqual(readFileSync(join(installed('extension', 'tailwindcss'), 'LICENSE')));
  });

  it('the bundled fonts are exactly the four files downloaded with permission (D-AQ, review M-1)', () => {
    // @fontsource/spectral and @fontsource/ibm-plex-mono 5.3.0, latin subset, unchanged.
    const PINNED: Record<string, string> = {
      'ibm-plex-mono-latin-400-normal.woff2': '08949f728dc52d528e69b1667d15c89a5686a4ee9a296ff90983985f99c380f7',
      'ibm-plex-mono-latin-600-normal.woff2': '0d1f0b8d0722224e32e9f28261bdc86c79115be73444ae5eceb73976a1bcdf83',
      'spectral-latin-400-normal.woff2': 'cf8daee3b83c1e662196c6e34e444bc41344d54bfeb4fb5351e197de6ce94539',
      'spectral-latin-600-normal.woff2': '33faca8b5795a0de1af77cbc43a050a3655c4b1e03e04847fdef4d19d2e361d2',
    };
    const dir = join(REPO, 'extension/assets/fonts');
    const present = readdirSync(dir).sort();
    expect(present).toEqual(Object.keys(PINNED).sort());
    for (const f of present) expect(createHash('sha256').update(readFileSync(join(dir, f))).digest('hex'), f).toBe(PINNED[f]);
    expect(createHash('sha256').update(readFileSync(join(REPO, 'THIRD_PARTY/spectral/OFL.txt'))).digest('hex')).toBe('22ca006c8a0edb513ee188722d72e9f65cbb19f07abb71bd7a898bc926503609');
    expect(createHash('sha256').update(readFileSync(join(REPO, 'THIRD_PARTY/ibm-plex-mono/OFL.txt'))).digest('hex')).toBe('23b0a9d0c6d3f140a0b77e483c5cfa6bba574325ef5cb189ed9f2fec4884533f');
  });

  it('the bundled fonts each have their OFL text', () => {
    const fonts = readdirSync(join(REPO, 'extension/assets/fonts')).filter((f) => f.endsWith('.woff2'));
    expect(fonts.length).toBe(4);
    for (const f of fonts) {
      const family = f.startsWith('spectral') ? 'spectral' : 'ibm-plex-mono';
      expect(readFileSync(join(REPO, 'THIRD_PARTY', family, 'OFL.txt'), 'utf8')).toContain('SIL Open Font License, Version 1.1');
    }
  });
});
