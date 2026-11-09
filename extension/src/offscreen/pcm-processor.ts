// AudioWorklet processor (ADR-0001): acquisition and accumulation only, no DSP.
// Empty until I-02. The AudioWorklet global scope is not part of the TS libs,
// so the two globals it needs are declared here.
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

class PcmProcessor extends AudioWorkletProcessor {
  process(): boolean {
    return true;
  }
}

registerProcessor('voicecrystal-pcm', PcmProcessor);
