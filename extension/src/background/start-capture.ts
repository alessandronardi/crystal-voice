// Start of a tab capture (SPEC §5, ADR-0002) or of a microphone session
// (I-17). The service worker coordinates only: the offscreen document owns the
// stream and the authoritative state.
import type {
  CaptureErrorCode,
  CaptureStartMessage,
  OffscreenStartMic,
  OffscreenStartTab,
  SessionBind,
  SessionId,
} from '@voicecrystal/contracts';
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
  const start: LastStart & { source: 'tab' } = { sessionId: crypto.randomUUID(), tabId, source: 'tab', failure: null };
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
  starting = runTabStart(start, fail);
  try {
    await starting;
  } finally {
    starting = null;
  }
}

/**
 * Start of a microphone session, asked by the side panel (SPEC §5: «Usa il
 * microfono»; I-17). No user gesture is needed here: the microphone permission
 * belongs to the extension's origin and was granted in permission.html. The
 * offscreen is authoritative: it reports MIC_PERMISSION_REQUIRED if it cannot
 * open the microphone. The session id is the panel's, so the panel can attach
 * its port to the session it asked for.
 */
export async function startMicCapture(sessionId: SessionId): Promise<void> {
  const start: LastStart = { sessionId, source: 'mic', failure: null };
  const fail = (failure: CaptureErrorCode): Promise<void> => recordStart({ ...start, failure });
  // One start at a time across both sources (SPEC §5: one capture per profile).
  if (starting !== null) {
    await fail('CAPTURE_BUSY');
    return;
  }
  starting = runMicStart(start, fail);
  try {
    await starting;
  } finally {
    starting = null;
  }
}

/**
 * A SPEC §9 CAPTURE_START from an extension page. Only the microphone starts
 * this way: the tab starts from the toolbar only (SPEC §5 [F], ADR-0002) and
 * files are decoded in the panel (I-18). Anything else is ignored.
 */
export function onCaptureStartRequest(message: CaptureStartMessage): Promise<void> | null {
  return message.source === 'mic' ? startMicCapture(message.sessionId) : null;
}

type Fail = (failure: CaptureErrorCode) => Promise<void>;

/** Records the start and creates the offscreen; false (outcome recorded) when the start cannot go on. */
async function prepareOffscreen(start: LastStart, fail: Fail): Promise<boolean> {
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
      return false;
    }
    if ((await readActiveSession()) !== null) await chrome.storage.session.remove(ACTIVE_SESSION_KEY);
    await ensureOffscreen();
    return true;
  } catch {
    await closeOffscreen();
    await fail('OFFSCREEN_FAILED');
    return false;
  }
}

/** Writes the routing state, then sends the start message; false (document closed) on failure. */
async function deliver(active: ActiveSession, message: OffscreenStartTab | OffscreenStartMic, fail: Fail): Promise<boolean> {
  try {
    // Routing state first, so the final message of the session can clear it.
    await chrome.storage.session.set({ [ACTIVE_SESSION_KEY]: active });
    await chrome.runtime.sendMessage(message);
    return true;
  } catch {
    await chrome.storage.session.remove(ACTIVE_SESSION_KEY).catch(() => undefined);
    await closeOffscreen();
    await fail('OFFSCREEN_FAILED');
    return false;
  }
}

async function runMicStart(start: LastStart & { source: 'mic' }, fail: Fail): Promise<void> {
  if (!(await prepareOffscreen(start, fail))) return;
  const message: OffscreenStartMic = { v: 1, type: 'OFFSCREEN_START_MIC', sessionId: start.sessionId };
  await deliver({ sessionId: start.sessionId, source: 'mic' }, message, fail);
}

async function runTabStart(start: LastStart & { source: 'tab' }, fail: Fail): Promise<void> {
  if (!(await prepareOffscreen(start, fail))) return;

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
  if (!(await deliver(active, message, fail))) return;

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
