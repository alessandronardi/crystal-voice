// Loads the committed fvad.wasm in Node (I-05b): checks its SHA-256 against
// fvad.wasm.sha256, then instantiates it through dsp-core's instantiateFvad,
// the same fail-closed path the dsp-worker will use (I-06).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { instantiateFvad, type FvadModule } from '@voicecrystal/dsp-core';

export const FVAD_DIR = resolve(import.meta.dirname, '../../packages/dsp-core/wasm');

export interface LoadedFvad {
  fvad: FvadModule;
  bytes: number;
  sha256: string;
  /** Compiled separately, for inspecting the import and export sections. */
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
  return { fvad: instantiateFvad(WebAssembly, bytes), bytes: bytes.length, sha256, module: new WebAssembly.Module(bytes) };
}
