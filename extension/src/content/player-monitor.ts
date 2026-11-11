// Pure detection of player events that end a session (SPEC §6), from the
// standard <video> element only (AGENTS.md R4). No DOM access here: the
// content script passes snapshots and event names, so this runs in Node.
import type { PlayerEventKind } from '@voicecrystal/contracts';

/** SPEC §6: a currentTime jump larger than this without `seeking` is a suspected source change. */
export const TIME_JUMP_TOLERANCE_S = 1;

export interface VideoSnapshot {
  /** Media time, seconds. */
  currentTime: number;
  currentSrc: string;
  paused: boolean;
  playbackRate: number;
  seeking: boolean;
  /** Wall clock of the snapshot, milliseconds (performance.now()). */
  at: number;
}

/** Standard media events the content script listens to. */
export type MediaEventName = 'seeking' | 'emptied' | 'loadstart' | 'durationchange';

export const WATCHED_MEDIA_EVENTS: readonly MediaEventName[] = ['seeking', 'emptied', 'loadstart', 'durationchange'];

export function kindOfMediaEvent(name: MediaEventName): PlayerEventKind {
  return name === 'seeking' ? 'seek' : 'source-change';
}

export class PlayerMonitor {
  private last: VideoSnapshot | null = null;

  /** Compares with the previous snapshot; returns the event to report, if any. */
  observe(snapshot: VideoSnapshot): PlayerEventKind | null {
    const previous = this.last;
    this.last = snapshot;
    if (previous === null) return null;
    if (snapshot.currentSrc !== previous.currentSrc) return 'source-change';
    if (snapshot.seeking || previous.seeking) return null;
    const wallSeconds = Math.max(0, snapshot.at - previous.at) / 1000;
    // While playing, media time advances by at most wall time × rate; paused, not at all.
    const expected = previous.paused ? 0 : wallSeconds * previous.playbackRate;
    const actual = snapshot.currentTime - previous.currentTime;
    // SPEC §6: a *jump* of currentTime. Advancing less than expected is a stall
    // (buffering, a late timer), not a jump, so only these count (review M-4):
    // ahead of the expected position, or backwards.
    const jumpedAhead = actual > expected + TIME_JUMP_TOLERANCE_S;
    const jumpedBack = actual < -TIME_JUMP_TOLERANCE_S;
    return jumpedAhead || jumpedBack ? 'source-change' : null;
  }

  reset(): void {
    this.last = null;
  }
}

export interface VideoCandidate {
  paused: boolean;
  /** Rendered area in CSS pixels (0 when hidden). */
  area: number;
}

/**
 * The main player among the page's standard <video> elements (review M-5):
 * YouTube pages can hold more than one (hover previews, a kept-alive page,
 * the miniplayer). The largest rendered one wins (hidden ones have area 0);
 * on equal area a playing one. Not "playing first": a hover preview starting
 * while the user has paused the player must not read as a resume. Null when
 * there is none. Uses only standard properties (AGENTS.md R4).
 */
export function pickMainVideo(candidates: readonly VideoCandidate[]): number | null {
  let best: number | null = null;
  for (const [i, c] of candidates.entries()) {
    const current = best === null ? undefined : candidates[best];
    if (current === undefined) {
      best = i;
      continue;
    }
    const better = c.area !== current.area ? c.area > current.area : current.paused && !c.paused;
    if (better) best = i;
  }
  return best;
}

/** `v` of a https://www.youtube.com/watch URL, or '' when absent. */
export function videoIdOf(href: string): string {
  try {
    return new URL(href).searchParams.get('v') ?? '';
  } catch {
    return '';
  }
}
