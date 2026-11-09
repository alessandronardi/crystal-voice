// Service worker (SPEC §5). In I-01 it only answers the diagnostic ping used
// by the E2E test. action.onClicked and capture routing arrive in I-02/I-03.
// No authoritative state in globals: Chrome terminates this worker (SPEC §5, VC-16).
import { isPingMessage, makePong } from '@voicecrystal/contracts';

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  // Only this extension's own pages may ping (no externally_connectable).
  if (sender.id !== chrome.runtime.id || !isPingMessage(message)) return false;
  sendResponse(makePong(message, chrome.runtime.getManifest().version));
  return false;
});
