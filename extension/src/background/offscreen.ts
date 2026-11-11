// Offscreen document lifecycle (ADR-0001, ADR-0003).
// Reasons are USER_MEDIA and WORKERS only. Never AUDIO_PLAYBACK: it closes the
// document after 30 s of silence, i.e. a paused video (AGENTS.md R7, VC-03).

export const OFFSCREEN_PATH = 'offscreen.html';

export const OFFSCREEN_REASONS: readonly chrome.offscreen.Reason[] = [
  chrome.offscreen.Reason.USER_MEDIA,
  chrome.offscreen.Reason.WORKERS,
];

const OFFSCREEN_JUSTIFICATION =
  'Plays the captured tab audio back and analyses it locally; nothing leaves the device.';

/**
 * Dedupes concurrent creations within one service-worker lifetime only. It is
 * not session state: the truth is always re-read from `getContexts`.
 */
let creating: Promise<void> | null = null;

export async function hasOffscreen(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

export async function ensureOffscreen(): Promise<void> {
  if (creating !== null) return creating;
  creating = (async () => {
    if (await hasOffscreen()) return;
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: [...OFFSCREEN_REASONS],
      justification: OFFSCREEN_JUSTIFICATION,
    });
  })();
  try {
    await creating;
  } finally {
    creating = null;
  }
}

/** Closes the document if it exists; a failure here is not actionable. */
export async function closeOffscreen(): Promise<void> {
  try {
    if (await hasOffscreen()) await chrome.offscreen.closeDocument();
  } catch {
    // Already closed or closing.
  }
}
