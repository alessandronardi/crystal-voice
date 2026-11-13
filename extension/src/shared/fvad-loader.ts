// Loads libfvad in a DSP worker (I-06b, ADR-0023): the bundled fvad.wasm is
// fetched from the extension's own origin (CSP connect-src 'self'), checked
// against the SHA-256 that dsp-core pins, then compiled and instantiated only
// through dsp-core's instantiateFvad (CSP 'wasm-unsafe-eval'; synchronous
// compilation is allowed in workers). Every failure is one code: the
// analysis is refused, never run with another or no VAD.
import { FVAD_WASM_SHA256, instantiateFvad, type FvadModule } from '@voicecrystal/dsp-core';

export const FVAD_FILE = 'fvad.wasm';

export class FvadLoadError extends Error {
  override readonly name = 'FvadLoadError';
  readonly code = 'VAD_UNAVAILABLE';
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Checks and instantiates fvad.wasm bytes; throws FvadLoadError on any mismatch or failure. */
export async function instantiateCheckedFvad(bytes: ArrayBuffer): Promise<FvadModule> {
  let digest: string;
  try {
    digest = hex(await crypto.subtle.digest('SHA-256', bytes));
  } catch {
    throw new FvadLoadError('fvad.wasm: digest failed');
  }
  if (digest !== FVAD_WASM_SHA256) throw new FvadLoadError('fvad.wasm: unexpected SHA-256');
  try {
    return instantiateFvad(WebAssembly, new Uint8Array(bytes));
  } catch {
    throw new FvadLoadError('fvad.wasm: instantiation failed');
  }
}

/** Fetches fvad.wasm next to the running script (the bundle root) and instantiates it. */
export async function loadBundledFvad(base: string): Promise<FvadModule> {
  let bytes: ArrayBuffer;
  try {
    const response = await fetch(new URL(FVAD_FILE, base));
    if (!response.ok) throw new Error(String(response.status));
    bytes = await response.arrayBuffer();
  } catch {
    throw new FvadLoadError('fvad.wasm: not available');
  }
  return instantiateCheckedFvad(bytes);
}
