// Routing of the extra lifecycle signals to the offscreen (SPEC §5, §14;
// ADR-0004). The heartbeat watchdog in the offscreen is the main defence;
// these are additional signals, never the only one. State comes from
// chrome.storage.session at every call (VC-16).
import {
  isTerminalCaptureState,
  type CaptureDiag,
  type FileSessionEnd,
  type OffscreenStop,
  type OffscreenStopReason,
  type SessionId,
} from '@voicecrystal/contracts';
import { ACTIVE_SESSION_KEY, readActiveSession } from '../shared/session-storage.ts';

export async function stopActiveSession(sessionId: SessionId, reason: OffscreenStopReason): Promise<void> {
  const stop: OffscreenStop = { v: 1, type: 'OFFSCREEN_STOP', sessionId, reason };
  // No offscreen means nothing to stop: the rejection is expected.
  await chrome.runtime.sendMessage(stop).catch(() => undefined);
}

async function stopIfTab(tabId: number, reason: OffscreenStopReason): Promise<void> {
  const active = await readActiveSession();
  // A microphone session has no tab: tab signals never stop it.
  if (active?.source === 'tab' && active.tabId === tabId) await stopActiveSession(active.sessionId, reason);
}

/** The captured tab was closed. */
export function onTabRemoved(tabId: number): void {
  void stopIfTab(tabId, 'NAVIGATED_AWAY');
}

/**
 * The captured tab changed. Without the `tabs` permission `status` is always
 * present and `url` only when readable (YouTube, through the content script
 * host). Measured in Chromium 156 (I-03): a pushState inside YouTube gives
 * `status: 'loading'` *with* the new URL; a navigation to another host gives
 * `status: 'loading'` without it. So:
 * - a readable URL off /watch → stop at once;
 * - a readable /watch URL → left to the watchdog (VIDEO_CHANGED or alive);
 * - loading with no readable URL → the document is going away (other host or
 *   reload): stop at once.
 */
export function onTabUpdated(
  tabId: number,
  change: { status?: string; url?: string },
  isWatchUrl: (u: string) => boolean,
): void {
  const leaving =
    change.url !== undefined ? !isWatchUrl(change.url) : change.status === 'loading';
  if (leaving) void stopIfTab(tabId, 'NAVIGATED_AWAY');
}

/** tabCapture.onStatusChanged: a stopped or failed capture ends the session. */
export function onCaptureStatus(tabId: number, status: string): void {
  if (status === 'stopped' || status === 'error') void stopIfTab(tabId, 'STREAM_ENDED');
}

/** A side panel's file analysis is over: clear its routing state, and only its own (ADR-0022). */
export async function onFileSessionEnd(message: FileSessionEnd): Promise<void> {
  const active = await readActiveSession();
  if (active?.source === 'file' && active.sessionId === message.sessionId) {
    await chrome.storage.session.remove(ACTIVE_SESSION_KEY);
  }
}

/** The offscreen's final message clears the routing state of its session. */
export async function onDiag(message: CaptureDiag): Promise<void> {
  if (!isTerminalCaptureState(message.state)) return;
  const active = await readActiveSession();
  if (active?.sessionId === message.sessionId) await chrome.storage.session.remove(ACTIVE_SESSION_KEY);
}

