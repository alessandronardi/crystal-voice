// Framing (SPEC §7.3): rectangular frames fully inside the signal, at a fixed
// hop. Frame k covers samples [k·hop, k·hop + length). No padding: a partial
// tail is not a frame. Window shapes, if any, are applied by the consumer.

import { DspInputError } from './errors.ts';

export function frameCount(signalLength: number, frameLength: number, hop: number): number {
  if (!Number.isInteger(frameLength) || frameLength <= 0 || !Number.isInteger(hop) || hop <= 0) {
    throw new DspInputError('BAD_FRAME', `frame ${String(frameLength)}, hop ${String(hop)}`);
  }
  return signalLength >= frameLength ? Math.floor((signalLength - frameLength) / hop) + 1 : 0;
}

/** View (no copy) of frame `index`. */
export function frameAt(pcm: Float32Array, index: number, frameLength: number, hop: number): Float32Array {
  const start = index * hop;
  return pcm.subarray(start, start + frameLength);
}
