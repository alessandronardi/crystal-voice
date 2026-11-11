// Content script on https://www.youtube.com/* (SPEC §5, ADR-0021). Inert until
// the service worker binds a session with SESSION_BIND. Then, while the page is
// a /watch page, it sends the 1 Hz HEARTBEAT of ADR-0004 and reports seek and
// source-change events. It reads only the standard <video> element, its
// properties and events: no YouTube internals, no changes to the player
// (AGENTS.md R4, R5).
import {
  isSessionBind,
  type CaptureMessage,
  type HeartbeatReply,
  type PlayerEvent,
  type PlayerEventKind,
  type SessionId,
} from '@voicecrystal/contracts';
import {
  PlayerMonitor,
  WATCHED_MEDIA_EVENTS,
  kindOfMediaEvent,
  pickMainVideo,
  videoIdOf,
  type MediaEventName,
} from './player-monitor.ts';

const HEARTBEAT_INTERVAL_MS = 1_000;

interface Binding {
  readonly sessionId: SessionId;
  seq: number;
  timer: ReturnType<typeof setInterval>;
  video: HTMLVideoElement | null;
  readonly monitor: PlayerMonitor;
  readonly onMediaEvent: (event: Event) => void;
}

let binding: Binding | null = null;

function isReplyActive(reply: unknown): boolean {
  return typeof reply === 'object' && reply !== null && (reply as HeartbeatReply).active;
}

function unbind(): void {
  if (binding === null) return;
  clearInterval(binding.timer);
  detachVideo(binding);
  binding = null;
}

function detachVideo(b: Binding): void {
  if (b.video === null) return;
  for (const name of WATCHED_MEDIA_EVENTS) b.video.removeEventListener(name, b.onMediaEvent);
  b.video = null;
}

/** The page's main standard <video> element (see pickMainVideo). */
function currentVideo(b: Binding): HTMLVideoElement | null {
  const videos = [...document.querySelectorAll('video')];
  const index = pickMainVideo(
    videos.map((v) => {
      const rect = v.getBoundingClientRect();
      return { paused: v.paused, area: Math.max(0, rect.width) * Math.max(0, rect.height) };
    }),
  );
  const video = index === null ? null : (videos[index] ?? null);
  if (video !== b.video) {
    detachVideo(b);
    if (video !== null) {
      for (const name of WATCHED_MEDIA_EVENTS) video.addEventListener(name, b.onMediaEvent);
    }
    b.video = video;
    b.monitor.reset();
  }
  return video;
}

async function send(b: Binding, message: CaptureMessage | PlayerEvent): Promise<void> {
  let reply: unknown;
  try {
    reply = await chrome.runtime.sendMessage(message);
  } catch {
    reply = undefined; // nobody listening: the session is gone
  }
  if (binding === b && !isReplyActive(reply)) unbind();
}

function report(b: Binding, kind: PlayerEventKind): void {
  void send(b, { v: 1, type: 'PLAYER_EVENT', sessionId: b.sessionId, seq: b.seq++, kind });
}

function beat(b: Binding): void {
  const video = currentVideo(b);
  if (video !== null && location.pathname === '/watch') {
    const kind = b.monitor.observe({
      currentTime: video.currentTime,
      currentSrc: video.currentSrc,
      paused: video.paused,
      playbackRate: video.playbackRate,
      seeking: video.seeking,
      at: performance.now(),
    });
    if (kind !== null) {
      report(b, kind);
      return;
    }
  }
  // Off /watch the heartbeat still goes out once with the new URL, so the
  // offscreen stops at once (NAVIGATED_AWAY) instead of waiting 3 s.
  const heartbeat: CaptureMessage = {
    v: 1,
    type: 'HEARTBEAT',
    sessionId: b.sessionId,
    seq: b.seq++,
    videoId: videoIdOf(location.href).slice(0, 64),
    url: location.href.slice(0, 2048),
    paused: video?.paused ?? true,
    playbackRate: video?.playbackRate ?? 1,
    muted: video?.muted ?? false,
    volume: video?.volume ?? 1,
  };
  void send(b, heartbeat);
}

function bind(sessionId: SessionId): void {
  unbind();
  const b: Binding = {
    sessionId,
    seq: 0,
    timer: setInterval(() => {
      if (binding === b) beat(b);
    }, HEARTBEAT_INTERVAL_MS),
    video: null,
    monitor: new PlayerMonitor(),
    onMediaEvent: (event: Event) => {
      if (binding === b) report(b, kindOfMediaEvent(event.type as MediaEventName));
    },
  };
  binding = b;
  beat(b);
}

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  // Only the service worker of this extension (no tab) may bind a session.
  if (sender.id !== chrome.runtime.id || sender.tab !== undefined) return false;
  if (isSessionBind(message)) bind(message.sessionId);
  return false;
});
