// AudioWorklet processor (ADR-0001): acquisition only, no DSP. It counts the
// samples it receives and reports the total about twice a second (I-02).
// Since I-06b (ADR-0025) it also forwards the audio to the session's DSP
// worker, on a MessagePort the offscreen hands over, but only while the
// session records (listening states, never in a pause): blocks of
// BLOCK_FRAMES per channel, transferred, never copied to the main thread.
// The AudioWorklet global scope is not part of the TS libs, so the globals it
// needs are declared here.
import { PCM_PROCESSOR_NAME, isWorkletCommand, type PcmCountMessage } from './pcm-protocol.ts';

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;
declare const sampleRate: number;

/** Frames per channel in one block sent to the worker (about 85 ms at 48 kHz). */
const BLOCK_FRAMES = 4096;

class PcmProcessor extends AudioWorkletProcessor {
  private samples = 0;
  private sinceReport = 0;
  private readonly reportEvery = Math.round(sampleRate / 2);
  private worker: MessagePort | null = null;
  private recording = false;
  private block: Float32Array[] = [];
  private filled = 0;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<unknown>) => {
      const command = event.data;
      if (!isWorkletCommand(command)) return;
      switch (command.type) {
        case 'ATTACH_WORKER':
          this.worker = command.port;
          return;
        case 'RECORD':
          if (!command.record) this.flush();
          this.recording = command.record;
          return;
        case 'END':
          this.flush();
          this.recording = false;
          this.worker?.postMessage({ type: 'STREAM_END' });
          return;
      }
    };
  }

  /** Sends the partial block, if any (a pause or the end must not lose the tail). */
  private flush(): void {
    if (this.worker === null || this.filled === 0) {
      this.filled = 0;
      this.block = [];
      return;
    }
    const channels = this.block.map((c) => c.slice(0, this.filled));
    this.worker.postMessage({ channels }, channels.map((c) => c.buffer));
    this.filled = 0;
    this.block = [];
  }

  private record(input: Float32Array[]): void {
    const n = input[0]?.length ?? 0;
    if (n === 0 || this.worker === null) return;
    // A change of channel count starts a new block; the worker refuses and counts a mismatch.
    if (this.block.length !== input.length) this.flush();
    let at = 0;
    while (at < n) {
      if (this.block.length === 0) this.block = input.map(() => new Float32Array(BLOCK_FRAMES));
      const take = Math.min(n - at, BLOCK_FRAMES - this.filled);
      input.forEach((c, i) => this.block[i]?.set(c.subarray(at, at + take), this.filled));
      this.filled += take;
      at += take;
      if (this.filled === BLOCK_FRAMES) {
        const channels = this.block;
        this.worker.postMessage({ channels }, channels.map((c) => c.buffer));
        this.block = [];
        this.filled = 0;
      }
    }
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const channel = input?.[0];
    if (channel !== undefined && input !== undefined) {
      if (this.recording) this.record(input);
      this.samples += channel.length;
      this.sinceReport += channel.length;
      if (this.sinceReport >= this.reportEvery) {
        this.sinceReport = 0;
        const message: PcmCountMessage = { samples: this.samples };
        this.port.postMessage(message);
      }
    }
    return true;
  }
}

registerProcessor(PCM_PROCESSOR_NAME, PcmProcessor);
