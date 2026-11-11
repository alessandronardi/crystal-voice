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
  stored: Record<string, unknown>[];
  sent: unknown[];
  createDocument: Mock<(options: chrome.offscreen.CreateParameters) => Promise<void>>;
  getMediaStreamId: Mock<(options: { targetTabId: number }) => Promise<string>>;
  sendMessage: Mock<(message: unknown) => Promise<unknown>>;
  closeDocument: Mock<() => Promise<void>>;
}

function installChrome(): ChromeMock {
  const mock: ChromeMock = {
    calls: [],
    contexts: [],
    stored: [],
    sent: [],
    createDocument: vi.fn<(options: chrome.offscreen.CreateParameters) => Promise<void>>(),
    getMediaStreamId: vi.fn<(options: { targetTabId: number }) => Promise<string>>(),
    sendMessage: vi.fn<(message: unknown) => Promise<unknown>>(),
    closeDocument: vi.fn<() => Promise<void>>(),
  };
  mock.sendMessage.mockImplementation((message: unknown) => {
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
    storage: {
      session: {
        set: (items: Record<string, unknown>) => {
          mock.calls.push('storage.set');
          mock.stored.push(structuredClone(items));
          return Promise.resolve();
        },
      },
    },
  });
  return mock;
}

const WATCH = 'https://www.youtube.com/watch?v=abc123';

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
    expect(mock.stored.at(-1)).toMatchObject({ lastStart: { failure: 'NOT_YOUTUBE_WATCH', tabId: 7 } });
  });

  it('with an offscreen already alive records CAPTURE_BUSY and asks no stream id', async () => {
    mock.contexts.push({ contextType: 'OFFSCREEN_DOCUMENT' });
    const { onActionClicked } = await load();
    onActionClicked({ id: 7, url: WATCH } as chrome.tabs.Tab);
    await settle();
    expect(mock.getMediaStreamId).not.toHaveBeenCalled();
    expect(mock.createDocument).not.toHaveBeenCalled();
    expect(mock.stored.at(-1)).toMatchObject({ lastStart: { failure: 'CAPTURE_BUSY' } });
  });

  it('maps a getMediaStreamId rejection to STREAM_NOT_AVAILABLE and sends nothing', async () => {
    mock.getMediaStreamId.mockImplementation(() => Promise.reject(new Error('busy')));
    const { onActionClicked } = await load();
    onActionClicked({ id: 7, url: WATCH } as chrome.tabs.Tab);
    await settle();
    expect(mock.sent).toEqual([]);
    expect(mock.stored.at(-1)).toMatchObject({ lastStart: { failure: 'STREAM_NOT_AVAILABLE' } });
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
    expect(mock.stored.at(-1)).toMatchObject({ lastStart: { failure: null } });
    expect(mock.sent).toHaveLength(1);
  });

  it('closes the offscreen when the start message cannot be delivered', async () => {
    mock.sendMessage.mockImplementationOnce(() => Promise.reject(new Error('no receiver')));
    const { onActionClicked } = await load();
    onActionClicked({ id: 7, url: WATCH } as chrome.tabs.Tab);
    await settle();
    expect(mock.closeDocument).toHaveBeenCalledTimes(1);
    expect(mock.stored.at(-1)).toMatchObject({ lastStart: { failure: 'OFFSCREEN_FAILED' } });
    onActionClicked({ id: 7, url: WATCH } as chrome.tabs.Tab);
    await settle();
    expect(mock.stored.at(-1)).toMatchObject({ lastStart: { failure: null } });
  });

  it('two concurrent clicks ask one stream id; the second gets CAPTURE_BUSY (review M-1)', async () => {
    const { onActionClicked } = await load();
    onActionClicked({ id: 7, url: WATCH } as chrome.tabs.Tab);
    onActionClicked({ id: 7, url: WATCH } as chrome.tabs.Tab);
    await settle();
    expect(mock.getMediaStreamId).toHaveBeenCalledTimes(1);
    expect(mock.createDocument).toHaveBeenCalledTimes(1);
    expect(mock.sent).toHaveLength(1);
    const failures = mock.stored.map((item) => (item['lastStart'] as { failure: unknown }).failure);
    expect(failures).toContain('CAPTURE_BUSY');
  });

  it('maps a createDocument rejection to OFFSCREEN_FAILED', async () => {
    mock.createDocument.mockImplementation(() => Promise.reject(new Error('nope')));
    const { onActionClicked } = await load();
    onActionClicked({ id: 7, url: WATCH } as chrome.tabs.Tab);
    await settle();
    expect(mock.getMediaStreamId).not.toHaveBeenCalled();
    expect(mock.stored.at(-1)).toMatchObject({ lastStart: { failure: 'OFFSCREEN_FAILED' } });
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
