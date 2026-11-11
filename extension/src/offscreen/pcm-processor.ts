// AudioWorklet processor (ADR-0001): acquisition only, no DSP. In I-02 it
// counts the samples it receives and reports the total about twice a second.
// The AudioWorklet global scope is not part of the TS libs, so the globals it
// needs are declared here.
import { PCM_PROCESSOR_NAME, type PcmCountMessage } from './pcm-protocol.ts';

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;
declare const sampleRate: number;

class PcmProcessor extends AudioWorkletProcessor {
  private samples = 0;
  private sinceReport = 0;
  private readonly reportEvery = Math.round(sampleRate / 2);

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel !== undefined) {
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
