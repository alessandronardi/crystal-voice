// Start of a tab capture (SPEC §5, ADR-0002). The service worker coordinates
// only: the offscreen document owns the stream and the authoritative state.
import type { CaptureErrorCode, OffscreenStartTab } from '@voicecrystal/contracts';
import { LAST_START_KEY, type LastStart } from '../shared/session-storage.ts';
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
  try {
    // One capture per profile (SPEC §5): a live offscreen means a session,
    // because every failed start below closes the document it created.
    // The full CAPTURE_BUSY flow (offer to stop the first one) is I-03.
    if (await hasOffscreen()) {
      await fail('CAPTURE_BUSY');
      return;
    }
    await recordStart(start);
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
    streamId,
  };
  try {
    await chrome.runtime.sendMessage(message);
  } catch {
    await closeOffscreen();
    await fail('OFFSCREEN_FAILED');
  }
}
