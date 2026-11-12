// Keys of chrome.storage.session shared by the service worker and the side
// panel. Routing state only: never a stream ID, token or audio (AGENTS.md R1).
// The service worker re-reads it at every wake-up: no state in its globals
// (SPEC §5, §14; VC-16).
import type { CaptureErrorCode, FileSessionPing, SessionId } from '@voicecrystal/contracts';
import { isCaptureErrorCode, isFileSessionPong, isSessionId } from '@voicecrystal/contracts';

export const LAST_START_KEY = 'lastStart';
export const ACTIVE_SESSION_KEY = 'activeSession';

/**
 * Where a session's audio comes from. A tab session is bound to its tab
 * (heartbeats, tabs.onRemoved); a microphone session has no tab at all, so
 * the field does not exist rather than being a placeholder. A file session
 * runs in the side panel that asked for it (ADR-0022) and lives as long as
 * that panel answers FILE_SESSION_PING.
 */
export type SessionTarget = { source: 'tab'; tabId: number } | { source: 'mic' } | { source: 'file' };

/**
 * Outcome of the latest start request (toolbar click, «Usa il microfono» or
 * «Analizza»), written by the service worker. It is not the active session: a
 * refused start (CAPTURE_BUSY) overwrites it while the first session keeps
 * running.
 */
export type LastStart = { sessionId: SessionId; failure: CaptureErrorCode | null } & SessionTarget;

/**
 * The running session: for the tab and the microphone, written before the
 * offscreen's start message and removed at its final message; for a file,
 * written when the start is accepted and removed at FILE_SESSION_END.
 */
export type ActiveSession = { sessionId: SessionId } & SessionTarget;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTarget(value: Record<string, unknown>): boolean {
  switch (value['source']) {
    case 'tab':
      return Number.isSafeInteger(value['tabId']);
    case 'mic':
    case 'file':
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

/**
 * [H] How long the service worker waits for the running panel's pong. The
 * panel answers from its main thread, which does no long synchronous work
 * (decoding is asynchronous, the DSP runs in a worker).
 */
export const FILE_PING_TIMEOUT_MS = 1_000;

/**
 * Whether a file session is still running: its side panel answers the ping
 * (ADR-0022). A closed panel took its decoder and worker with it, so its
 * routing state is orphaned. No answer, an error or a timeout all read as
 * «gone»: a stale record must not refuse every later start.
 */
export async function isFileSessionAlive(sessionId: SessionId): Promise<boolean> {
  const ping: FileSessionPing = { v: 1, type: 'FILE_SESSION_PING', sessionId };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      resolve(undefined);
    }, FILE_PING_TIMEOUT_MS);
  });
  try {
    const reply: unknown = await Promise.race([chrome.runtime.sendMessage(ping), timeout]);
    return isFileSessionPong(reply) && reply.sessionId === sessionId;
  } catch {
    return false; // no receiver at all
  } finally {
    clearTimeout(timer);
  }
}
