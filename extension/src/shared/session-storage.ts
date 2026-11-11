// Keys of chrome.storage.session shared by the service worker and the side
// panel. Routing state only: never a stream ID, token or audio (AGENTS.md R1).
import type { CaptureErrorCode, SessionId } from '@voicecrystal/contracts';

export const LAST_START_KEY = 'lastStart';

/**
 * Outcome of the latest toolbar click, written by the service worker. It is
 * not the active session: a refused click (CAPTURE_BUSY) overwrites it while
 * the first session keeps running. Session routing state arrives with I-03.
 */
export interface LastStart {
  sessionId: SessionId;
  tabId: number;
  source: 'tab';
  failure: CaptureErrorCode | null;
}
