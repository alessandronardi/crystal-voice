// Downloads the official Silero VAD ONNX model into .cache/ (git-ignored) and
// checks it (I-05b, D-L). Development only: the model is never fetched at
// runtime and never bundled (R2).
//
// Trust chain: the file at tag v6.2.3 is identified by its git blob id, read
// from the GitHub tree of that tag on 2026-11-12. The blob id covers the whole
// content (SHA-1 of "blob <size>\0" + bytes); SHA-256 is recorded alongside.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SILERO_TAG = 'v6.2.3';
export const SILERO_PATH = 'src/silero_vad/data/silero_vad.onnx';
const SIZE = 2_327_524;
const GIT_BLOB_SHA1 = '80c5592ef1f4c9ede3e357bbd02eb863358a6a9d';
/** Recorded on 2026-11-12 from the first download, verified by size and git blob id. */
export const SILERO_SHA256: string | null = '1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3';

export const MODEL_FILE = join(import.meta.dirname, '.cache', `silero_vad-${SILERO_TAG}.onnx`);

function gitBlobSha1(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

export function checkModel(bytes: Uint8Array): string {
  if (bytes.length !== SIZE) throw new Error(`Silero model: ${bytes.length} bytes, expected ${SIZE}`);
  const blob = gitBlobSha1(bytes);
  if (blob !== GIT_BLOB_SHA1) throw new Error(`Silero model: git blob ${blob}, expected ${GIT_BLOB_SHA1}`);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (SILERO_SHA256 !== null && sha256 !== SILERO_SHA256) {
    throw new Error(`Silero model: SHA-256 ${sha256}, expected ${SILERO_SHA256}`);
  }
  return sha256;
}

async function main(): Promise<void> {
  if (existsSync(MODEL_FILE)) {
    console.log(`già presente, SHA-256 ${checkModel(readFileSync(MODEL_FILE))}`);
    return;
  }
  const url = `https://raw.githubusercontent.com/snakers4/silero-vad/${SILERO_TAG}/${SILERO_PATH}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const sha256 = checkModel(bytes);
  mkdirSync(join(import.meta.dirname, '.cache'), { recursive: true });
  writeFileSync(MODEL_FILE, bytes);
  console.log(`scaricato ${bytes.length} byte, SHA-256 ${sha256}`);
}

if (import.meta.main) await main();
