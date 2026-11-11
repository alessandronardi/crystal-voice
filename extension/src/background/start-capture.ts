// Start of a tab capture (SPEC §5, ADR-0002). The service worker coordinates
// only: the offscreen document owns the stream and the authoritative state.
import type { CaptureErrorCode, OffscreenStartTab, SessionBind } from '@voicecrystal/contracts';
import {
  ACTIVE_SESSION_KEY,
  LAST_START_KEY,
  readActiveSession,
  type ActiveSession,
  type LastStart,
} from '../shared/session-storage.ts';
import { stopActiveSession } from './routing.ts';
import { closeOffscreen, ensureOffscreen, hasOffscreen } from './offscreen.ts';

/** Only https://www.youtube.com/watch with a `v` parameter (SPEC §5). */
export function isYoutubeWatchUrl(url: string | undefined): boolean {
  if (url === undefined) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === 'https:' &&
    parsed.hostname === 'www.youtube.com' &&
    parsed.pathname === '/watch' &&
    (parsed.searchParams.get('v') ?? '') !== ''
  );
}

async function recordStart(start: LastStart): Promise<void> {
  await chrome.storage.session.set({ [LAST_START_KEY]: start });
}

/**
 * Listener for chrome.action.onClicked. `sidePanel.open()` MUST be the first
 * statement and synchronous: any await before it loses the user gesture
 * (AGENTS.md R6, ADR-0002).
 */
export function onActionClicked(tab: chrome.tabs.Tab): void {
  if (tab.id === undefined) return;
  void chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined);
  void startTabCapture(tab.id, tab.url);
}

/**
 * A start in progress within this service-worker lifetime. Like the shared
 * promise of ensureOffscreen it only dedupes concurrent clicks; it is not
 * session state (the offscreen holds that).
 */
let starting: Promise<void> | null = null;

export async function startTabCapture(tabId: number, url: string | undefined): Promise<void> {
  const start: LastStart = { sessionId: crypto.randomUUID(), tabId, source: 'tab', failure: null };
  const fail = (failure: CaptureErrorCode): Promise<void> => recordStart({ ...start, failure });

  if (!isYoutubeWatchUrl(url)) {
    await fail('NOT_YOUTUBE_WATCH');
    return;
  }
  // A second click while the first is still starting: one session only, and
  // no second stream ID is asked (SPEC §5).
  if (starting !== null) {
    await fail('CAPTURE_BUSY');
    return;
  }
  starting = runStart(start, fail);
  try {
    await starting;
  } finally {
    starting = null;
  }
}

async function runStart(start: LastStart, fail: (failure: CaptureErrorCode) => Promise<void>): Promise<void> {
  // Recorded before any await: a second click arriving meanwhile writes its
  // CAPTURE_BUSY after this, so the panel keeps showing it (review M-1).
  const recorded = recordStart(start);
  try {
    await recorded;
    // One capture per profile (SPEC §5). A live offscreen means a session,
    // because every failed start below closes the document it created; the
    // side panel offers to stop it. A recorded session without an offscreen
    // is stale (the document died): clean it and go on.
    if (await hasOffscreen()) {
      await fail('CAPTURE_BUSY');
      return;
    }
    if ((await readActiveSession()) !== null) await chrome.storage.session.remove(ACTIVE_SESSION_KEY);
    await ensureOffscreen();
  } catch {
    await closeOffscreen();
    await fail('OFFSCREEN_FAILED');
    return;
  }

  // Asked only after the offscreen exists, sent at once, exactly once, never stored.
  let streamId: string;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: start.tabId });
  } catch {
    // No session was started: release the document (ADR-0003), or every
    // later click would be refused as CAPTURE_BUSY.
    await closeOffscreen();
    await fail('STREAM_NOT_AVAILABLE');
    return;
  }
  const message: OffscreenStartTab = {
    v: 1,
    type: 'OFFSCREEN_START_TAB',
    sessionId: start.sessionId,
    tabId: start.tabId,
    streamId,
  };
  const active: ActiveSession = { sessionId: start.sessionId, tabId: start.tabId, source: 'tab' };
  try {
    // Routing state first, so the final message of the session can clear it.
    await chrome.storage.session.set({ [ACTIVE_SESSION_KEY]: active });
    await chrome.runtime.sendMessage(message);
  } catch {
    await chrome.storage.session.remove(ACTIVE_SESSION_KEY).catch(() => undefined);
    await closeOffscreen();
    await fail('OFFSCREEN_FAILED');
    return;
  }

  // Tell the tab's content script which session to keep alive (ADR-0004).
  const bindMessage: SessionBind = { v: 1, type: 'SESSION_BIND', sessionId: start.sessionId };
  try {
    await chrome.tabs.sendMessage(start.tabId, bindMessage);
  } catch {
    // No content script (page loaded before the extension, or not a YouTube
    // page any more): without heartbeats the session must not run.
    await stopActiveSession(start.sessionId, 'NAVIGATED_AWAY');
  }
}
