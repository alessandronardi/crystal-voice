// Service worker (SPEC §5): toolbar action, offscreen lifecycle, routing.
// No authoritative state in globals: Chrome terminates this worker (SPEC §5,
// VC-16). Every listener is registered at the top level, so a wake-up by any
// event finds it, and every handler re-reads chrome.storage.session.
// No setPanelBehavior({ openPanelOnActionClick }): it suppresses onClicked (ADR-0002).
import {
  isCaptureDiag,
  isCaptureStartMessage,
  isCaptureStopMessage,
  isPingMessage,
  makePong,
} from '@voicecrystal/contracts';
import { isOwnExtensionContext } from '../shared/sender.ts';
import { onCaptureStatus, onDiag, onTabRemoved, onTabUpdated, stopActiveSession } from './routing.ts';
import { isYoutubeWatchUrl, onActionClicked, onCaptureStartRequest } from './start-capture.ts';

chrome.action.onClicked.addListener(onActionClicked);

chrome.tabs.onRemoved.addListener((tabId) => {
  onTabRemoved(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  onTabUpdated(tabId, changeInfo, isYoutubeWatchUrl);
});

chrome.tabCapture.onStatusChanged.addListener((info) => {
  onCaptureStatus(info.tabId, info.status);
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  // Only this extension's own contexts: no content scripts, no externally_connectable.
  if (!isOwnExtensionContext(sender)) return false;
  if (isPingMessage(message)) {
    sendResponse(makePong(message, chrome.runtime.getManifest().version));
  } else if (isCaptureStartMessage(message)) {
    void onCaptureStartRequest(message);
  } else if (isCaptureStopMessage(message)) {
    void stopActiveSession(message.sessionId, 'USER_STOP');
  } else if (isCaptureDiag(message)) {
    void onDiag(message);
  }
  return false;
});
