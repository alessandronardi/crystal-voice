// The AudioWorklet processor in Node (I-06b, review H-2): the globals of the
// AudioWorklet scope are stubbed, the real module is loaded. What the worker
// receives, concatenated, must be exactly the input of the recording windows,
// with STREAM_END last; counts go on as before.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

type ProcessorCtor = new () => { port: MessagePort; process(inputs: Float32Array[][]): boolean };

const host: { ctor: ProcessorCtor | null; control: MessagePort | null } = { ctor: null, control: null };

class StubProcessor {
  readonly port: MessagePort;
  constructor() {
    const channel = new MessageChannel();
    this.port = channel.port1;
    host.control = channel.port2;
  }
}
const g = globalThis as unknown as Record<string, unknown>;
g['AudioWorkletProcessor'] = StubProcessor;
g['registerProcessor'] = (_name: string, ctor: ProcessorCtor) => {
  host.ctor = ctor;
};
g['sampleRate'] = 48000;
await import('../src/offscreen/pcm-processor.ts');

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

interface Received {
  blocks: Float32Array[][];
  ended: boolean;
  afterEnd: number;
}

async function run(quanta: Float32Array[][], recordAt: ReadonlySet<number>): Promise<{ received: Received; recorded: Float32Array[] }> {
  if (host.ctor === null) throw new Error('processor not registered');
  const processor = new host.ctor();
  const control = host.control;
  if (control === null) throw new Error('no control port');
  const toWorker = new MessageChannel();
  const received: Received = { blocks: [], ended: false, afterEnd: 0 };
  toWorker.port2.onmessage = (event: MessageEvent<unknown>) => {
    const data = event.data as { type?: string; channels?: Float32Array[] };
    if (data.type === 'STREAM_END') received.ended = true;
    else if (received.ended) received.afterEnd++;
    else if (data.channels !== undefined) received.blocks.push(data.channels);
  };
  control.postMessage({ type: 'ATTACH_WORKER', port: toWorker.port1 }, [toWorker.port1]);
  await settle();
  const channels = quanta[0]?.length ?? 1;
  const recorded = Array.from({ length: channels }, () => [] as number[]);
  let recording = false;
  for (const [i, quantum] of quanta.entries()) {
    const want = recordAt.has(i);
    if (want !== recording) {
      control.postMessage({ type: 'RECORD', record: want });
      await settle();
      recording = want;
    }
    if (recording) quantum.forEach((c, k) => recorded[k]?.push(...c));
    processor.process([quantum]);
  }
  control.postMessage({ type: 'END' });
  await settle();
  // Anything the processor gets after END must not reach the worker.
  processor.process([quanta[0] ?? [new Float32Array(128)]]);
  await settle();
  control.close();
  toWorker.port2.close();
  return { received, recorded: recorded.map((r) => Float32Array.from(r)) };
}

function concat(blocks: Float32Array[][], channel: number): Float32Array {
  const parts = blocks.map((b) => b[channel] ?? new Float32Array());
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe('pcm-processor (AudioWorklet)', () => {
  it('forwards exactly the recorded quanta, in blocks, with STREAM_END last (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 300 }), { minLength: 1, maxLength: 120 }),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 120 }),
        fc.integer({ min: 1, max: 2 }),
        async (sizes, pattern, channels) => {
          let n = 0;
          const quanta = sizes.map((size) =>
            Array.from({ length: channels }, (_, c) => Float32Array.from({ length: size }, () => Math.fround(((n++ * 7919 + c * 104729) % 2001) / 1000 - 1))),
          );
          const recordAt = new Set(sizes.flatMap((_, i) => (pattern[i % pattern.length] === true ? [i] : [])));
          const { received, recorded } = await run(quanta, recordAt);
          if (!received.ended || received.afterEnd !== 0) return false;
          for (const b of received.blocks) if (b.length !== channels || b.some((c) => c.length === 0 || c.length > 4096)) return false;
          for (let c = 0; c < channels; c++) {
            const got = concat(received.blocks, c);
            const want = recorded[c] ?? new Float32Array();
            if (got.length !== want.length || got.some((v, i) => !Object.is(v, want[i]))) return false;
          }
          return true;
        },
      ),
      { numRuns: 30 },
    );
  }, 120_000);

  it('sends nothing while not recording, and still counts samples', async () => {
    const quanta = Array.from({ length: 400 }, () => [new Float32Array(128).fill(0.25)]);
    const { received } = await run(quanta, new Set());
    expect(received.blocks).toEqual([]);
    expect(received.ended).toBe(true);
  });

  it('full blocks are 4096 frames; a pause flushes the partial block', async () => {
    const quanta = Array.from({ length: 40 }, (_, i) => [new Float32Array(128).fill(i)]);
    const record = new Set(Array.from({ length: 40 }, (_, i) => i).filter((i) => i < 33 || i >= 36));
    const { received } = await run(quanta, record);
    expect(received.blocks.map((b) => b[0]?.length)).toEqual([4096, 128, 512]);
  });
});
