// Builds the MV3 bundle into dist/extension/ (SPEC §4-§5), then runs the
// bundle guard. Several Vite passes are needed because MV3 contexts disagree
// on module formats:
//   1. pages + service worker: ES modules, shared chunks allowed;
//   2. content script: classic script (IIFE), content scripts are not modules;
//   3. AudioWorklet and DSP worker: single self-contained ES files.
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { FVAD_WASM_SHA256 } from '@voicecrystal/dsp-core';
import { build, type InlineConfig } from 'vite';
import {
  GUARD_EXCEPTIONS,
  SCANNED_EXTENSIONS,
  applyExceptions,
  checkManifest,
  checkUnscannedFile,
  missingPinnedFiles,
  scanSource,
  type Finding,
  type PinnedFile,
} from './bundle-guard.ts';

const EXTENSION_DIR = resolve(import.meta.dirname, '..');
const REPO = resolve(EXTENSION_DIR, '..');
const SRC = join(EXTENSION_DIR, 'src');
/** I-13a (D-AI): the chunk that holds three.js, named in GUARD_EXCEPTIONS. */
export const THREE_CHUNK = 'three';
const OUT = resolve(EXTENSION_DIR, '../dist/extension');

/** HTML entries, keyed by the flat file name they must have in the bundle. */
const PAGES: Readonly<Record<string, string>> = {
  'sidepanel.html': 'sidepanel/index.html',
  'collection.html': 'collection/index.html',
  'permission.html': 'permission/index.html',
  'offscreen.html': 'offscreen/offscreen.html',
};

/** Files that must exist even though the manifest does not reference them. */
const REQUIRED_OUTPUTS = [...Object.keys(PAGES), 'pcm-processor.js', 'dsp-worker.js'];

const common: InlineConfig = {
  configFile: false,
  logLevel: 'warn',
  root: SRC,
  // Absolute URLs (/assets/...) resolve against the extension origin, so the
  // HTML files can be moved to the bundle root without rewriting paths.
  base: '/',
  publicDir: false,
};

const buildTarget = {
  target: 'chrome120',
  outDir: OUT,
  sourcemap: false,
  modulePreload: false,
  minify: true,
  reportCompressedSize: false,
} as const;

/**
 * Moves `sidepanel/index.html` to `sidepanel.html` and so on, after the build
 * (Rolldown does not allow re-keying the bundle in generateBundle).
 */
function flattenHtml(): void {
  for (const [flat, nested] of Object.entries(PAGES)) {
    const from = join(OUT, nested);
    if (!existsSync(from)) continue; // reported by the guard as a missing output
    renameSync(from, join(OUT, flat));
    const dir = dirname(from);
    if (readdirSync(dir).length === 0) rmdirSync(dir);
  }
}

async function buildPagesAndServiceWorker(): Promise<void> {
  const input: Record<string, string> = {
    background: join(SRC, 'background/service-worker.ts'),
  };
  for (const [flat, nested] of Object.entries(PAGES)) {
    input[flat.replace('.html', '')] = join(SRC, nested);
  }
  await build({
    ...common,
    plugins: [tailwindcss()],
    build: {
      ...buildTarget,
      emptyOutDir: true,
      rolldownOptions: {
        input,
        output: {
          entryFileNames: (chunk) =>
            chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
          // I-13a: three.js in its own chunk with a stable name, so the
          // guard's reviewed exceptions can name that file and nothing else.
          chunkFileNames: (chunk) => (chunk.name === THREE_CHUNK ? `assets/${THREE_CHUNK}.js` : 'assets/[name]-[hash].js'),
          assetFileNames: 'assets/[name]-[hash][extname]',
          advancedChunks: { groups: [{ name: THREE_CHUNK, test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?three[\\/]/ }] },
        },
      },
    },
  });
}

async function buildStandalone(entry: string, fileName: string, format: 'es' | 'iife'): Promise<void> {
  await build({
    ...common,
    build: {
      ...buildTarget,
      emptyOutDir: false,
      lib: {
        entry: join(SRC, entry),
        formats: [format],
        name: 'voicecrystal',
        fileName: () => fileName,
      },
    },
  });
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

function guard(): Finding[] {
  const manifest: unknown = JSON.parse(readFileSync(join(EXTENSION_DIR, 'manifest.json'), 'utf8'));
  writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const exists = (path: string): boolean => existsSync(join(OUT, path));
  const findings = checkManifest(manifest, exists);
  for (const required of REQUIRED_OUTPUTS) {
    if (!exists(required)) {
      findings.push({ file: required, rule: 'missing-required-output', detail: required });
    }
  }
  const present = new Set<string>();
  for (const path of listFiles(OUT)) {
    const file = relative(OUT, path).split(sep).join('/');
    present.add(file);
    if (file === 'manifest.json') continue; // validated structurally by checkManifest
    if (!SCANNED_EXTENSIONS.includes(extname(file))) {
      // Unknown file types need a scanner, or an exact pin (I-06b), before they ship.
      findings.push(...checkUnscannedFile(file, sha256Of(readFileSync(path)), PINNED));
      continue;
    }
    findings.push(...scanSource(file, readFileSync(path, 'utf8')));
  }
  findings.push(...missingPinnedFiles(present, PINNED));
  return applyExceptions(findings, GUARD_EXCEPTIONS);
}

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/**
 * Copied into the bundle unchanged (I-06b, ADR-0023): libfvad's module and the
 * license texts of what it contains. Texts get a .txt name so they are inert.
 */
const COPIED: readonly { from: string; to: string; reason: string }[] = [
  { from: join(REPO, 'packages/dsp-core/wasm/fvad.wasm'), to: 'fvad.wasm', reason: 'libfvad (ADR-0023), loaded by the dsp-worker' },
  { from: join(REPO, 'THIRD_PARTY/libfvad/LICENSE'), to: 'THIRD_PARTY/libfvad/LICENSE.txt', reason: 'libfvad BSD-3-Clause' },
  { from: join(REPO, 'THIRD_PARTY/libfvad/PATENTS'), to: 'THIRD_PARTY/libfvad/PATENTS.txt', reason: 'WebRTC patent grant (D-S)' },
  { from: join(REPO, 'THIRD_PARTY/three/LICENSE'), to: 'THIRD_PARTY/three/LICENSE.txt', reason: 'three.js MIT, bundled in the side panel since I-13a (D-AI)' },
  ...readdirSync(join(REPO, 'THIRD_PARTY/emscripten'))
    .filter((f) => f.endsWith('.txt'))
    .sort()
    .map((f) => ({ from: join(REPO, 'THIRD_PARTY/emscripten', f), to: `THIRD_PARTY/emscripten/${f}`, reason: 'Emscripten parts linked into fvad.wasm' })),
];

/** The pins: fvad.wasm by the hash dsp-core checks at run time; texts by their committed bytes (compared in CI). */
const PINNED: readonly PinnedFile[] = COPIED.map((c) => ({
  path: c.to,
  sha256: c.to === 'fvad.wasm' ? FVAD_WASM_SHA256 : sha256Of(readFileSync(c.from)),
  reason: c.reason,
}));

function copyPinned(): void {
  for (const c of COPIED) {
    mkdirSync(dirname(join(OUT, c.to)), { recursive: true });
    copyFileSync(c.from, join(OUT, c.to));
  }
}

await buildPagesAndServiceWorker();
flattenHtml();
await buildStandalone('content/youtube-adapter.ts', 'youtube-content.js', 'iife');
await buildStandalone('offscreen/pcm-processor.ts', 'pcm-processor.js', 'es');
await buildStandalone('offscreen/dsp-worker.ts', 'dsp-worker.js', 'es');
copyPinned();

const findings = guard();
if (findings.length > 0) {
  console.error('Bundle guard failed:');
  for (const f of findings) console.error(`  [${f.rule}] ${f.file}: ${f.detail}`);
  process.exit(1);
}
const files = listFiles(OUT).map((p) => relative(OUT, p).split(sep).join('/'));
console.log(`Bundle OK: ${String(files.length)} files in ${relative(process.cwd(), OUT) || OUT}`);
for (const file of files.sort()) console.log(`  ${file}`);
