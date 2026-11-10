// Mono mix with phase-cancellation fallback (ADR-0016, SPEC §7.1).
//
// Rule: mono = mean of the channels. On 20 ms frames whose loudest channel is
// above ACTIVE_FRAME_DBFS, cancellation = 20·log10(rmsChannels / rmsMono),
// with rmsChannels the quadratic mean of the per-channel RMS. If the median
// over active frames exceeds PHASE_CANCELLATION_DB, the analysis uses the
// channel with the highest overall RMS (ties: lowest index) and reports
// PHASE_CANCELLATION. The choice is made once, over the whole input.
// The last frame may be partial; it counts in the median like a full frame.
// Whole-buffer API: block-wise use would need a decision rule across blocks
// (the ADR-0016 block-order property applies once a streaming path exists).

import type { QualityWarning } from '@voicecrystal/contracts';
import {
  ACTIVE_FRAME_DBFS,
  CANCELLATION_CAP_DB,
  MONO_CHECK_FRAME_SECONDS,
  PHASE_CANCELLATION_DB,
} from './config.ts';
import { DspInputError } from './errors.ts';
import { median } from './stats.ts';

export type MonoRule = 'single-channel' | 'average' | 'channel-fallback';

export interface MonoMix {
  pcm: Float32Array;
  rule: MonoRule;
  /** Channel used by 'channel-fallback', otherwise null. */
  channelIndex: number | null;
  /** Median cancellation over active frames, dB; null with one channel or no active frame. */
  cancellationDb: number | null;
  warnings: QualityWarning[];
}

export function validateChannels(channels: readonly Float32Array[], sampleRate: number): number {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new DspInputError('BAD_SAMPLE_RATE', `sample rate ${String(sampleRate)}`);
  }
  const first = channels[0];
  if (first === undefined) throw new DspInputError('BAD_CHANNELS', 'no channels');
  for (const ch of channels) {
    if (ch.length !== first.length) throw new DspInputError('BAD_CHANNELS', 'channel lengths differ');
    for (const v of ch) {
      if (!Number.isFinite(v)) throw new DspInputError('NON_FINITE_INPUT', 'non-finite PCM sample');
    }
  }
  return first.length;
}

const ACTIVE_RMS = 10 ** (ACTIVE_FRAME_DBFS / 20);

export function mixToMono(channels: readonly Float32Array[], sampleRate: number): MonoMix {
  const length = validateChannels(channels, sampleRate);
  const count = channels.length;
  const first = channels[0];
  if (first === undefined) throw new DspInputError('BAD_CHANNELS', 'no channels');
  if (count === 1) {
    return { pcm: first.slice(), rule: 'single-channel', channelIndex: null, cancellationDb: null, warnings: [] };
  }

  const mono = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const ch of channels) sum += ch[i] ?? 0;
    mono[i] = sum / count;
  }

  const frame = Math.max(1, Math.round(MONO_CHECK_FRAME_SECONDS * sampleRate));
  const perFrame: number[] = [];
  const totalEnergy = new Float64Array(count);
  for (let start = 0; start < length; start += frame) {
    const end = Math.min(length, start + frame);
    const n = end - start;
    let monoEnergy = 0;
    let meanSquareOfRms = 0;
    let loudest = 0;
    for (let c = 0; c < count; c++) {
      const ch = channels[c];
      let e = 0;
      for (let i = start; i < end; i++) {
        const v = ch?.[i] ?? 0;
        e += v * v;
      }
      totalEnergy[c] = (totalEnergy[c] ?? 0) + e;
      meanSquareOfRms += e / n;
      loudest = Math.max(loudest, Math.sqrt(e / n));
    }
    for (let i = start; i < end; i++) {
      const v = mono[i] ?? 0;
      monoEnergy += v * v;
    }
    if (loudest <= ACTIVE_RMS) continue;
    const rmsChannels = Math.sqrt(meanSquareOfRms / count);
    const rmsMono = Math.sqrt(monoEnergy / n);
    perFrame.push(rmsMono > 0 ? Math.min(CANCELLATION_CAP_DB, 20 * Math.log10(rmsChannels / rmsMono)) : CANCELLATION_CAP_DB);
  }

  const cancellationDb = median(perFrame);
  if (cancellationDb === null || cancellationDb <= PHASE_CANCELLATION_DB) {
    return { pcm: mono, rule: 'average', channelIndex: null, cancellationDb, warnings: [] };
  }
  let best = 0;
  for (let c = 1; c < count; c++) if ((totalEnergy[c] ?? 0) > (totalEnergy[best] ?? 0)) best = c;
  const chosen = channels[best] ?? first;
  return {
    pcm: chosen.slice(),
    rule: 'channel-fallback',
    channelIndex: best,
    cancellationDb,
    warnings: ['PHASE_CANCELLATION'],
  };
}
