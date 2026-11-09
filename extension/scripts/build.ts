// Builds the MV3 bundle into dist/extension/ (SPEC §4-§5), then runs the
// bundle guard. Several Vite passes are needed because MV3 contexts disagree
// on module formats:
//   1. pages + service worker: ES modules, shared chunks allowed;
//   2. content script: classic script (IIFE), content scripts are not modules;
//   3. AudioWorklet and DSP worker: single self-contained ES files.
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { build, type InlineConfig } from 'vite';
import {
  GUARD_EXCEPTIONS,
  SCANNED_EXTENSIONS,
  applyExceptions,
  checkManifest,
  scanSource,
  type Finding,
} from './bundle-guard.ts';

const EXTENSION_DIR = resolve(import.meta.dirname, '..');
const SRC = join(EXTENSION_DIR, 'src');
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
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
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
  for (const path of listFiles(OUT)) {
    const file = relative(OUT, path).split(sep).join('/');
    if (file === 'manifest.json') continue; // validated structurally by checkManifest
    if (!SCANNED_EXTENSIONS.includes(extname(file))) {
      // Unknown file types (e.g. .wasm, images) need a scanner before they ship.
      findings.push({ file, rule: 'unscanned-file-type', detail: extname(file) || '(none)' });
      continue;
    }
    findings.push(...scanSource(file, readFileSync(path, 'utf8')));
  }
  return applyExceptions(findings, GUARD_EXCEPTIONS);
}

await buildPagesAndServiceWorker();
flattenHtml();
await buildStandalone('content/youtube-adapter.ts', 'youtube-content.js', 'iife');
await buildStandalone('offscreen/pcm-processor.ts', 'pcm-processor.js', 'es');
await buildStandalone('offscreen/dsp-worker.ts', 'dsp-worker.js', 'es');

const findings = guard();
if (findings.length > 0) {
  console.error('Bundle guard failed:');
  for (const f of findings) console.error(`  [${f.rule}] ${f.file}: ${f.detail}`);
  process.exit(1);
}
const files = listFiles(OUT).map((p) => relative(OUT, p).split(sep).join('/'));
console.log(`Bundle OK: ${String(files.length)} files in ${relative(process.cwd(), OUT) || OUT}`);
for (const file of files.sort()) console.log(`  ${file}`);
