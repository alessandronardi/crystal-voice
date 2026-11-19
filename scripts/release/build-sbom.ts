// Builds THIRD_PARTY/SBOM.spdx.json (SPDX 2.3) and THIRD_PARTY/NOTICES.txt
// deterministically from workspace manifests and committed third-party artifacts
// (SPEC §14, BACKLOG I-16).
//
//   node scripts/release/build-sbom.ts           write both files
//   node scripts/release/build-sbom.ts --check   exit 1 if either differs

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FVAD_WASM_SHA256 } from '@voicecrystal/dsp-core';

export const REPO_ROOT = resolve(import.meta.dirname, '../..');
export const SBOM_PATH = join(REPO_ROOT, 'THIRD_PARTY/SBOM.spdx.json');
export const NOTICES_PATH = join(REPO_ROOT, 'THIRD_PARTY/NOTICES.txt');

const SBOM_CREATED_AT = '2026-11-17T00:00:00Z';
const REPO_URL = 'https://github.com/alessandronardi/crystal-voice';

interface PackageManifest {
  name: string;
  version: string;
  description?: string;
  license?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface SpdxChecksum {
  algorithm: 'SHA256';
  checksumValue: string;
}

interface SpdxPackage {
  SPDXID: string;
  name: string;
  versionInfo: string;
  downloadLocation: string;
  filesAnalyzed: false;
  licenseConcluded: string;
  licenseDeclared: string;
  copyrightText: string;
  checksums?: SpdxChecksum[];
  externalRefs?: { referenceCategory: 'PACKAGE-MANAGER'; referenceType: 'purl'; referenceLocator: string }[];
  comment?: string;
}

interface SpdxFile {
  fileName: string;
  SPDXID: string;
  checksums: SpdxChecksum[];
  licenseConcluded: string;
  copyrightText: string;
}

interface SpdxRelationship {
  spdxElementId: string;
  relationshipType: string;
  relatedSpdxElement: string;
}

interface DevPackageMeta {
  license: string;
  copyright: string;
}

const DEV_DEPENDENCY_METADATA: Readonly<Record<string, DevPackageMeta>> = {
  '@eslint/js': { license: 'MIT', copyright: 'Copyright OpenJS Foundation and other contributors' },
  '@playwright/test': { license: 'Apache-2.0', copyright: 'Copyright (c) Microsoft Corporation' },
  '@tailwindcss/vite': { license: 'MIT', copyright: 'Copyright (c) Tailwind Labs, Inc.' },
  '@types/chrome': { license: 'MIT', copyright: 'Copyright (c) DefinitelyTyped contributors' },
  '@types/node': { license: 'MIT', copyright: 'Copyright (c) DefinitelyTyped contributors' },
  '@types/three': { license: 'MIT', copyright: 'Copyright (c) DefinitelyTyped contributors' },
  'axe-core': { license: 'MPL-2.0', copyright: 'Copyright (c) Deque Systems, Inc.' },
  eslint: { license: 'MIT', copyright: 'Copyright OpenJS Foundation and other contributors' },
  'fake-indexeddb': { license: 'Apache-2.0', copyright: 'Copyright (c) Dumbmatter' },
  'fast-check': { license: 'MIT', copyright: 'Copyright (c) Nicolas Dubien' },
  typescript: { license: 'Apache-2.0', copyright: 'Copyright (c) Microsoft Corporation' },
  'typescript-eslint': { license: 'MIT', copyright: 'Copyright (c) typescript-eslint contributors' },
  vite: { license: 'MIT', copyright: 'Copyright (c) 2019-present, VoidZero Inc. and Vite contributors' },
  vitest: { license: 'MIT', copyright: 'Copyright (c) 2021-present, VoidZero Inc. and Vitest contributors' },
};

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const readPackageManifest = (path: string): PackageManifest =>
  JSON.parse(readFileSync(path, 'utf8')) as PackageManifest;

const spdxId = (raw: string): string => `SPDXRef-${raw.replace(/[^A-Za-z0-9.-]/g, '-')}`;

function readInstalledLicense(name: string): string | null {
  for (const base of [
    join(REPO_ROOT, 'node_modules'),
    join(REPO_ROOT, 'extension/node_modules'),
    join(REPO_ROOT, 'packages/renderer-three/node_modules'),
    join(REPO_ROOT, 'packages/vault/node_modules'),
  ]) {
    const pkgPath = join(base, name, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { license?: unknown };
      return typeof pkg.license === 'string' ? pkg.license : null;
    }
  }
  return null;
}

export interface ReleaseAttribution {
  sbomJson: string;
  noticesText: string;
  runtimeComponentCount: number;
  devDependencyCount: number;
  bundledFileCount: number;
}

export function buildReleaseAttribution(): ReleaseAttribution {
  const rootManifest = readPackageManifest(join(REPO_ROOT, 'package.json'));
  const extManifest = readPackageManifest(join(REPO_ROOT, 'extension/package.json'));
  const packageDirs = readdirSync(join(REPO_ROOT, 'packages')).sort();
  const packageManifests = packageDirs.map((dir) => ({
    dir,
    manifest: readPackageManifest(join(REPO_ROOT, 'packages', dir, 'package.json')),
  }));

  const threeVersion =
    packageManifests.find((p) => p.manifest.name === '@voicecrystal/renderer-three')?.manifest.dependencies?.['three'] ?? '';
  const tailwindVersion = extManifest.devDependencies?.['tailwindcss'] ?? '';
  if (threeVersion === '' || tailwindVersion === '') {
    throw new Error('Cannot resolve runtime versions for three or tailwindcss from workspace manifests.');
  }

  const fvadPath = join(REPO_ROOT, 'packages/dsp-core/wasm/fvad.wasm');
  const fvadBytes = readFileSync(fvadPath);
  const fvadSha256 = sha256Hex(fvadBytes);
  if (fvadSha256 !== FVAD_WASM_SHA256) {
    throw new Error(`fvad.wasm hash mismatch: ${fvadSha256} !== ${FVAD_WASM_SHA256}`);
  }

  const fontFiles = readdirSync(join(REPO_ROOT, 'extension/assets/fonts'))
    .filter((f) => f.endsWith('.woff2'))
    .sort()
    .map((name) => {
      const bytes = readFileSync(join(REPO_ROOT, 'extension/assets/fonts', name));
      return {
        name,
        bundlePath: `fonts/${name}`,
        sha256: sha256Hex(bytes),
        bytes: bytes.length,
        family: name.startsWith('spectral') ? '@fontsource/spectral' : '@fontsource/ibm-plex-mono',
      };
    });

  const licenseFiles: readonly { repoPath: string; bundlePath: string; license: string; copyright: string }[] = [
    {
      repoPath: 'THIRD_PARTY/three/LICENSE',
      bundlePath: 'THIRD_PARTY/three/LICENSE.txt',
      license: 'MIT',
      copyright: 'Copyright (c) 2010-2026 three.js authors',
    },
    {
      repoPath: 'THIRD_PARTY/tailwindcss/LICENSE',
      bundlePath: 'THIRD_PARTY/tailwindcss/LICENSE.txt',
      license: 'MIT',
      copyright: 'Copyright (c) Tailwind Labs, Inc.',
    },
    {
      repoPath: 'THIRD_PARTY/libfvad/LICENSE',
      bundlePath: 'THIRD_PARTY/libfvad/LICENSE.txt',
      license: 'BSD-3-Clause',
      copyright: 'Copyright (c) 2011, The WebRTC project authors; Copyright (c) 2016 Daniel Pirch',
    },
    {
      repoPath: 'THIRD_PARTY/libfvad/PATENTS',
      bundlePath: 'THIRD_PARTY/libfvad/PATENTS.txt',
      license: 'LicenseRef-WebRTC-PATENTS',
      copyright: 'WebRTC Additional IP Rights Grant (Patents)',
    },
    {
      repoPath: 'THIRD_PARTY/emscripten/emscripten-LICENSE.txt',
      bundlePath: 'THIRD_PARTY/emscripten/emscripten-LICENSE.txt',
      license: 'MIT OR NCSA',
      copyright: 'Copyright (c) 2010-2014 Emscripten authors',
    },
    {
      repoPath: 'THIRD_PARTY/emscripten/musl-COPYRIGHT.txt',
      bundlePath: 'THIRD_PARTY/emscripten/musl-COPYRIGHT.txt',
      license: 'MIT',
      copyright: 'Copyright (c) 2005-2020 Rich Felker, et al.',
    },
    {
      repoPath: 'THIRD_PARTY/emscripten/compiler-rt-LICENSE.txt',
      bundlePath: 'THIRD_PARTY/emscripten/compiler-rt-LICENSE.txt',
      license: 'Apache-2.0 WITH LLVM-exception',
      copyright: 'The LLVM Project',
    },
    {
      repoPath: 'THIRD_PARTY/emscripten/dlmalloc-NOTICE.txt',
      bundlePath: 'THIRD_PARTY/emscripten/dlmalloc-NOTICE.txt',
      license: 'CC0-1.0',
      copyright: 'Written by Doug Lea and released to the public domain',
    },
    {
      repoPath: 'THIRD_PARTY/spectral/OFL.txt',
      bundlePath: 'THIRD_PARTY/spectral/OFL.txt',
      license: 'OFL-1.1',
      copyright: 'Copyright 2017 The Spectral Project Authors',
    },
    {
      repoPath: 'THIRD_PARTY/ibm-plex-mono/OFL.txt',
      bundlePath: 'THIRD_PARTY/ibm-plex-mono/OFL.txt',
      license: 'OFL-1.1',
      copyright: 'Copyright (c) 2017 IBM Corp.',
    },
  ];

  const hashedLicenses = licenseFiles.map((entry) => {
    const bytes = readFileSync(join(REPO_ROOT, entry.repoPath));
    return { ...entry, sha256: sha256Hex(bytes), bytes: bytes.length };
  });

  // Collect direct devDependencies across all workspace manifests (excluding workspace:* and tailwindcss, which is bundled as CSS).
  const devDeps = new Map<string, string>();
  for (const manifest of [rootManifest, extManifest, ...packageManifests.map((p) => p.manifest)]) {
    for (const [dep, version] of Object.entries(manifest.devDependencies ?? {})) {
      if (version.startsWith('workspace:') || dep === 'tailwindcss') continue;
      const existing = devDeps.get(dep);
      if (existing !== undefined && existing !== version) {
        throw new Error(`Inconsistent devDependency version for ${dep}: ${existing} vs ${version}`);
      }
      devDeps.set(dep, version);
    }
  }

  const spdxPackages: SpdxPackage[] = [];
  const relationships: SpdxRelationship[] = [];

  const rootSpdxId = 'SPDXRef-Package-root';
  const extSpdxId = 'SPDXRef-Package-extension';

  spdxPackages.push({
    SPDXID: rootSpdxId,
    name: rootManifest.name,
    versionInfo: extManifest.version,
    downloadLocation: REPO_URL,
    filesAnalyzed: false,
    licenseConcluded: 'MIT',
    licenseDeclared: 'MIT',
    copyrightText: 'Copyright (c) 2026 Alessandro Nardi',
    comment: 'VoiceCrystal monorepo root (LICENSE).',
  });

  spdxPackages.push({
    SPDXID: extSpdxId,
    name: extManifest.name,
    versionInfo: extManifest.version,
    downloadLocation: REPO_URL,
    filesAnalyzed: false,
    licenseConcluded: 'MIT',
    licenseDeclared: 'MIT',
    copyrightText: 'Copyright (c) 2026 Alessandro Nardi',
    comment: extManifest.description ?? 'VoiceCrystal Chrome MV3 extension.',
  });

  relationships.push({
    spdxElementId: 'SPDXRef-DOCUMENT',
    relationshipType: 'DESCRIBES',
    relatedSpdxElement: extSpdxId,
  });

  for (const { manifest } of packageManifests) {
    const id = spdxId(`Package-ws-${manifest.name}`);
    spdxPackages.push({
      SPDXID: id,
      name: manifest.name,
      versionInfo: manifest.version,
      downloadLocation: REPO_URL,
      filesAnalyzed: false,
      licenseConcluded: 'MIT',
      licenseDeclared: 'MIT',
      copyrightText: 'Copyright (c) 2026 Alessandro Nardi',
      ...(manifest.description !== undefined ? { comment: manifest.description } : {}),
    });
    relationships.push({
      spdxElementId: extSpdxId,
      relationshipType: 'DEPENDS_ON',
      relatedSpdxElement: id,
    });
  }

  const runtimeComponents: readonly {
    id: string;
    name: string;
    version: string;
    license: string;
    downloadLocation: string;
    copyright: string;
    purl?: string;
    checksums?: SpdxChecksum[];
    comment: string;
  }[] = [
    {
      id: 'Package-rt-three',
      name: 'three',
      version: threeVersion,
      license: 'MIT',
      downloadLocation: `https://registry.npmjs.org/three/-/three-${threeVersion}.tgz`,
      copyright: 'Copyright (c) 2010-2026 three.js authors',
      purl: `pkg:npm/three@${threeVersion}`,
      comment: 'Bundled as assets/three.js in dist/extension/. License: THIRD_PARTY/three/LICENSE.txt.',
    },
    {
      id: 'Package-rt-tailwindcss',
      name: 'tailwindcss',
      version: tailwindVersion,
      license: 'MIT',
      downloadLocation: `https://registry.npmjs.org/tailwindcss/-/tailwindcss-${tailwindVersion}.tgz`,
      copyright: 'Copyright (c) Tailwind Labs, Inc.',
      purl: `pkg:npm/tailwindcss@${tailwindVersion}`,
      comment: 'Compiled locally into extension CSS in dist/extension/. License: THIRD_PARTY/tailwindcss/LICENSE.txt.',
    },
    {
      id: 'Package-rt-libfvad',
      name: 'libfvad',
      version: '532ab666c20d3cfda38bca63abbb0f152706c369',
      license: 'BSD-3-Clause',
      downloadLocation: 'https://github.com/dpirch/libfvad/tree/532ab666c20d3cfda38bca63abbb0f152706c369',
      copyright: 'Copyright (c) 2011, The WebRTC project authors; Copyright (c) 2016 Daniel Pirch',
      checksums: [{ algorithm: 'SHA256', checksumValue: fvadSha256 }],
      comment:
        'Compiled deterministically to dist/extension/fvad.wasm via emscripten/emsdk:6.0.13 (ADR-0023). License and WebRTC patent grant: THIRD_PARTY/libfvad/LICENSE.txt, THIRD_PARTY/libfvad/PATENTS.txt.',
    },
    {
      id: 'Package-rt-emscripten',
      name: 'emscripten-runtime',
      version: '6.0.13',
      license: 'MIT OR NCSA',
      downloadLocation: 'https://github.com/emscripten-core/emscripten/tree/6.0.13',
      copyright: 'Copyright (c) 2010-2014 Emscripten authors',
      comment: 'Static runtime parts linked into fvad.wasm. License: THIRD_PARTY/emscripten/emscripten-LICENSE.txt.',
    },
    {
      id: 'Package-rt-musl',
      name: 'musl',
      version: 'emscripten-6.0.13',
      license: 'MIT',
      downloadLocation: 'https://github.com/emscripten-core/emscripten/tree/6.0.13/system/lib/libc/musl',
      copyright: 'Copyright (c) 2005-2020 Rich Felker, et al.',
      comment: 'Static libc linked into fvad.wasm. License: THIRD_PARTY/emscripten/musl-COPYRIGHT.txt.',
    },
    {
      id: 'Package-rt-compiler-rt',
      name: 'llvm-compiler-rt',
      version: 'emscripten-6.0.13',
      license: 'Apache-2.0 WITH LLVM-exception',
      downloadLocation: 'https://github.com/emscripten-core/emscripten/tree/6.0.13/system/lib/compiler-rt',
      copyright: 'The LLVM Project',
      comment: 'Static compiler builtins linked into fvad.wasm. License: THIRD_PARTY/emscripten/compiler-rt-LICENSE.txt.',
    },
    {
      id: 'Package-rt-dlmalloc',
      name: 'dlmalloc',
      version: '2.8.6',
      license: 'CC0-1.0',
      downloadLocation: 'https://github.com/emscripten-core/emscripten/blob/6.0.13/system/lib/dlmalloc.c',
      copyright: 'Written by Doug Lea and released to the public domain',
      comment: 'Static allocator linked into fvad.wasm. Notice: THIRD_PARTY/emscripten/dlmalloc-NOTICE.txt.',
    },
    {
      id: 'Package-rt-spectral',
      name: '@fontsource/spectral',
      version: '5.3.0',
      license: 'OFL-1.1',
      downloadLocation: 'https://registry.npmjs.org/@fontsource/spectral/-/spectral-5.3.0.tgz',
      copyright: 'Copyright 2017 The Spectral Project Authors',
      purl: 'pkg:npm/@fontsource/spectral@5.3.0',
      checksums: fontFiles
        .filter((f) => f.family === '@fontsource/spectral')
        .map((f) => ({ algorithm: 'SHA256', checksumValue: f.sha256 })),
      comment: 'Latin subset woff2 (400, 600) bundled in dist/extension/fonts/. License: THIRD_PARTY/spectral/OFL.txt.',
    },
    {
      id: 'Package-rt-ibm-plex-mono',
      name: '@fontsource/ibm-plex-mono',
      version: '5.3.0',
      license: 'OFL-1.1',
      downloadLocation: 'https://registry.npmjs.org/@fontsource/ibm-plex-mono/-/ibm-plex-mono-5.3.0.tgz',
      copyright: 'Copyright (c) 2017 IBM Corp.',
      purl: 'pkg:npm/@fontsource/ibm-plex-mono@5.3.0',
      checksums: fontFiles
        .filter((f) => f.family === '@fontsource/ibm-plex-mono')
        .map((f) => ({ algorithm: 'SHA256', checksumValue: f.sha256 })),
      comment: 'Latin subset woff2 (400, 600) bundled in dist/extension/fonts/. License: THIRD_PARTY/ibm-plex-mono/OFL.txt.',
    },
  ];

  for (const rt of runtimeComponents) {
    const id = spdxId(rt.id);
    spdxPackages.push({
      SPDXID: id,
      name: rt.name,
      versionInfo: rt.version,
      downloadLocation: rt.downloadLocation,
      filesAnalyzed: false,
      licenseConcluded: rt.license,
      licenseDeclared: rt.license,
      copyrightText: rt.copyright,
      ...(rt.checksums !== undefined ? { checksums: rt.checksums } : {}),
      ...(rt.purl !== undefined
        ? {
            externalRefs: [{ referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl', referenceLocator: rt.purl }],
          }
        : {}),
      comment: rt.comment,
    });
    relationships.push({
      spdxElementId: extSpdxId,
      relationshipType: 'DEPENDS_ON',
      relatedSpdxElement: id,
    });
  }

  const sortedDevDeps = [...devDeps.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [dep, version] of sortedDevDeps) {
    const meta = DEV_DEPENDENCY_METADATA[dep];
    if (meta === undefined) {
      throw new Error(`Missing license metadata in DEV_DEPENDENCY_METADATA for devDependency: ${dep}`);
    }
    const installedLicense = readInstalledLicense(dep);
    if (installedLicense !== null && installedLicense !== meta.license) {
      throw new Error(`License mismatch for ${dep}: installed=${installedLicense} vs expected=${meta.license}`);
    }
    const id = spdxId(`Package-dev-${dep}`);
    spdxPackages.push({
      SPDXID: id,
      name: dep,
      versionInfo: version,
      downloadLocation: `https://registry.npmjs.org/${dep}`,
      filesAnalyzed: false,
      licenseConcluded: meta.license,
      licenseDeclared: meta.license,
      copyrightText: meta.copyright,
      externalRefs: [{ referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl', referenceLocator: `pkg:npm/${dep}@${version}` }],
      comment: 'devDependency only; not included in dist/extension/.',
    });
    relationships.push({
      spdxElementId: id,
      relationshipType: 'DEV_DEPENDENCY_OF',
      relatedSpdxElement: rootSpdxId,
    });
  }

  const spdxFiles: SpdxFile[] = [
    {
      fileName: 'dist/extension/fvad.wasm',
      SPDXID: 'SPDXRef-File-fvad-wasm',
      checksums: [{ algorithm: 'SHA256', checksumValue: fvadSha256 }],
      licenseConcluded: 'BSD-3-Clause AND MIT AND Apache-2.0 WITH LLVM-exception AND CC0-1.0',
      copyrightText: 'libfvad, WebRTC, Emscripten, musl, LLVM compiler-rt, dlmalloc',
    },
    ...fontFiles.map((f) => ({
      fileName: `dist/extension/${f.bundlePath}`,
      SPDXID: spdxId(`File-${f.name}`),
      checksums: [{ algorithm: 'SHA256' as const, checksumValue: f.sha256 }],
      licenseConcluded: 'OFL-1.1',
      copyrightText: f.family === '@fontsource/spectral' ? 'Copyright 2017 The Spectral Project Authors' : 'Copyright (c) 2017 IBM Corp.',
    })),
    ...hashedLicenses.map((l) => ({
      fileName: `dist/extension/${l.bundlePath}`,
      SPDXID: spdxId(`File-${l.bundlePath}`),
      checksums: [{ algorithm: 'SHA256' as const, checksumValue: l.sha256 }],
      licenseConcluded: l.license,
      copyrightText: l.copyright,
    })),
  ];

  const sbomDoc = {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `VoiceCrystal-${extManifest.version}`,
    documentNamespace: `${REPO_URL}/spdx/voicecrystal-${extManifest.version}`,
    creationInfo: {
      created: SBOM_CREATED_AT,
      creators: ['Tool: scripts/release/build-sbom.ts'],
      licenseListVersion: '3.25',
    },
    documentDescribes: [extSpdxId],
    packages: spdxPackages,
    files: spdxFiles,
    relationships,
  };

  const noticesLines: string[] = [
    `VoiceCrystal ${extManifest.version} — Attribuzioni di Terze Parti e Riepilogo SBOM`,
    '================================================================================',
    '',
    'Licenza del progetto VoiceCrystal: MIT (vedere LICENSE nella radice del repository).',
    'SBOM macchina (SPDX 2.3): THIRD_PARTY/SBOM.spdx.json nel repository.',
    '',
    '1. Componenti di terze parti inclusi nel pacchetto distribuito (dist/extension/)',
    '--------------------------------------------------------------------------------',
    '',
    ...runtimeComponents.map((rt) =>
      [
        `- ${rt.name} (${rt.version})`,
        `  Licenza: ${rt.license}`,
        `  Origine: ${rt.downloadLocation}`,
        `  Nota: ${rt.comment}`,
      ].join('\n'),
    ),
    '',
    '2. Impronte SHA-256 dei binari, font OFL e testi di licenza nel bundle',
    '--------------------------------------------------------------------------------',
    `fvad.wasm (${String(fvadBytes.length)} byte): sha256:${fvadSha256}`,
    ...fontFiles.map((f) => `${f.bundlePath} (${String(f.bytes)} byte): sha256:${f.sha256}`),
    ...hashedLicenses.map((l) => `${l.bundlePath} (${String(l.bytes)} byte): sha256:${l.sha256}`),
    '',
    '3. Dipendenze di solo sviluppo / test / build (NON incluse in dist/extension/)',
    '--------------------------------------------------------------------------------',
    ...sortedDevDeps.map(([dep, version]) => {
      const meta = DEV_DEPENDENCY_METADATA[dep];
      return `- ${dep}@${version} (${meta?.license ?? 'unknown'})`;
    }),
    '',
  ];

  return {
    sbomJson: `${JSON.stringify(sbomDoc, null, 2)}\n`,
    noticesText: noticesLines.join('\n'),
    runtimeComponentCount: runtimeComponents.length,
    devDependencyCount: sortedDevDeps.length,
    bundledFileCount: spdxFiles.length,
  };
}

if (import.meta.main) {
  const { sbomJson, noticesText } = buildReleaseAttribution();
  if (process.argv.includes('--check')) {
    const currentSbom = readFileSync(SBOM_PATH, 'utf8').replace(/\r\n/g, '\n');
    const currentNotices = readFileSync(NOTICES_PATH, 'utf8').replace(/\r\n/g, '\n');
    if (currentSbom !== sbomJson) {
      console.error('THIRD_PARTY/SBOM.spdx.json differs from the generator output');
      process.exit(1);
    }
    if (currentNotices !== noticesText) {
      console.error('THIRD_PARTY/NOTICES.txt differs from the generator output');
      process.exit(1);
    }
    console.log('THIRD_PARTY/SBOM.spdx.json and THIRD_PARTY/NOTICES.txt are up to date');
  } else {
    writeFileSync(SBOM_PATH, sbomJson);
    writeFileSync(NOTICES_PATH, noticesText);
    console.log(`wrote ${SBOM_PATH}`);
    console.log(`wrote ${NOTICES_PATH}`);
  }
}
