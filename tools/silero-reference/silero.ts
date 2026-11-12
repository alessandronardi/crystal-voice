// Silero VAD adapter for the I-05b comparison (bench only, D-L).
//
// Silero works on 512-sample windows (32 ms at 16 kHz) with a recurrent state
// and 64 samples of context from the previous window, as in the official
// OnnxWrapper of snakers4/silero-vad. Inference is asynchronous, so this does
// not implement the synchronous `VadEngine` of dsp-core: it returns one
// probability per window for a whole signal, and `toFrameDecisions` maps them
// onto the 20 ms VAD frames (the window that contains the frame centre).

import * as ort from 'onnxruntime-node';

export const SILERO_WINDOW = 512;
export const SILERO_CONTEXT = 64;
/** Silero's default speech threshold. [H] */
export const SILERO_THRESHOLD = 0.5;
const SR = 16000;

export interface SileroRunner {
  readonly id: string;
  /** One probability per 512-sample window; the last window is zero-padded. */
  probabilities(pcm16k: Float32Array): Promise<Float32Array>;
}

export async function createSilero(modelFile: string, tag: string): Promise<SileroRunner> {
  const session = await ort.InferenceSession.create(modelFile, {
    executionProviders: ['cpu'],
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
  });
  for (const name of ['input', 'state', 'sr']) {
    if (!session.inputNames.includes(name)) throw new Error(`Silero model: missing input "${name}" (${session.inputNames.join(', ')})`);
  }
  const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(SR)]), []);
  return {
    id: `silero-${tag}`,
    async probabilities(pcm) {
      const windows = Math.ceil(pcm.length / SILERO_WINDOW);
      const out = new Float32Array(windows);
      let state = new ort.Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]);
      let context = new Float32Array(SILERO_CONTEXT);
      for (let w = 0; w < windows; w++) {
        const input = new Float32Array(SILERO_CONTEXT + SILERO_WINDOW);
        input.set(context, 0);
        input.set(pcm.subarray(w * SILERO_WINDOW, (w + 1) * SILERO_WINDOW), SILERO_CONTEXT);
        const result = await session.run({ input: new ort.Tensor('float32', input, [1, input.length]), state, sr });
        const prob = result['output'];
        const next = result['stateN'];
        if (prob === undefined || next === undefined) throw new Error('Silero model: missing output or stateN');
        out[w] = (prob.data as Float32Array)[0] ?? Number.NaN;
        state = next as typeof state;
        context = input.slice(input.length - SILERO_CONTEXT);
      }
      return out;
    },
  };
}

/** Decision of each 20 ms frame from the window that contains its centre. */
export function toFrameDecisions(probabilities: Float32Array, frames: number, frameSamples: number, threshold = SILERO_THRESHOLD): boolean[] {
  const out: boolean[] = [];
  for (let k = 0; k < frames; k++) {
    const centre = k * frameSamples + frameSamples / 2;
    const p = probabilities[Math.floor(centre / SILERO_WINDOW)];
    if (p === undefined || !Number.isFinite(p)) throw new Error(`Silero: no probability for frame ${k}`);
    out.push(p >= threshold);
  }
  return out;
}
