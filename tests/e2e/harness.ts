// Shared E2E harness for the capture tests (I-02, I-03). Requires `pnpm build`.
//
// - The toolbar click is the CDP command Extensions.triggerAction on the *tab*
//   target: Chromium treats it as the action click, with its user gesture.
// - "YouTube" pages are synthetic pages served by context.route(): no network,
//   a <video> playing a WAV generated in the page (AGENTS.md R16).
// - Diagnostics are recorded by a probe extension page opened in a tab: it
//   receives every runtime broadcast and survives a service-worker restart.
// See tests/e2e/README.md for what this proves and what it does not.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, type BrowserContext, type CDPSession, type Page, type Worker } from '@playwright/test';

export const EXTENSION_PATH = resolve(import.meta.dirname, '../../dist/extension');
export const HEADLESS = process.env['VC_E2E_HEADLESS'] === '1';

export const ORIGIN = 'https://www.youtube.com';
export const WATCH_URL = `${ORIGIN}/watch?v=vc-e2e-tone`;
export const HOME_URL = `${ORIGIN}/`;
export const OTHER_URL = 'https://example.test/not-youtube';

export interface Diag {
  sessionId: string;
  seq: number;
  state: string;
  exitReason: string | null;
  code: string | null;
  samples: number;
  sampleRate: number | null;
  elapsedMs: number;
  activeMs: number;
  baseLatency: number | null;
  outputLatency: number | null;
  /** Arrival time at the probe page, Date.now(). */
  at: number;
}

interface TargetInfo {
  targetId: string;
  type: string;
  url: string;
}

/** Builds a WAV tone in the page and exposes window.vc to drive a <video> like a user. */
const PLAYER_SCRIPT = `
function wav(seconds, freq) {
  const rate = 8000, n = seconds * rate, buf = new ArrayBuffer(44 + n * 2), d = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) d.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, rate, true); d.setUint32(28, rate * 2, true); d.setUint16(32, 2, true);
  d.setUint16(34, 16, true); str(36, 'data'); d.setUint32(40, n * 2, true);
  let phase = 0;
  for (let i = 0; i < n; i++) { phase += freq / rate; d.setInt16(44 + i * 2, Math.round(1500 * Math.sin(2 * Math.PI * phase)), true); }
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
function video() {
  let v = document.getElementById('v');
  if (!v) { v = document.createElement('video'); v.id = 'v'; document.body.append(v); v.src = wav(200, 440); }
  return v;
}
window.vc = {
  pause: () => video().pause(),
  play: () => video().play(),
  rate: (r) => { video().playbackRate = r; },
  seek: (t) => { video().currentTime = t; },
  swap: () => { const v = video(); v.src = wav(200, 660); return v.play(); },
  state: () => { const v = document.getElementById('v'); return v ? { paused: v.paused, t: v.currentTime, rate: v.playbackRate } : { paused: true, t: 0, rate: 1 }; },
};
`;

/** A watch page: a standard <video> with a synthetic 200 s tone, started by #play. */
export const VIDEO_PAGE = `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>vc e2e</title></head>
<body><button id="play">play</button><script>${PLAYER_SCRIPT}
video();
document.getElementById('play').addEventListener('click', () => { void window.vc.play(); });
</script></body></html>`;

/**
 * A YouTube "home" page: #go turns it into a watch page with pushState and
 * starts a video, as YouTube's SPA navigation does (ADR-0021).
 */
export const HOME_PAGE = `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>vc e2e home</title></head>
<body><button id="go">go</button><script>${PLAYER_SCRIPT}
document.getElementById('go').addEventListener('click', () => {
  history.pushState({}, '', '/watch?v=vc-e2e-spa');
  void window.vc.play();
});
window.vcPushWatch = (id) => { history.pushState({}, '', '/watch?v=' + id); };
</script></body></html>`;

export class ExtensionHarness {
  context!: BrowserContext;
  extensionId = '';
  private userDataDir = '';
  private browserSession!: CDPSession;
  /** Extension page that records CAPTURE_DIAG and answers storage/context queries. */
  probe!: Page;

  /** `args`: extra Chromium flags, e.g. the fake media device of the microphone tests (I-17). */
  async launch(options: { args?: readonly string[] } = {}): Promise<void> {
    if (!existsSync(join(EXTENSION_PATH, 'manifest.json'))) {
      throw new Error('dist/extension/manifest.json not found: run `pnpm build` first.');
    }
    this.userDataDir = mkdtempSync(join(tmpdir(), 'voicecrystal-e2e-'));
    this.context = await chromium.launchPersistentContext(this.userDataDir, {
      channel: 'chromium',
      headless: HEADLESS,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        ...(options.args ?? []),
      ],
    });
    await this.context.route(`${ORIGIN}/watch*`, (route) =>
      route.fulfill({ contentType: 'text/html', body: VIDEO_PAGE }),
    );
    await this.context.route(HOME_URL, (route) => route.fulfill({ contentType: 'text/html', body: HOME_PAGE }));
    await this.context.route(OTHER_URL, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>other</title>' }),
    );
    const worker = await this.worker();
    this.extensionId = new URL(worker.url()).host;
    const browser = this.context.browser();
    if (browser === null) throw new Error('no browser handle for the persistent context');
    this.browserSession = await browser.newBrowserCDPSession();
    this.probe = await this.context.newPage();
    await this.probe.goto(`chrome-extension://${this.extensionId}/collection.html`);
    await this.probe.evaluate(() => {
      // Records every runtime message type, and diagnostics with their arrival time.
      const g = globalThis as unknown as { vcDiags: unknown[]; vcTypes: string[] };
      g.vcDiags = [];
      g.vcTypes = [];
      chrome.runtime.onMessage.addListener((message: unknown) => {
        const type = typeof message === 'object' && message !== null ? (message as { type?: unknown }).type : undefined;
        if (typeof type === 'string') g.vcTypes.push(type);
        if (type === 'CAPTURE_DIAG') g.vcDiags.push({ ...(message as object), at: Date.now() });
        return false;
      });
    });
  }

  async close(): Promise<void> {
    await this.context.close();
    rmSync(this.userDataDir, { recursive: true, force: true });
  }

  async worker(): Promise<Worker> {
    return this.context.serviceWorkers()[0] ?? (await this.context.waitForEvent('serviceworker'));
  }

  /** Default getTargets omits `tab` targets, so ask for them explicitly too. */
  async targets(): Promise<TargetInfo[]> {
    const pages = (await this.browserSession.send('Target.getTargets')) as { targetInfos: TargetInfo[] };
    const tabs = (await this.browserSession.send('Target.getTargets', {
      filter: [{ type: 'tab' }],
    })) as { targetInfos: TargetInfo[] };
    return [...pages.targetInfos, ...tabs.targetInfos];
  }

  /** Simulates a click on the extension's toolbar icon for the tab showing `page`. */
  async clickAction(page: Page): Promise<void> {
    const url = page.url();
    const tab = (await this.targets()).find((t) => t.type === 'tab' && t.url === url);
    if (tab === undefined) throw new Error(`no tab target for ${url}`);
    await this.browserSession.send('Extensions.triggerAction', { id: this.extensionId, targetId: tab.targetId });
  }

  /** Opens a synthetic watch page and starts its video with a click (a user gesture in the page). */
  async openWatch(url = WATCH_URL): Promise<Page> {
    const page = await this.context.newPage();
    await page.goto(url);
    await page.click('#play');
    await expect.poll(() => page.evaluate(() => (window as unknown as { vc: { state(): { paused: boolean } } }).vc.state().paused)).toBe(false);
    return page;
  }

  async diags(): Promise<Diag[]> {
    return this.probe.evaluate(() => (globalThis as unknown as { vcDiags: Diag[] }).vcDiags);
  }

  /** Types of all runtime messages the probe page saw (HEARTBEAT included). */
  async messageTypes(): Promise<string[]> {
    return this.probe.evaluate(() => [...(globalThis as unknown as { vcTypes: string[] }).vcTypes]);
  }

  async lastDiag(): Promise<Diag | undefined> {
    return (await this.diags()).at(-1);
  }

  /** Every session id seen so far: pass it to waitForSession to wait for a new one. */
  async seenSessions(): Promise<string[]> {
    return [...new Set((await this.diags()).map((d) => d.sessionId))];
  }

  /** Waits for a session other than `except` to reach `state`; returns its last diagnostic. */
  async waitForSession(state: string, except: readonly string[] = [], timeout = 15_000): Promise<Diag> {
    let found: Diag | undefined;
    await expect
      .poll(
        async () => {
          found = (await this.diags()).filter((d) => !except.includes(d.sessionId) && d.state === state).at(-1);
          return found !== undefined;
        },
        { timeout },
      )
      .toBe(true);
    return found as Diag;
  }

  /** Waits for the final diagnostic of a session; returns it. */
  async waitForEnd(sessionId: string, timeout = 15_000): Promise<Diag> {
    const terminal = ['RESULT_READY', 'INSUFFICIENT_DATA', 'INTERRUPTED', 'ERROR'];
    let found: Diag | undefined;
    await expect
      .poll(
        async () => {
          found = (await this.diags()).find((d) => d.sessionId === sessionId && terminal.includes(d.state));
          return found !== undefined;
        },
        { timeout },
      )
      .toBe(true);
    return found as Diag;
  }

  async offscreenCount(): Promise<number> {
    return this.probe.evaluate(
      async () =>
        (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] })).length,
    );
  }

  async storage(key: string): Promise<Record<string, unknown> | undefined> {
    return this.probe.evaluate(
      async (k) => (await chrome.storage.session.get(k))[k] as Record<string, unknown> | undefined,
      key,
    );
  }

  /**
   * Evaluates an expression in the side panel documents (not exposed as
   * Playwright pages). Each tab opened with sidePanel.open({ tabId }) has its
   * own panel document, so the expression runs in every one and the first
   * meaningful result (not null, undefined, false or '') is returned.
   */
  async inSidePanel(expression: string): Promise<unknown> {
    const panelUrl = `chrome-extension://${this.extensionId}/sidepanel.html`;
    let panels: TargetInfo[] = [];
    await expect
      .poll(async () => {
        // Each panel is listed twice, as a `page` and as a `tab` target: only the page evaluates.
        panels = (await this.targets()).filter((t) => t.type === 'page' && t.url === panelUrl);
        return panels.length > 0;
      })
      .toBe(true);
    let last: unknown;
    for (const panel of panels) {
      const { sessionId } = await this.browserSession.send('Target.attachToTarget', {
        targetId: panel.targetId,
        // Non-flat: Playwright does not expose flat child sessions, so commands
        // go through Target.sendMessageToTarget (see relay()).
        flatten: false,
      });
      try {
        last = await this.relay(sessionId, expression);
      } finally {
        await this.browserSession.send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
      }
      if (last !== null && last !== undefined && last !== false && last !== '') return last;
    }
    return last;
  }

  /** The side panel documents (each listed twice, as `page` and `tab`: only the page counts). */
  async sidePanels(): Promise<TargetInfo[]> {
    const panelUrl = `chrome-extension://${this.extensionId}/sidepanel.html`;
    return (await this.targets()).filter((t) => t.type === 'page' && t.url === panelUrl);
  }

  /**
   * Runs CDP commands in the one open side panel (the file tests keep a single
   * panel). `run` gets a sender for that panel's session.
   */
  async withSidePanel<T>(run: (send: (method: string, params: Record<string, unknown>) => Promise<unknown>) => Promise<T>): Promise<T> {
    const panels = await this.sidePanels();
    if (panels.length !== 1) throw new Error(`expected one side panel, found ${String(panels.length)}`);
    const panel = panels[0] as TargetInfo;
    const { sessionId } = await this.browserSession.send('Target.attachToTarget', { targetId: panel.targetId, flatten: false });
    try {
      return await run((method, params) => this.relayCommand(sessionId, method, params));
    } finally {
      await this.browserSession.send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
    }
  }

  /**
   * Puts a file into the panel's <input type="file"> as a user's choice would
   * (CDP DOM.setFileInputFiles on the element, which fires `input` and
   * `change`). The side panel is not a Playwright Page, so setInputFiles is
   * not available (I-18).
   */
  async setPanelFile(testId: string, path: string): Promise<void> {
    await this.withSidePanel(async (send) => {
      const found = (await send('Runtime.evaluate', {
        expression: `document.querySelector('[data-testid="${testId}"]')`,
        returnByValue: false,
      })) as { result?: { objectId?: string } };
      const objectId = found.result?.objectId;
      if (objectId === undefined) throw new Error(`no element ${testId} in the side panel`);
      await send('DOM.setFileInputFiles', { files: [path], objectId });
    });
  }

  /**
   * Real mouse clicks (CDP Input.dispatchMouseEvent) at the centre of an
   * element of the one open side panel, `gapMs` apart: unlike element.click()
   * the second click lands on whatever is at that spot by then, as a person's
   * double click does.
   */
  async mouseClicksInSidePanel(testId: string, count: number, gapMs: number): Promise<void> {
    await this.withSidePanel(async (send) => {
      const found = (await send('Runtime.evaluate', {
        expression: `(() => { const el = document.querySelector('[data-testid="${testId}"]'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: innerWidth, h: innerHeight }; })()`,
        returnByValue: true,
      })) as { result?: { value?: { x: number; y: number } } };
      const at = found.result?.value;
      if (at === undefined) throw new Error(`no element ${testId} in the side panel`);
      for (let i = 0; i < count; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, gapMs));
        for (const type of ['mousePressed', 'mouseReleased']) {
          await send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: i + 1 });
        }
      }
    });
  }

  /**
   * Grants the microphone to the extension's origin, as a «Consenti» on the
   * prompt of permission.html would (CDP Browser.grantPermissions). The
   * offscreen then has to use that grant on its own: that is what I-17 checks.
   */
  async grantMic(): Promise<void> {
    await this.browserSession.send('Browser.grantPermissions', {
      origin: `chrome-extension://${this.extensionId}`,
      permissions: ['audioCapture'],
    });
  }

  /** Sets the extension origin's microphone permission (CDP Browser.setPermission), e.g. 'denied' for «Blocca». */
  async setMic(setting: 'granted' | 'denied' | 'prompt'): Promise<void> {
    await this.browserSession.send('Browser.setPermission', {
      origin: `chrome-extension://${this.extensionId}`,
      // A PermissionDescriptor takes the Permissions API name, not grantPermissions' 'audioCapture'.
      permission: { name: 'microphone' },
      setting,
    });
  }

  /** Removes every grant made with grantMic (CDP Browser.resetPermissions). */
  async resetPermissions(): Promise<void> {
    await this.browserSession.send('Browser.resetPermissions', {});
  }

  /** Closes every side panel document (CDP Target.closeTarget); returns how many. */
  async closeSidePanels(): Promise<number> {
    const panelUrl = `chrome-extension://${this.extensionId}/sidepanel.html`;
    const panels = (await this.targets()).filter((t) => t.type === 'page' && t.url === panelUrl);
    for (const panel of panels) await this.browserSession.send('Target.closeTarget', { targetId: panel.targetId });
    return panels.length;
  }

  /** A browser-level CDP command (e.g. SystemInfo.getProcessInfo). */
  async browserCdp(method: string, params: Record<string, unknown>): Promise<unknown> {
    return this.browserSession.send(method as 'SystemInfo.getProcessInfo', params);
  }

  /**
   * S8: terminates the extension's service worker, as «Stop» in
   * chrome://serviceworker-internals does, with ServiceWorker.stopAllWorkers
   * from a page of the same origin. A marker in the worker's global scope
   * proves that the next worker is a new instance.
   */
  async restartServiceWorker(): Promise<void> {
    const before = await this.worker();
    await before.evaluate(() => {
      (globalThis as unknown as { vcMarker?: string }).vcMarker = 'old';
    });
    const session = await this.context.newCDPSession(this.probe);
    try {
      await session.send('ServiceWorker.enable');
      await session.send('ServiceWorker.stopAllWorkers');
    } finally {
      await session.detach().catch(() => undefined);
    }
    // Any event wakes a new instance; the probe asks for one.
    await expect
      .poll(
        async () => {
          await this.probe.evaluate(() => chrome.runtime.sendMessage({ v: 1, type: 'PING', nonce: 'wake' }).catch(() => undefined));
          const worker = await this.worker();
          return worker.evaluate(() => (globalThis as unknown as { vcMarker?: string }).vcMarker ?? 'new').catch(() => 'gone');
        },
        { timeout: 10_000 },
      )
      .toBe('new');
  }

  /** Used JS heap of every target whose URL ends with `suffix` (CDP Runtime.getHeapUsage), bytes. */
  async heapUsed(suffix: string): Promise<number> {
    let total = 0;
    for (const target of (await this.targets()).filter((t) => t.type !== 'tab' && t.url.endsWith(suffix))) {
      const { sessionId } = await this.browserSession.send('Target.attachToTarget', {
        targetId: target.targetId,
        flatten: false,
      });
      try {
        const usage = (await this.relayCommand(sessionId, 'Runtime.getHeapUsage', {})) as { usedSize?: number };
        total += usage.usedSize ?? 0;
      } finally {
        await this.browserSession.send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
      }
    }
    return total;
  }

  /**
   * Forces a garbage collection (CDP HeapProfiler.collectGarbage) in every
   * extension context (service worker, panels, probe, offscreen if open) and
   * returns their used JS heap afterwards, bytes. Memory readings then show
   * what is still referenced, not what the collector has not reached yet.
   */
  async collectExtensionGarbage(): Promise<number> {
    const origin = `chrome-extension://${this.extensionId}/`;
    let total = 0;
    for (const target of (await this.targets()).filter((t) => t.type !== 'tab' && t.url.startsWith(origin))) {
      const { sessionId } = await this.browserSession.send('Target.attachToTarget', {
        targetId: target.targetId,
        flatten: false,
      });
      try {
        await this.relayCommand(sessionId, 'HeapProfiler.collectGarbage', {});
        const usage = (await this.relayCommand(sessionId, 'Runtime.getHeapUsage', {})) as { usedSize?: number };
        total += usage.usedSize ?? 0;
      } catch {
        // Target gone between listing and attaching (e.g. a closing offscreen).
      } finally {
        await this.browserSession.send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
      }
    }
    return total;
  }

  private async relay(sessionId: string, expression: string): Promise<unknown> {
    const result = (await this.relayCommand(sessionId, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as { result?: { value?: unknown }; exceptionDetails?: unknown };
    if (result.exceptionDetails !== undefined) throw new Error('panel exception');
    return result.result?.value;
  }

  private async relayCommand(sessionId: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = Math.floor(Math.random() * 1e9);
    const result = new Promise<unknown>((resolveReply, rejectReply) => {
      const onMessage = (event: { sessionId: string; message: string }): void => {
        if (event.sessionId !== sessionId) return;
        const parsed = JSON.parse(event.message) as { id?: number; result?: unknown; error?: { message: string } };
        if (parsed.id !== id) return;
        this.browserSession.off('Target.receivedMessageFromTarget', onMessage);
        if (parsed.error !== undefined) rejectReply(new Error(parsed.error.message));
        else resolveReply(parsed.result);
      };
      this.browserSession.on('Target.receivedMessageFromTarget', onMessage);
    });
    await this.browserSession.send('Target.sendMessageToTarget', {
      sessionId,
      message: JSON.stringify({ id, method, params }),
    });
    return result;
  }

}

/** Calls window.vc.<method>(...args) in a synthetic watch page. */
export async function vc(page: Page, method: 'pause' | 'play' | 'rate' | 'seek' | 'swap', arg?: number): Promise<void> {
  await page.evaluate(
    ([m, a]) => {
      const api = (window as unknown as { vc: Record<string, (x?: number) => unknown> }).vc;
      return Promise.resolve(api[m]?.(a)).then(() => undefined);
    },
    [method, arg] as const,
  );
}
