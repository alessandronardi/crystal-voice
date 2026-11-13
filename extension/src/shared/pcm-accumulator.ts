// Keeps the blocks of a tab or microphone session in RAM until its end
// (I-06b, ADR-0025), so the analysis runs on the whole buffer exactly like a
// local file: concatenated blocks are the buffer, bit for bit. Bounded: past
// `maxFrames` per channel, blocks are refused and counted, never silently
// lost. The channel count is fixed by the first block; a block with another
// count is refused and counted too. Pure: no DOM, no chrome.*.

export class PcmAccumulator {
  private readonly blocks: Float32Array[][] = [];
  private kept = 0;
  private dropped = 0;
  private channels = 0;
  private readonly maxFrames: number;

  constructor(maxFrames: number) {
    this.maxFrames = maxFrames;
    if (!Number.isSafeInteger(maxFrames) || maxFrames <= 0) throw new RangeError(`maxFrames ${String(maxFrames)}`);
  }

  /** Adds one block (one array per channel, same length). Returns false when it was refused. */
  push(block: readonly Float32Array[]): boolean {
    const length = block[0]?.length ?? 0;
    if (length === 0 || block.some((c) => c.length !== length)) return false;
    if (this.channels === 0) this.channels = block.length;
    if (block.length !== this.channels || this.kept + length > this.maxFrames) {
      this.dropped += length;
      return false;
    }
    this.blocks.push([...block]);
    this.kept += length;
    return true;
  }

  get frames(): number {
    return this.kept;
  }

  get droppedFrames(): number {
    return this.dropped;
  }

  get channelCount(): number {
    return this.channels;
  }

  /** The kept samples, one array per channel; the blocks are released. */
  take(): Float32Array[] {
    const out = Array.from({ length: this.channels }, () => new Float32Array(this.kept));
    let at = 0;
    for (const block of this.blocks) {
      block.forEach((c, i) => out[i]?.set(c, at));
      at += block[0]?.length ?? 0;
    }
    this.blocks.length = 0;
    return out;
  }
}
