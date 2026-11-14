// Routing logic of the toolbar start (I-02) with a minimal chrome.* mock.
// Real behaviour (gesture, stream, pass-through) is verified in Chromium:
// tests/e2e/tab-capture.spec.ts and tests/e2e/MANUAL_CHECKLIST.md.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

type Calls = string[];

interface ChromeMock {
  calls: Calls;
  contexts: unknown[];
  /** File sessions whose side panel answers FILE_SESSION_PING. */
  livePanels: Set<string>;
  stored: Record<string, unknown>[];
  /** Current content of chrome.storage.session. */
  store: Map<string, unknown>;
  sent: unknown[];
  tabsSendMessage: Mock<(tabId: number, message: unknown) => Promise<unknown>>;
  createDocument: Mock<(options: chrome.offscreen.CreateParameters) => Promise<void>>;
  getMediaStreamId: Mock<(options: { targetTabId: number }) => Promise<string>>;
  sendMessage: Mock<(message: unknown) => Promise<unknown>>;
  closeDocument: Mock<() => Promise<void>>;
}

function installChrome(): ChromeMock {
  const mock: ChromeMock = {
    calls: [],
    contexts: [],
    livePanels: new Set(),
    stored: [],
    store: new Map(),
    sent: [],
    tabsSendMessage: vi.fn<(tabId: number, message: unknown) => Promise<unknown>>(),
    createDocument: vi.fn<(options: chrome.offscreen.CreateParameters) => Promise<void>>(),
    getMediaStreamId: vi.fn<(options: { targetTabId: number }) => Promise<string>>(),
    sendMessage: vi.fn<(message: unknown) => Promise<unknown>>(),
    closeDocument: vi.fn<() => Promise<void>>(),
  };
  mock.sendMessage.mockImplementation((message: unknown) => {
    const m = message as { type?: unknown; sessionId?: unknown };
    // FILE_SESSION_PING (ADR-0022): only a live panel answers; pings are not counted as sent.
    if (m.type === 'FILE_SESSION_PING') {
      mock.calls.push('ping');
      const id = String(m.sessionId);
      return Promise.resolve(mock.livePanels.has(id) ? { v: 1, type: 'FILE_SESSION_PONG', sessionId: id } : undefined);
    }
    mock.calls.push('sendMessage');
    mock.sent.push(message);
    return Promise.resolve(undefined);
  });
  mock.closeDocument.mockImplementation(() => {
    mock.calls.push('closeDocument');
    mock.contexts.length = 0;
    return Promise.resolve();
  });
  mock.createDocument.mockImplementation(() => {
    mock.calls.push('createDocument');
    return Promise.resolve().then(() => {
      mock.contexts.push({ contextType: 'OFFSCREEN_DOCUMENT' });
    });
  });
  mock.tabsSendMessage.mockImplementation(() => {
    mock.calls.push('tabs.sendMessage');
    return Promise.resolve(undefined);
  });
  mock.getMediaStreamId.mockImplementation(() => {
    mock.calls.push('getMediaStreamId');
    return Promise.resolve('stream-id-secret');
  });
  vi.stubGlobal('chrome', {
    offscreen: {
      Reason: { USER_MEDIA: 'USER_MEDIA', WORKERS: 'WORKERS', AUDIO_PLAYBACK: 'AUDIO_PLAYBACK' },
      createDocument: mock.createDocument,
      closeDocument: mock.closeDocument,
    },
    runtime: {
      ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
      getURL: (path: string) => `chrome-extension://test/${path}`,
      getContexts: () => {
        mock.calls.push('getContexts');
        return Promise.resolve([...mock.contexts]);
      },
      sendMessage: mock.sendMessage,
    },
    sidePanel: {
      open: () => {
        mock.calls.push('sidePanel.open');
        return Promise.resolve();
      },
    },
    tabCapture: { getMediaStreamId: mock.getMediaStreamId },
    tabs: { sendMessage: mock.tabsSendMessage },
    storage: {
      session: {
        set: (items: Record<string, unknown>) => {
          mock.calls.push('storage.set');
          mock.stored.push(structuredClone(items));
          for (const [key, value] of Object.entries(items)) mock.store.set(key, structuredClone(value));
          return Promise.resolve();
        },
        get: (keys: string | string[]) => {
          const out: Record<string, unknown> = {};
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            if (mock.store.has(key)) out[key] = mock.store.get(key);
          }
          return Promise.resolve(out);
        },
        remove: (keys: string | string[]) => {
          mock.calls.push('storage.remove');
          for (const key of Array.isArray(keys) ? keys : [keys]) mock.store.delete(key);
          return Promise.resolve();
        },
      },
    },
  });
  return mock;
}

const WATCH = 'https://www.youtube.com/watch?v=abc123';

/** Current lastStart record. */
function lastStart(): Record<string, unknown> | undefined {
  return mock.store.get('lastStart') as Record<string, unknown> | undefined;
}

async function load() {
  vi.resetModules();
  return import('../src/background/start-capture.ts');
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

let mock: ChromeMock;
beforeEach(() => {
  mock = installChrome();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isYoutubeWatchUrl', () => {
  it('accepts only https://www.youtube.com/watch with a video id', async () => {
    const { isYoutubeWatchUrl } = await load();
    expect(isYoutubeWatchUrl(WATCH)).toBe(true);
    expect(isYoutubeWatchUrl('https://www.youtube.com/watch?v=abc&t=10')).toBe(true);
    expect(isYoutubeWatchUrl('https://www.youtube.com/watch')).toBe(false);
    expect(isYoutubeWatchUrl('https://www.youtube.com/watch?v=')).toBe(false);
    expect(isYoutubeWatchUrl('http://www.youtube.com/watch?v=abc')).toBe(false);
    expect(isYoutubeWatchUrl('https://m.youtube.com/watch?v=abc')).toBe(false);
    expect(isYoutubeWatchUrl('https://www.youtube.com.evil.example/watch?v=abc')).toBe(false);
    expect(isYoutubeWatchUrl('https://www.youtube.com/shorts/abc')).toBe(false);
    expect(isYoutubeWatchUrl('not a url')).toBe(false);
    expect(isYoutubeWatchUrl(undefined)).toBe(false);
  });
});

describe('onActionClicked (ADR-0002, R6)', () => {
  it('opens the side panel synchronously, before any other chrome call', async () => {
    const { onActionClicked } = await load();
    onActionClicked({ id: 7, url: WATCH } as chrome.tabs.Tab);
    // Synchronous part only: nothing awaited yet.
    expect(mock.calls[0]).toBe('sidePanel.open');
    await settle();
    expect(mock.calls.indexOf('sidePanel.open')).toBe(0);
  });

  it('does nothing without a tab id', async () => {
    const { onActionClicked } = await load();
    onActionClicked({ url: WATCH } as chrome.tabs.Tab);
    await settle();
    expect(mock.calls).toEqual([]);
  });

  it('creates the offscreen with USER_MEDIA and WORKERS only, then asks the stream id', async () => {
    const { onActionClicked } = await load();
    onActionClicked({ id: 7, url: WATCH } as chrome.tabs.Tab);
    await settle();
    expect(mock.createDocument).toHaveBeenCalledTimes(1);
    const options = mock.createDocument.mock.calls[0]?.[0];
    expect(options?.reasons).toEqual(['USER_MEDIA', 'WORKERS']);
    expect(options?.url).toBe('offscreen.html');
    // The stream id is asked only after the offscreen exists, then sent at once.
    const order = mock.calls.filter((c) => c === 'createDocument' || c === 'getMediaStreamId' || c === 'sendMessage');
    expect(order).toEqual(['createDocument', 'getMediaStreamId', 'sendMessage']);
    expect(mock.getMediaStreamId).toHaveBeenCalledWith({ targetTabId: 7 });
    expect(mock.sent).toHaveLength(1);
    expect(mock.sent[0]).toMatchObject({ v: 1, type: 'OFFSCREEN_START_TAB', streamId: 'stream-id-secret' });
  });

  it('never stores the stream id (R1)', async () => {
    const { onActionClicked } = await load();
    onActionClicked({ id: 7, url: WATCH } as chrome.tabs.Tab);
    await settle();
    expect(mock.stored.length).toBeGreaterThan(0);
    expect(JSON.stringify(mock.stored)).not.toContain('stream-id-secret');
    const start = mock.stored[0]?.['lastStart'] as Record<string, unknown>;
    expect(Object.keys(start).sort()).toEqual(['failure', 'sessionId', 'source', 'tabId']);
  });

  it('on a non-watch page opens the panel, records NOT_YOUTUBE_WATCH and captures nothing', async () => {
    const { onActionClicked } = await load();
    onActionClicked({ id: 7, url: 'https://example.com/' } as chrome.tabs.Tab);
    await settle();
    expect(mock.calls[0]).toBe('sidePanel.open');
    expect(mock.createDocument).not.toHaveBeenCalled();
    expect(mock.getMediaStreamId).not.toHaveBeenCalled();
    expect(lastStart()).toMatchObject({ failure: 'NOT_YOUTUBE_WATCH', tabId: 7 });
  });

  it('with an offscreen already alive records CAPTURE_BUSY and asks no stream id', async () => {
    mock.contexts.push({ contextType: 'OFFSCREEN_DOCUMENT' });
    const { onActionClicked } = await load();
    onActionClicked({ id: 7, url: WATCH } as chrome.tabs.Tab);
    await settle();
    expect(mock.getMediaStreamId).not.toHaveBeenCalled();
    expect(mock.createDocument).not.toHaveBeenCalled();
    expect(lastStart()).toMatchObject({ failure: 'CAPTURE_BUSY' });
  });

  it('maps a getMediaStreamId rejection to STREAM_NOT_AVAILABLE and sends nothing', async () => {
    mock.getMediaStreamId.mockImplementation(() => Promise.reject(new Error('busy')));
    const { onActionClicked } = await load();
    onActionClicked({ id: 7, url: WATCH } as chrome.tabs.Tab);
    await settle();
    expect(mock.sent).toEqual([]);
    expect(lastStart()).toMatchObject({ failure: 'STREAM_NOT_AVAILABLE' });
  });

  it('closes the offscreen after a failed stream id, so the next click can start (review H-1)', async () => {
    mock.getMediaStreamId.mockImplementationOnce(() => Promise.reject(new Error('gone')));
    const { onActionClicked } = await load();
    onActionClicked({ id: 7, url: WATCH } as chrome.tabs.Tab);
    await settle();
    expect(mock.closeDocument).toHaveBeenCalledTimes(1);
    expect(mock.contexts).toHaveLength(0);
    onActionClicked({ id: 7, url: WATCH } as chrome.tabs.Tab);
    await settle();
    expect(lastStart()).toMatchObject({ failure: null });
    expect(mock.sent).toHaveLength(1);
  });

  it('closes the offscreen when the start message cannot be delivered', async () => {
    mock.sendMessage.mockImplementationOnce(() => Promise.reject(new Error('no receiver')));
    const { onActionClicked } = await load();
    onActionClicked({ id: 7, url: WATCH } as chrome.tabs.Tab);
    await settle();
    expect(mock.closeDocument).toHaveBeenCalledTimes(1);
    expect(lastStart()).toMatchObject({ failure: 'OFFSCREEN_FAILED' });
    onActionClicked({ id: 7, url: WATCH } as chrome.tabs.Tab);
    await settle();
    expect(lastStart()).toMatchObject({ failure: null });
  });

  it('two concurrent clicks ask one stream id; the second gets CAPTURE_BUSY (review M-1)', async () => {
    const { onActionClicked } = await load();
    onActionClicked({ id: 7, url: WATCH } as chrome.tabs.Tab);
    onActionClicked({ id: 7, url: WATCH } as chrome.tabs.Tab);
    await settle();
    expect(mock.getMediaStreamId).toHaveBeenCalledTimes(1);
    expect(mock.createDocument).toHaveBeenCalledTimes(1);
    expect(mock.sent).toHaveLength(1);
    // The refused click's outcome is the last one written, so the panel shows it.
    expect(lastStart()).toMatchObject({ failure: 'CAPTURE_BUSY' });
    expect(mock.store.get('activeSession')).toBeDefined();
  });

  it('maps a createDocument rejection to OFFSCREEN_FAILED', async () => {
    mock.createDocument.mockImplementation(() => Promise.reject(new Error('nope')));
    const { onActionClicked } = await load();
    onActionClicked({ id: 7, url: WATCH } as chrome.tabs.Tab);
    await settle();
    expect(mock.getMediaStreamId).not.toHaveBeenCalled();
    expect(lastStart()).toMatchObject({ failure: 'OFFSCREEN_FAILED' });
  });
});

describe('session routing (I-03)', () => {
  it('records the active session before the start message, binds the tab, never stores the stream id', async () => {
    const { onActionClicked } = await load();
    onActionClicked({ id: 7, url: WATCH } as chrome.tabs.Tab);
    await settle();
    const active = mock.store.get('activeSession') as Record<string, unknown>;
    expect(Object.keys(active).sort()).toEqual(['sessionId', 'source', 'tabId']);
    expect(active).toMatchObject({ tabId: 7, source: 'tab' });
    const setActive = mock.calls.indexOf('storage.set', mock.calls.indexOf('getMediaStreamId'));
    expect(setActive).toBeLessThan(mock.calls.indexOf('sendMessage'));
    expect(mock.sent[0]).toMatchObject({ type: 'OFFSCREEN_START_TAB', tabId: 7, sessionId: active['sessionId'] });
    expect(mock.tabsSendMessage).toHaveBeenCalledWith(7, { v: 1, type: 'SESSION_BIND', sessionId: active['sessionId'] });
    expect(JSON.stringify([...mock.store.values()])).not.toContain('stream-id-secret');
  });

  it('stops the session at once when the tab has no content script', async () => {
    mock.tabsSendMessage.mockImplementation(() => Promise.reject(new Error('Receiving end does not exist')));
    const { onActionClicked } = await load();
    onActionClicked({ id: 7, url: WATCH } as chrome.tabs.Tab);
    await settle();
    const active = mock.store.get('activeSession') as { sessionId: string };
    expect(mock.sent.at(-1)).toEqual({ v: 1, type: 'OFFSCREEN_STOP', sessionId: active.sessionId, reason: 'NAVIGATED_AWAY' });
  });

  it('clears a stale active session when no offscreen exists, then starts', async () => {
    mock.store.set('activeSession', { sessionId: '3f1c2b4a-9d8e-4f7a-8b6c-5d4e3f2a1b0c', tabId: 3, source: 'tab' });
    const { onActionClicked } = await load();
    onActionClicked({ id: 7, url: WATCH } as chrome.tabs.Tab);
    await settle();
    expect(lastStart()).toMatchObject({ failure: null });
    expect(mock.store.get('activeSession')).toMatchObject({ tabId: 7 });
  });

  it('closing the captured tab stops its session; other tabs do not', async () => {
    const session = '3f1c2b4a-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
    mock.store.set('activeSession', { sessionId: session, tabId: 7, source: 'tab' });
    vi.resetModules();
    const routing = await import('../src/background/routing.ts');
    routing.onTabRemoved(8);
    await settle();
    expect(mock.sent).toEqual([]);
    routing.onTabRemoved(7);
    await settle();
    expect(mock.sent).toEqual([{ v: 1, type: 'OFFSCREEN_STOP', sessionId: session, reason: 'NAVIGATED_AWAY' }]);
  });

  it('a readable navigation off /watch and a stopped capture end the session', async () => {
    const session = '3f1c2b4a-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
    mock.store.set('activeSession', { sessionId: session, tabId: 7, source: 'tab' });
    vi.resetModules();
    const routing = await import('../src/background/routing.ts');
    const { isYoutubeWatchUrl } = await import('../src/background/start-capture.ts');
    routing.onTabUpdated(7, {}, isYoutubeWatchUrl);
    routing.onTabUpdated(7, { url: WATCH }, isYoutubeWatchUrl);
    routing.onTabUpdated(7, { status: 'complete' }, isYoutubeWatchUrl);
    routing.onTabUpdated(8, { status: 'loading' }, isYoutubeWatchUrl);
    // pushState to another video: loading with a readable /watch URL is the watchdog's call.
    routing.onTabUpdated(7, { status: 'loading', url: 'https://www.youtube.com/watch?v=other' }, isYoutubeWatchUrl);
    routing.onCaptureStatus(7, 'active');
    await settle();
    expect(mock.sent).toEqual([]);
    routing.onTabUpdated(7, { url: 'https://example.com/' }, isYoutubeWatchUrl);
    routing.onTabUpdated(7, { status: 'loading' }, isYoutubeWatchUrl);
    routing.onCaptureStatus(7, 'stopped');
    await settle();
    const stop = (reason: string) => ({ v: 1, type: 'OFFSCREEN_STOP', sessionId: session, reason });
    expect(mock.sent).toEqual([stop('NAVIGATED_AWAY'), stop('NAVIGATED_AWAY'), stop('STREAM_ENDED')]);
  });

  it('the final diagnostic of the active session clears the routing state', async () => {
    const session = '3f1c2b4a-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
    mock.store.set('activeSession', { sessionId: session, tabId: 7, source: 'tab' });
    vi.resetModules();
    const routing = await import('../src/background/routing.ts');
    const base = {
      v: 1 as const,
      type: 'CAPTURE_DIAG' as const,
      seq: 1,
      code: null,
      samples: 0,
      sampleRate: null,
      elapsedMs: 0,
      activeMs: 0,
      baseLatency: null,
      outputLatency: null,
      analysis: null,

      validSpeechMs: 0,

      stability: null,


      provisionalSeed: null,
    };
    await routing.onDiag({ ...base, sessionId: session, state: 'LISTENING', exitReason: null });
    expect(mock.store.has('activeSession')).toBe(true);
    await routing.onDiag({
      ...base,
      sessionId: '00000000-0000-4000-8000-000000000000',
      state: 'INTERRUPTED',
      exitReason: 'USER_STOP',
    });
    expect(mock.store.has('activeSession')).toBe(true);
    await routing.onDiag({ ...base, sessionId: session, state: 'INTERRUPTED', exitReason: 'USER_STOP' });
    expect(mock.store.has('activeSession')).toBe(false);
  });
});

describe('microphone start (I-17)', () => {
  const PANEL_SESSION = '0b9a8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d';

  it('creates the offscreen, records a tab-less session and sends OFFSCREEN_START_MIC', async () => {
    const { startMicCapture } = await load();
    await startMicCapture(PANEL_SESSION);
    expect(mock.createDocument).toHaveBeenCalledTimes(1);
    expect(mock.createDocument.mock.calls[0]?.[0].reasons).toEqual(['USER_MEDIA', 'WORKERS']);
    expect(mock.getMediaStreamId).not.toHaveBeenCalled();
    expect(mock.sent).toEqual([{ v: 1, type: 'OFFSCREEN_START_MIC', sessionId: PANEL_SESSION }]);
    expect(mock.store.get('activeSession')).toEqual({ sessionId: PANEL_SESSION, source: 'mic' });
    expect(lastStart()).toEqual({ sessionId: PANEL_SESSION, source: 'mic', failure: null });
    // No content script to bind: the panel keeps the session alive (port).
    expect(mock.tabsSendMessage).not.toHaveBeenCalled();
  });

  it('is refused with CAPTURE_BUSY while a tab session runs, and touches nothing', async () => {
    mock.contexts.push({ contextType: 'OFFSCREEN_DOCUMENT' });
    mock.store.set('activeSession', { sessionId: '3f1c2b4a-9d8e-4f7a-8b6c-5d4e3f2a1b0c', tabId: 7, source: 'tab' });
    const { startMicCapture } = await load();
    await startMicCapture(PANEL_SESSION);
    expect(mock.createDocument).not.toHaveBeenCalled();
    expect(mock.sent).toEqual([]);
    expect(lastStart()).toMatchObject({ source: 'mic', failure: 'CAPTURE_BUSY' });
    expect(mock.store.get('activeSession')).toMatchObject({ source: 'tab', tabId: 7 });
  });

  it('shares the one-start-at-a-time guard with the toolbar', async () => {
    const { onActionClicked, startMicCapture } = await load();
    onActionClicked({ id: 7, url: WATCH } as chrome.tabs.Tab);
    await startMicCapture(PANEL_SESSION);
    await settle();
    expect(mock.createDocument).toHaveBeenCalledTimes(1);
    expect(mock.sent).toHaveLength(1);
    expect(mock.sent[0]).toMatchObject({ type: 'OFFSCREEN_START_TAB' });
    expect(lastStart()).toMatchObject({ source: 'mic', failure: 'CAPTURE_BUSY' });
  });

  it('closes the offscreen when the start message cannot be delivered', async () => {
    mock.sendMessage.mockImplementationOnce(() => Promise.reject(new Error('no receiver')));
    const { startMicCapture } = await load();
    await startMicCapture(PANEL_SESSION);
    expect(mock.closeDocument).toHaveBeenCalledTimes(1);
    expect(mock.store.has('activeSession')).toBe(false);
    expect(lastStart()).toMatchObject({ source: 'mic', failure: 'OFFSCREEN_FAILED' });
  });

  it('a CAPTURE_START from a page starts the microphone or a file; a tab request is ignored', async () => {
    const { onCaptureStartRequest } = await load();
    const base = { v: 1 as const, type: 'CAPTURE_START' as const, sessionId: PANEL_SESSION, seq: 0 };
    expect(onCaptureStartRequest({ ...base, source: 'tab', tabId: 7 })).toBeNull();
    await settle();
    expect(mock.createDocument).not.toHaveBeenCalled();
    expect(mock.getMediaStreamId).not.toHaveBeenCalled();
    await onCaptureStartRequest({ ...base, source: 'mic', tabId: null });
    expect(mock.sent).toEqual([{ v: 1, type: 'OFFSCREEN_START_MIC', sessionId: PANEL_SESSION }]);
  });

  it('tab signals never stop a microphone session', async () => {
    mock.store.set('activeSession', { sessionId: PANEL_SESSION, source: 'mic' });
    vi.resetModules();
    const routing = await import('../src/background/routing.ts');
    const { isYoutubeWatchUrl } = await import('../src/background/start-capture.ts');
    routing.onTabRemoved(7);
    routing.onTabUpdated(7, { status: 'loading' }, isYoutubeWatchUrl);
    routing.onCaptureStatus(7, 'stopped');
    await settle();
    expect(mock.sent).toEqual([]);
  });

  it('routing records: mic and file records have no tab id, a tab record needs one', async () => {
    vi.resetModules();
    const { isActiveSession, isLastStart } = await import('../src/shared/session-storage.ts');
    expect(isActiveSession({ sessionId: PANEL_SESSION, source: 'mic' })).toBe(true);
    expect(isActiveSession({ sessionId: PANEL_SESSION, source: 'mic', tabId: 7 })).toBe(false);
    expect(isActiveSession({ sessionId: PANEL_SESSION, source: 'tab' })).toBe(false);
    expect(isActiveSession({ sessionId: PANEL_SESSION, source: 'file' })).toBe(true);
    expect(isActiveSession({ sessionId: PANEL_SESSION, source: 'file', tabId: 1 })).toBe(false);
    expect(isActiveSession({ sessionId: PANEL_SESSION, source: 'disk' })).toBe(false);
    expect(isLastStart({ sessionId: PANEL_SESSION, source: 'file', failure: null })).toBe(true);
    expect(isLastStart({ sessionId: PANEL_SESSION, source: 'mic', failure: 'MIC_PERMISSION_REQUIRED' })).toBe(true);
    expect(isLastStart({ sessionId: PANEL_SESSION, source: 'mic', tabId: null, failure: null })).toBe(false);
    expect(isLastStart({ sessionId: PANEL_SESSION, source: 'tab', tabId: 3, failure: 'NOPE' })).toBe(false);
  });
});

describe('file session (I-18, ADR-0022)', () => {
  const FILE_SESSION = '7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d';
  const OTHER = '0b9a8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d';
  const fileActive = (sessionId = FILE_SESSION) => ({ sessionId, source: 'file' });

  it('records the session; no offscreen, no message, no audio', async () => {
    const { startFileSession } = await load();
    await startFileSession(FILE_SESSION);
    expect(mock.store.get('activeSession')).toEqual(fileActive());
    expect(lastStart()).toEqual({ sessionId: FILE_SESSION, source: 'file', failure: null });
    expect(mock.createDocument).not.toHaveBeenCalled();
    expect(mock.sent).toEqual([]);
  });

  it('is refused with CAPTURE_BUSY while a capture runs (offscreen alive)', async () => {
    mock.contexts.push({ contextType: 'OFFSCREEN_DOCUMENT' });
    mock.store.set('activeSession', { sessionId: OTHER, source: 'mic' });
    const { startFileSession } = await load();
    await startFileSession(FILE_SESSION);
    expect(lastStart()).toMatchObject({ source: 'file', failure: 'CAPTURE_BUSY' });
    expect(mock.store.get('activeSession')).toEqual({ sessionId: OTHER, source: 'mic' });
  });

  it('is refused with CAPTURE_BUSY while another panel analyses a file (it answers the ping)', async () => {
    mock.livePanels.add(FILE_SESSION);
    mock.store.set('activeSession', fileActive());
    const { startFileSession } = await load();
    await startFileSession(OTHER);
    expect(lastStart()).toMatchObject({ sessionId: OTHER, failure: 'CAPTURE_BUSY' });
    expect(mock.store.get('activeSession')).toEqual(fileActive());
    expect(mock.calls).toContain('ping');
  });

  it('a file session whose panel does not answer is stale: cleaned, and the new start goes on', async () => {
    mock.store.set('activeSession', fileActive());
    const { startFileSession } = await load();
    await startFileSession(OTHER);
    expect(lastStart()).toMatchObject({ sessionId: OTHER, failure: null });
    expect(mock.store.get('activeSession')).toEqual(fileActive(OTHER));
  });

  it('a pong for another session does not keep a session alive', async () => {
    mock.store.set('activeSession', fileActive());
    mock.sendMessage.mockImplementationOnce(() => Promise.resolve({ v: 1, type: 'FILE_SESSION_PONG', sessionId: OTHER }));
    const { startFileSession } = await load();
    await startFileSession(OTHER);
    expect(lastStart()).toMatchObject({ sessionId: OTHER, failure: null });
  });

  it('the toolbar and the microphone are refused while a file is analysed, and go on once its panel is gone', async () => {
    mock.livePanels.add(FILE_SESSION);
    mock.store.set('activeSession', fileActive());
    const { onActionClicked, startMicCapture } = await load();
    onActionClicked({ id: 7, url: WATCH } as chrome.tabs.Tab);
    await settle();
    expect(lastStart()).toMatchObject({ source: 'tab', failure: 'CAPTURE_BUSY' });
    await startMicCapture(OTHER);
    expect(lastStart()).toMatchObject({ source: 'mic', failure: 'CAPTURE_BUSY' });
    expect(mock.createDocument).not.toHaveBeenCalled();
    expect(mock.getMediaStreamId).not.toHaveBeenCalled();
    mock.livePanels.delete(FILE_SESSION); // the panel was closed mid-analysis
    await startMicCapture(OTHER);
    expect(lastStart()).toMatchObject({ source: 'mic', failure: null });
    expect(mock.store.get('activeSession')).toEqual({ sessionId: OTHER, source: 'mic' });
  });

  it('a ping with no receiver, or one that never answers, does not leave every later start refused', async () => {
    mock.store.set('activeSession', fileActive());
    mock.sendMessage.mockImplementationOnce(() => Promise.reject(new Error('Could not establish connection')));
    const { startMicCapture } = await load();
    await startMicCapture(OTHER);
    expect(lastStart()).toMatchObject({ source: 'mic', failure: null });

    vi.useFakeTimers();
    try {
      mock.store.set('activeSession', fileActive());
      mock.contexts.length = 0;
      mock.sendMessage.mockImplementationOnce(() => new Promise(() => undefined));
      const { startFileSession } = await load();
      const started = startFileSession(OTHER);
      await vi.advanceTimersByTimeAsync(999);
      expect(mock.store.get('activeSession')).toEqual(fileActive());
      await vi.advanceTimersByTimeAsync(1);
      await started;
      expect(mock.store.get('activeSession')).toEqual(fileActive(OTHER));
    } finally {
      vi.useRealTimers();
    }
  });

  it('shares the one-start-at-a-time guard with the other sources', async () => {
    const { onActionClicked, startFileSession } = await load();
    onActionClicked({ id: 7, url: WATCH } as chrome.tabs.Tab);
    await startFileSession(FILE_SESSION);
    await settle();
    expect(lastStart()).toMatchObject({ source: 'file', failure: 'CAPTURE_BUSY' });
    expect(mock.store.get('activeSession')).toMatchObject({ source: 'tab' });
  });

  it('FILE_SESSION_END clears its own file session only', async () => {
    vi.resetModules();
    const routing = await import('../src/background/routing.ts');
    const end = (sessionId: string) => ({ v: 1 as const, type: 'FILE_SESSION_END' as const, sessionId });
    mock.store.set('activeSession', fileActive());
    await routing.onFileSessionEnd(end(OTHER));
    expect(mock.store.get('activeSession')).toEqual(fileActive());
    // A capture with the same id is not a file session: untouched.
    mock.store.set('activeSession', { sessionId: FILE_SESSION, source: 'mic' });
    await routing.onFileSessionEnd(end(FILE_SESSION));
    expect(mock.store.has('activeSession')).toBe(true);
    mock.store.set('activeSession', fileActive());
    await routing.onFileSessionEnd(end(FILE_SESSION));
    expect(mock.store.has('activeSession')).toBe(false);
  });

  it('tab signals never stop a file session', async () => {
    mock.store.set('activeSession', fileActive());
    vi.resetModules();
    const routing = await import('../src/background/routing.ts');
    const { isYoutubeWatchUrl } = await import('../src/background/start-capture.ts');
    routing.onTabRemoved(7);
    routing.onTabUpdated(7, { status: 'loading' }, isYoutubeWatchUrl);
    routing.onCaptureStatus(7, 'stopped');
    await settle();
    expect(mock.sent).toEqual([]);
  });

  it('a CAPTURE_START for a file starts a file session', async () => {
    const { onCaptureStartRequest } = await load();
    const message = { v: 1 as const, type: 'CAPTURE_START' as const, sessionId: FILE_SESSION, seq: 0, source: 'file' as const, tabId: null };
    await onCaptureStartRequest(message);
    expect(mock.store.get('activeSession')).toEqual(fileActive());
  });
});

describe('ensureOffscreen', () => {
  it('creates one document for concurrent calls', async () => {
    vi.resetModules();
    const { ensureOffscreen } = await import('../src/background/offscreen.ts');
    await Promise.all([ensureOffscreen(), ensureOffscreen(), ensureOffscreen()]);
    expect(mock.createDocument).toHaveBeenCalledTimes(1);
    await ensureOffscreen();
    expect(mock.createDocument).toHaveBeenCalledTimes(1);
  });
});

describe('source rules (R7)', () => {
  it('no extension source mentions AUDIO_PLAYBACK or setPanelBehavior', () => {
    const root = resolve(import.meta.dirname, '../src');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith('.ts')) files.push(path);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      // Comments may name it to forbid it; code may not use it.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/AUDIO_PLAYBACK/);
      expect(code, file).not.toMatch(/setPanelBehavior/);
    }
  });
});

describe('isOwnExtensionContext', () => {
  it('accepts extension pages, in a tab or not, and rejects content scripts and strangers', async () => {
    vi.resetModules();
    vi.stubGlobal('chrome', {
      runtime: { id: 'ext', getURL: (path: string) => `chrome-extension://ext/${path}` },
    });
    const { isOwnExtensionContext } = await import('../src/shared/sender.ts');
    const tab = { id: 1 } as chrome.tabs.Tab;
    expect(isOwnExtensionContext({ id: 'ext', url: 'chrome-extension://ext/sidepanel.html' })).toBe(true);
    expect(isOwnExtensionContext({ id: 'ext', url: 'chrome-extension://ext/sidepanel.html', tab })).toBe(true);
    expect(isOwnExtensionContext({ id: 'ext', url: 'chrome-extension://ext/offscreen.html' })).toBe(true);
    // A content script: same extension id, but the sender URL is the web page.
    expect(isOwnExtensionContext({ id: 'ext', url: 'https://www.youtube.com/watch?v=x', tab })).toBe(false);
    expect(isOwnExtensionContext({ id: 'other', url: 'chrome-extension://other/x.html' })).toBe(false);
    expect(isOwnExtensionContext({ id: 'ext', url: 'chrome-extension://ext.evil/x.html' })).toBe(false);
    expect(isOwnExtensionContext({ id: 'ext' })).toBe(false);
  });
});
