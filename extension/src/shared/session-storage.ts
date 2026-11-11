// Keys of chrome.storage.session shared by the service worker and the side
// panel. Routing state only: never a stream ID, token or audio (AGENTS.md R1).
// The service worker re-reads it at every wake-up: no state in its globals
// (SPEC §5, §14; VC-16).
import type { CaptureErrorCode, SessionId } from '@voicecrystal/contracts';
import { isCaptureErrorCode, isSessionId } from '@voicecrystal/contracts';

export const LAST_START_KEY = 'lastStart';
export const ACTIVE_SESSION_KEY = 'activeSession';

/**
 * Where a session's audio comes from. A tab session is bound to its tab
 * (heartbeats, tabs.onRemoved); a microphone session has no tab at all, so
 * the field does not exist rather than being a placeholder.
 */
export type SessionTarget = { source: 'tab'; tabId: number } | { source: 'mic' };

/**
 * Outcome of the latest start request (toolbar click or «Usa il microfono»),
 * written by the service worker. It is not the active session: a refused start
 * (CAPTURE_BUSY) overwrites it while the first session keeps running.
 */
export type LastStart = { sessionId: SessionId; failure: CaptureErrorCode | null } & SessionTarget;

/** The session the offscreen is running, written before the start message, removed at its final message. */
export type ActiveSession = { sessionId: SessionId } & SessionTarget;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTarget(value: Record<string, unknown>): boolean {
  switch (value['source']) {
    case 'tab':
      return Number.isSafeInteger(value['tabId']);
    case 'mic':
      return !('tabId' in value);
    default:
      return false;
  }
}

export function isActiveSession(value: unknown): value is ActiveSession {
  return isRecord(value) && isSessionId(value['sessionId']) && isTarget(value);
}

export function isLastStart(value: unknown): value is LastStart {
  if (!isRecord(value)) return false;
  const failure = value['failure'];
  return isSessionId(value['sessionId']) && isTarget(value) && (failure === null || isCaptureErrorCode(failure));
}

export async function readActiveSession(): Promise<ActiveSession | null> {
  const items = await chrome.storage.session.get(ACTIVE_SESSION_KEY);
  const value: unknown = items[ACTIVE_SESSION_KEY];
  return isActiveSession(value) ? value : null;
}
