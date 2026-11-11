// Keys of chrome.storage.session shared by the service worker and the side
// panel. Routing state only: never a stream ID, token or audio (AGENTS.md R1).
// The service worker re-reads it at every wake-up: no state in its globals
// (SPEC §5, §14; VC-16).
import type { CaptureErrorCode, SessionId } from '@voicecrystal/contracts';
import { isCaptureErrorCode, isSessionId } from '@voicecrystal/contracts';

export const LAST_START_KEY = 'lastStart';
export const ACTIVE_SESSION_KEY = 'activeSession';

/**
 * Outcome of the latest toolbar click, written by the service worker. It is
 * not the active session: a refused click (CAPTURE_BUSY) overwrites it while
 * the first session keeps running.
 */
export interface LastStart {
  sessionId: SessionId;
  tabId: number;
  source: 'tab';
  failure: CaptureErrorCode | null;
}

/** The session the offscreen is running, written before the start message, removed at its final message. */
export interface ActiveSession {
  sessionId: SessionId;
  tabId: number;
  source: 'tab';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isActiveSession(value: unknown): value is ActiveSession {
  return (
    isRecord(value) &&
    isSessionId(value['sessionId']) &&
    Number.isSafeInteger(value['tabId']) &&
    value['source'] === 'tab'
  );
}

export function isLastStart(value: unknown): value is LastStart {
  const failure = isRecord(value) ? value['failure'] : undefined;
  return (
    isRecord(value) &&
    isSessionId(value['sessionId']) &&
    Number.isSafeInteger(value['tabId']) &&
    value['source'] === 'tab' &&
    (failure === null || isCaptureErrorCode(failure))
  );
}

export async function readActiveSession(): Promise<ActiveSession | null> {
  const items = await chrome.storage.session.get(ACTIVE_SESSION_KEY);
  const value: unknown = items[ACTIVE_SESSION_KEY];
  return isActiveSession(value) ? value : null;
}
