// Loads the committed fvad.wasm in Node (I-05b): checks its SHA-256 against
// fvad.wasm.sha256, compiles it, checks that it imports nothing beyond what
// dsp-core provides, and instantiates it. The dsp-worker will do the same
// from the bundle (I-06).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { asFvadExports, fvadImportObject, FVAD_IMPORTS, type FvadExports } from '@voicecrystal/dsp-core';

export const FVAD_DIR = resolve(import.meta.dirname, '../../packages/dsp-core/wasm');

export interface LoadedFvad {
  exports: FvadExports;
  bytes: number;
  sha256: string;
  module: WebAssembly.Module;
}

export function readFvadBytes(dir = FVAD_DIR): { bytes: Uint8Array<ArrayBuffer>; sha256: string } {
  const bytes = new Uint8Array(readFileSync(join(dir, 'fvad.wasm')));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const expected = readFileSync(join(dir, 'fvad.wasm.sha256'), 'utf8').trim().split(/\s+/)[0];
  if (sha256 !== expected) throw new Error(`fvad.wasm SHA-256 ${sha256} differs from fvad.wasm.sha256 (${expected ?? 'empty'})`);
  return { bytes, sha256 };
}

/** `module.imports` as "module.name" strings, sorted. */
export function importNames(module: WebAssembly.Module): string[] {
  return WebAssembly.Module.imports(module)
    .map((i) => `${i.module}.${i.name}`)
    .sort();
}

export function loadFvad(dir = FVAD_DIR): LoadedFvad {
  const { bytes, sha256 } = readFvadBytes(dir);
  const module = new WebAssembly.Module(bytes);
  const unexpected = importNames(module).filter((n) => !FVAD_IMPORTS.includes(n));
  if (unexpected.length > 0) throw new Error(`fvad.wasm imports ${unexpected.join(', ')}: not provided by dsp-core`);
  const instance = new WebAssembly.Instance(module, fvadImportObject());
  const exports = asFvadExports(instance.exports);
  exports._initialize?.();
  return { exports, bytes: bytes.length, sha256, module };
}
