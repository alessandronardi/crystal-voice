// Who may talk to the extension's own contexts: only documents and workers of
// this extension (pages, side panel, offscreen, service worker). Content
// scripts share the extension id but run on a web page, so their sender URL is
// the page's; they are rejected (they have no business in capture routing).
export function isOwnExtensionContext(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  const url = sender.url;
  return url !== undefined && url.startsWith(chrome.runtime.getURL(''));
}
