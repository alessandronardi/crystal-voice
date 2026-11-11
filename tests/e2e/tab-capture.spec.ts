// I-02 E2E: toolbar start, tab capture, pass-through, worklet counting, 60 s
// pause, stop. Requires `pnpm build` first.
//
// The toolbar click is simulated with the CDP command Extensions.triggerAction
// on the *tab* target (not the page target): Chromium treats it as the action
// click, so sidePanel.open() and tabCapture get their user gesture.
// See tests/e2e/README.md for what this does and does not prove.
//
// The "YouTube" page is a synthetic page served by context.route(): no
// network, no real video, a WebAudio tone (AGENTS.md R16). What a human hears
// (single audio, no distortion, latency) is in MANUAL_CHECKLIST.md.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type CDPSession,
  type Page,
  type Worker,
} from '@playwright/test';

const EXTENSION_PATH = resolve(import.meta.dirname, '../../dist/extension');
const HEADLESS = process.env['VC_E2E_HEADLESS'] === '1';
const WATCH_URL = 'https://www.youtube.com/watch?v=vc-e2e-tone';
const OTHER_URL = 'https://example.test/not-youtube';

// A 440 Hz tone that starts on a click in the page, like a real player: no
// autoplay flag, so the offscreen AudioContext gets no gesture of its own
// (review M-2). window.vcSilence() mutes it (a "paused" player is silent).
const TONE_PAGE = `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>vc e2e</title></head>
<body><button id="play">play</button><script>
let gain = null;
document.getElementById('play').addEventListener('click', () => {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  gain = ctx.createGain();
  gain.gain.value = 0.05;
  osc.connect(gain).connect(ctx.destination);
  osc.start();
});
window.vcSilence = () => { if (gain) gain.gain.value = 0; };
</script></body></html>`;

interface Diag {
  sessionId: string;
  seq: number;
  state: 'starting' | 'running' | 'stopped' | 'failed';
  samples: number;
  sampleRate: number | null;
  baseLatency: number | null;
  outputLatency: number | null;
  code: string | null;
}

interface TargetInfo {
  targetId: string;
  type: string;
  url: string;
}

let context: BrowserContext;
let userDataDir: string;
let worker: Worker;
let extensionId: string;
let browserSession: CDPSession;

/** Default getTargets omits `tab` targets, so ask for them explicitly too. */
async function targets(): Promise<TargetInfo[]> {
  const pages = (await browserSession.send('Target.getTargets')) as { targetInfos: TargetInfo[] };
  const tabs = (await browserSession.send('Target.getTargets', {
    filter: [{ type: 'tab' }],
  })) as { targetInfos: TargetInfo[] };
  return [...pages.targetInfos, ...tabs.targetInfos];
}

/** Simulates a click on the extension's toolbar icon for the tab showing `page`. */
async function clickAction(page: Page): Promise<void> {
  const url = page.url();
  const tab = (await targets()).find((t) => t.type === 'tab' && t.url === url);
  if (tab === undefined) throw new Error(`no tab target for ${url}`);
  await browserSession.send('Extensions.triggerAction', { id: extensionId, targetId: tab.targetId });
}

/** Evaluates an expression in the side panel document (not exposed as a Playwright page). */
async function inSidePanel(expression: string): Promise<unknown> {
  const panelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
  let panel: TargetInfo | undefined;
  await expect
    .poll(async () => {
      panel = (await targets()).find((t) => t.url === panelUrl);
      return panel !== undefined;
    })
    .toBe(true);
  const { sessionId } = await browserSession.send('Target.attachToTarget', {
    targetId: (panel as TargetInfo).targetId,
    // Non-flat: Playwright does not expose flat child sessions, so commands
    // go through Target.sendMessageToTarget (see relay()).
    flatten: false,
  });
  try {
    return await relay(sessionId, expression);
  } finally {
    await browserSession.send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
  }
}

async function relay(sessionId: string, expression: string): Promise<unknown> {
  const id = Math.floor(Math.random() * 1e9);
  const result = new Promise<unknown>((resolveReply, rejectReply) => {
    const onMessage = (event: { sessionId: string; message: string }): void => {
      if (event.sessionId !== sessionId) return;
      const parsed = JSON.parse(event.message) as {
        id?: number;
        result?: { result?: { value?: unknown }; exceptionDetails?: unknown };
        error?: { message: string };
      };
      if (parsed.id !== id) return;
      browserSession.off('Target.receivedMessageFromTarget', onMessage);
      if (parsed.error !== undefined) rejectReply(new Error(parsed.error.message));
      else if (parsed.result?.exceptionDetails !== undefined) rejectReply(new Error('panel exception'));
      else resolveReply(parsed.result?.result?.value);
    };
    browserSession.on('Target.receivedMessageFromTarget', onMessage);
  });
  await browserSession.send('Target.sendMessageToTarget', {
    sessionId,
    message: JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true },
    }),
  });
  return result;
}

/** Diagnostics received by the service worker (it gets every runtime broadcast). */
async function diags(): Promise<Diag[]> {
  return worker.evaluate(() => (globalThis as unknown as { vcDiags: Diag[] }).vcDiags);
}

async function lastDiag(): Promise<Diag | undefined> {
  return (await diags()).at(-1);
}

async function offscreenCount(): Promise<number> {
  return worker.evaluate(
    async () =>
      (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] }))
        .length,
  );
}

async function lastStart(): Promise<Record<string, unknown> | undefined> {
  return worker.evaluate(
    async () => (await chrome.storage.session.get('lastStart'))['lastStart'] as Record<string, unknown> | undefined,
  );
}

test.beforeAll(async () => {
  if (!existsSync(join(EXTENSION_PATH, 'manifest.json'))) {
    throw new Error('dist/extension/manifest.json not found: run `pnpm build` first.');
  }
  userDataDir = mkdtempSync(join(tmpdir(), 'voicecrystal-e2e-capture-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: HEADLESS,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });
  await context.route(WATCH_URL, (route) => route.fulfill({ contentType: 'text/html', body: TONE_PAGE }));
  await context.route(OTHER_URL, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>other</title>' }),
  );
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
  const browser = context.browser();
  if (browser === null) throw new Error('no browser handle for the persistent context');
  browserSession = await browser.newBrowserCDPSession();
  // Test-only listener in the service worker: it records the CAPTURE_DIAG
  // broadcasts (the worker itself ignores them).
  await worker.evaluate(() => {
    const g = globalThis as unknown as { vcDiags: unknown[] };
    g.vcDiags = [];
    chrome.runtime.onMessage.addListener((message: unknown) => {
      if (typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'CAPTURE_DIAG') {
        g.vcDiags.push(message);
      }
      return false;
    });
  });
});

test.afterAll(async () => {
  await context.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('a non-watch page opens the panel and starts no capture', async () => {
  const page = await context.newPage();
  await page.goto(OTHER_URL);
  await clickAction(page);
  await expect.poll(async () => (await lastStart())?.['failure']).toBe('NOT_YOUTUBE_WATCH');
  expect(await offscreenCount()).toBe(0);
  await expect
    .poll(() => inSidePanel(`document.querySelector('[data-testid="capture-error"]')?.textContent ?? ''`))
    .toContain('non è un video di YouTube');
  await page.close();
});

test('toolbar start captures, counts samples, survives a 60 s pause and stops cleanly', async () => {
  test.setTimeout(150_000);
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(WATCH_URL);
  await page.click('#play');

  await clickAction(page);
  await expect.poll(async () => (await lastDiag())?.state, { timeout: 15_000 }).toBe('running');
  const first = await lastDiag();
  if (first === undefined) throw new Error('no diagnostics');
  expect(first.code).toBeNull();
  expect(first.sampleRate).toBeGreaterThan(0);
  expect(await offscreenCount()).toBe(1);
  expect(await lastStart()).toMatchObject({ sessionId: first.sessionId, source: 'tab', failure: null });
  // The stream id never reaches storage (R1): only the four routing fields.
  expect(Object.keys((await lastStart()) ?? {}).sort()).toEqual(['failure', 'sessionId', 'source', 'tabId']);

  // The worklet receives audio at about the sample rate.
  // Counts arrive every 0.5 s, so a 4 s window is accurate to about ±25%.
  await page.waitForTimeout(4_000);
  const later = await lastDiag();
  if (later === undefined || first.sampleRate === null) throw new Error('no diagnostics');
  const rate = (later.samples - first.samples) / 4;
  expect(rate).toBeGreaterThan(first.sampleRate * 0.6);
  expect(rate).toBeLessThan(first.sampleRate * 1.4);
  // Recorded for tests/e2e/README.md. Browser estimates, not a loopback measure.
  test.info().annotations.push({
    type: 'capture',
    description: JSON.stringify({
      sampleRate: later.sampleRate,
      samplesPerSecond: rate,
      baseLatency: later.baseLatency,
      outputLatency: later.outputLatency,
    }),
  });
  console.log(`capture: ${test.info().annotations.at(-1)?.description ?? ''}`);

  // The side panel shows the live session.
  await expect.poll(() => inSidePanel(`document.querySelector('[data-testid="capture-status"]')?.textContent`)).toBe(
    'In ascolto',
  );

  // A second click while capturing: one session only, the second is refused.
  await clickAction(page);
  await expect.poll(async () => (await lastStart())?.['failure']).toBe('CAPTURE_BUSY');
  expect(await offscreenCount()).toBe(1);

  // 60 s of silence (a paused player): the offscreen stays alive (ADR-0003, VC-03).
  await page.evaluate(() => {
    (window as unknown as { vcSilence: () => void }).vcSilence();
  });
  const beforePause = await lastDiag();
  await page.waitForTimeout(60_000);
  expect(await offscreenCount()).toBe(1);
  const afterPause = await lastDiag();
  expect(afterPause?.state).toBe('running');
  expect(afterPause?.sessionId).toBe(first.sessionId);
  expect((afterPause?.samples ?? 0) - (beforePause?.samples ?? 0)).toBeGreaterThan(first.sampleRate * 50);

  // Stop from the side panel button.
  await inSidePanel(`document.querySelector('[data-testid="capture-stop"]').click()`);
  await expect.poll(async () => (await lastDiag())?.state, { timeout: 10_000 }).toBe('stopped');
  await expect.poll(offscreenCount, { timeout: 10_000 }).toBe(0);
  await expect.poll(() => inSidePanel(`document.querySelector('[data-testid="capture-status"]')?.textContent`)).toBe(
    'Cattura interrotta',
  );

  // Every diagnostic of the session has a strictly increasing seq.
  const session = (await diags()).filter((d) => d.sessionId === first.sessionId);
  for (let i = 1; i < session.length; i++) {
    expect(session[i]?.seq).toBeGreaterThan(session[i - 1]?.seq ?? -1);
  }

  // After the stop a new start works again.
  await clickAction(page);
  await expect
    .poll(async () => {
      const d = await lastDiag();
      return d !== undefined && d.sessionId !== first.sessionId && d.state === 'running';
    }, { timeout: 15_000 })
    .toBe(true);
  const second = await lastDiag();
  await inSidePanel(`document.querySelector('[data-testid="capture-stop"]').click()`);
  await expect.poll(async () => (await lastDiag())?.state, { timeout: 10_000 }).toBe('stopped');
  expect((await lastDiag())?.sessionId).toBe(second?.sessionId);
  await expect.poll(offscreenCount, { timeout: 10_000 }).toBe(0);

  expect(pageErrors).toEqual([]);
  await page.close();
});

test('the panel flags a capture whose offscreen disappeared (review M-3)', async () => {
  const page = await context.newPage();
  await page.goto(WATCH_URL);
  await page.click('#play');
  await clickAction(page);
  await expect.poll(async () => (await lastDiag())?.state, { timeout: 15_000 }).toBe('running');
  // Simulates an unexpected close: the document goes away without a final diagnostic.
  await worker.evaluate(() => chrome.offscreen.closeDocument());
  await expect.poll(offscreenCount).toBe(0);
  await expect
    .poll(() => inSidePanel(`document.querySelector('[data-testid="capture-stale"]') !== null`), {
      timeout: 10_000,
    })
    .toBe(true);
  // A new start works again.
  await clickAction(page);
  await expect.poll(async () => (await lastDiag())?.state, { timeout: 15_000 }).toBe('running');
  await inSidePanel(`document.querySelector('[data-testid="capture-stop"]').click()`);
  await expect.poll(offscreenCount, { timeout: 10_000 }).toBe(0);
  await page.close();
});
