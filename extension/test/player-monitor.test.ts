// Player event detection of the content script (SPEC §6), pure.
import { describe, expect, it } from 'vitest';
import {
  PlayerMonitor,
  kindOfMediaEvent,
  pickMainVideo,
  videoIdOf,
  type VideoSnapshot,
} from '../src/content/player-monitor.ts';

const base: VideoSnapshot = {
  currentTime: 10,
  currentSrc: 'blob:https://www.youtube.com/1',
  paused: false,
  playbackRate: 1,
  seeking: false,
  at: 0,
};

function after(previous: VideoSnapshot, ms: number, changes: Partial<VideoSnapshot> = {}): VideoSnapshot {
  const advance = previous.paused ? 0 : (ms / 1000) * previous.playbackRate;
  return { ...previous, currentTime: previous.currentTime + advance, at: previous.at + ms, ...changes };
}

describe('PlayerMonitor', () => {
  it('reports nothing for normal playback and for a pause', () => {
    const monitor = new PlayerMonitor();
    let s = base;
    expect(monitor.observe(s)).toBeNull();
    for (let i = 0; i < 5; i++) {
      s = after(s, 1_000);
      expect(monitor.observe(s)).toBeNull();
    }
    s = after(s, 1_000, { paused: true });
    expect(monitor.observe(s)).toBeNull();
    s = after(s, 5_000);
    expect(monitor.observe(s)).toBeNull();
  });

  it('a jump of more than 1 s without seeking is a suspected source change', () => {
    const monitor = new PlayerMonitor();
    monitor.observe(base);
    expect(monitor.observe({ ...after(base, 1_000), currentTime: base.currentTime + 1 + 1.2 })).toBe('source-change');
  });

  it('a jump back (pre-roll ad ending, restart) is also a source change', () => {
    const monitor = new PlayerMonitor();
    monitor.observe(base);
    expect(monitor.observe({ ...after(base, 1_000), currentTime: 0 })).toBe('source-change');
  });

  it('a stall (buffering, late timer) is not a jump (review M-4)', () => {
    const monitor = new PlayerMonitor();
    monitor.observe(base);
    expect(monitor.observe({ ...base, at: base.at + 2_000 })).toBeNull();
    expect(monitor.observe({ ...base, at: base.at + 10_000, currentTime: base.currentTime + 0.5 })).toBeNull();
  });

  it('a jump within 1 s of the expectation is tolerated', () => {
    const monitor = new PlayerMonitor();
    monitor.observe(base);
    expect(monitor.observe({ ...after(base, 1_000), currentTime: base.currentTime + 1.9 })).toBeNull();
  });

  it('jumps during seeking are left to the seeking event', () => {
    const monitor = new PlayerMonitor();
    monitor.observe(base);
    expect(monitor.observe({ ...after(base, 1_000), currentTime: 300, seeking: true })).toBeNull();
  });

  it('a different currentSrc is a source change', () => {
    const monitor = new PlayerMonitor();
    monitor.observe(base);
    expect(monitor.observe(after(base, 1_000, { currentSrc: 'blob:https://www.youtube.com/2' }))).toBe('source-change');
  });

  it('accounts for the playback rate it observed', () => {
    const monitor = new PlayerMonitor();
    const fast = { ...base, playbackRate: 2 };
    monitor.observe(fast);
    expect(monitor.observe(after(fast, 1_000))).toBeNull();
  });

  it('reset forgets the previous snapshot', () => {
    const monitor = new PlayerMonitor();
    monitor.observe(base);
    monitor.reset();
    expect(monitor.observe({ ...base, currentTime: 500 })).toBeNull();
  });
});

describe('pickMainVideo (review M-5)', () => {
  it('picks the largest rendered video; on equal area the playing one', () => {
    expect(pickMainVideo([])).toBeNull();
    expect(pickMainVideo([{ paused: true, area: 0 }])).toBe(0);
    // The user paused the player while a small hover preview plays: the player stays.
    expect(
      pickMainVideo([
        { paused: true, area: 900_000 },
        { paused: false, area: 40_000 },
      ]),
    ).toBe(0);
    // A kept-alive hidden page has area 0.
    expect(
      pickMainVideo([
        { paused: false, area: 0 },
        { paused: false, area: 900_000 },
      ]),
    ).toBe(1);
    expect(
      pickMainVideo([
        { paused: true, area: 0 },
        { paused: false, area: 0 },
      ]),
    ).toBe(1);
    expect(
      pickMainVideo([
        { paused: true, area: 0 },
        { paused: true, area: 500 },
      ]),
    ).toBe(1);
  });
});

describe('media events and URLs', () => {
  it('maps seeking to seek and the others to source-change', () => {
    expect(kindOfMediaEvent('seeking')).toBe('seek');
    expect(kindOfMediaEvent('emptied')).toBe('source-change');
    expect(kindOfMediaEvent('loadstart')).toBe('source-change');
    expect(kindOfMediaEvent('durationchange')).toBe('source-change');
  });

  it('reads v from a watch URL', () => {
    expect(videoIdOf('https://www.youtube.com/watch?v=abc&t=3')).toBe('abc');
    expect(videoIdOf('https://www.youtube.com/')).toBe('');
    expect(videoIdOf('nonsense')).toBe('');
  });
});
