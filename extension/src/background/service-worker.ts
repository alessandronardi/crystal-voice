// Service worker (SPEC §5): toolbar action, offscreen lifecycle, routing.
// No authoritative state in globals: Chrome terminates this worker (SPEC §5, VC-16).
// No setPanelBehavior({ openPanelOnActionClick }): it suppresses onClicked (ADR-0002).
import { isCaptureStopMessage, isPingMessage, makePong, type OffscreenStop } from '@voicecrystal/contracts';
import { isOwnExtensionContext } from '../shared/sender.ts';
import { onActionClicked } from './start-capture.ts';

chrome.action.onClicked.addListener(onActionClicked);

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  // Only this extension's own contexts: no content scripts, no externally_connectable.
  if (!isOwnExtensionContext(sender)) return false;
  if (isPingMessage(message)) {
    sendResponse(makePong(message, chrome.runtime.getManifest().version));
    return false;
  }
  if (isCaptureStopMessage(message)) {
    const stop: OffscreenStop = { v: 1, type: 'OFFSCREEN_STOP', sessionId: message.sessionId };
    // No offscreen means nothing to stop: the rejection is expected and ignored.
    void chrome.runtime.sendMessage(stop).catch(() => undefined);
  }
  return false;
});
