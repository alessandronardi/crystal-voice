// I-13b, review L-6 of I-13a; I-16: the license texts, SBOM and NOTICES in
// THIRD_PARTY/ match the packages actually installed and bundled, byte for byte.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FVAD_WASM_SHA256 } from '@voicecrystal/dsp-core';
import { NOTICES_PATH, SBOM_PATH, buildReleaseAttribution } from '../../scripts/release/build-sbom.ts';

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

  it('THIRD_PARTY/SBOM.spdx.json and THIRD_PARTY/NOTICES.txt match the workspace and are wired into the bundle (I-16)', () => {
    const generated = buildReleaseAttribution();
    const committedSbom = readFileSync(SBOM_PATH, 'utf8').replace(/\r\n/g, '\n');
    const committedNotices = readFileSync(NOTICES_PATH, 'utf8').replace(/\r\n/g, '\n');
    expect(committedSbom).toBe(generated.sbomJson);
    expect(committedNotices).toBe(generated.noticesText);

    const sbom = JSON.parse(committedSbom) as {
      spdxVersion: string;
      dataLicense: string;
      packages: { name: string; versionInfo: string; licenseConcluded: string; comment?: string }[];
      files: { fileName: string; checksums: { algorithm: string; checksumValue: string }[] }[];
    };
    expect(sbom.spdxVersion).toBe('SPDX-2.3');
    expect(sbom.dataLicense).toBe('CC0-1.0');

    const rootPkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> };
    const extPkg = JSON.parse(readFileSync(join(REPO, 'extension/package.json'), 'utf8')) as { devDependencies: Record<string, string> };
    const pkgNames = new Set(sbom.packages.map((p) => p.name));
    for (const dep of [...Object.keys(rootPkg.devDependencies), ...Object.keys(extPkg.devDependencies)]) {
      if (dep.startsWith('@voicecrystal/')) continue;
      expect(pkgNames.has(dep), dep).toBe(true);
    }
    for (const rt of ['three', 'tailwindcss', 'libfvad', 'emscripten-runtime', 'musl', 'llvm-compiler-rt', 'dlmalloc', '@fontsource/spectral', '@fontsource/ibm-plex-mono']) {
      expect(pkgNames.has(rt), rt).toBe(true);
    }

    const wasmFile = sbom.files.find((f) => f.fileName === 'dist/extension/fvad.wasm');
    expect(wasmFile?.checksums[0]?.checksumValue).toBe(FVAD_WASM_SHA256);

    const buildScript = readFileSync(join(REPO, 'extension/scripts/build.ts'), 'utf8');
    const shellSource = readFileSync(join(REPO, 'extension/src/sidepanel/shell.ts'), 'utf8');
    expect(buildScript).toContain('THIRD_PARTY/NOTICES.txt');
    expect(shellSource).toContain('THIRD_PARTY/NOTICES.txt');
  });
});
