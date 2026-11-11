// I-02 E2E, updated for the I-03 capture machine: toolbar start, tab capture,
// pass-through, worklet counting, stop, refused second start, stale capture.
// Lifecycle scenarios (pause, navigation, rate, seek, SW restart) are in
// lifecycle.spec.ts. Requires `pnpm build` first.
import { expect, test } from '@playwright/test';
import { ExtensionHarness, OTHER_URL } from './harness.ts';

const h = new ExtensionHarness();

test.beforeAll(async () => {
  await h.launch();
});

test.afterAll(async () => {
  await h.close();
});

/** Clicks the element in whichever panel shows it; true when clicked. */
const click = (testId: string): string =>
  `(() => { const el = document.querySelector('[data-testid="${testId}"]'); if (el === null) return false; el.click(); return true; })()`;
const text = (testId: string): string => `document.querySelector('[data-testid="${testId}"]')?.textContent ?? ''`;

test('a non-watch page opens the panel and starts no capture', async () => {
  const page = await h.context.newPage();
  await page.goto(OTHER_URL);
  await h.clickAction(page);
  await expect.poll(async () => (await h.storage('lastStart'))?.['failure']).toBe('NOT_YOUTUBE_WATCH');
  expect(await h.offscreenCount()).toBe(0);
  expect(await h.storage('activeSession')).toBeUndefined();
  await expect.poll(() => h.inSidePanel(text('capture-error'))).toContain('non è un video di YouTube');
  await page.close();
});

test('toolbar start captures and counts samples; a second click is refused; stop releases everything', async () => {
  const page = await h.openWatch();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const seen = await h.seenSessions();
  await h.clickAction(page);
  const first = await h.waitForSession('LISTENING', seen);
  expect(first.sampleRate).toBeGreaterThan(0);
  expect(await h.offscreenCount()).toBe(1);
  const active = await h.storage('activeSession');
  expect(active).toMatchObject({ sessionId: first.sessionId, source: 'tab' });
  // Routing state only: never the stream id (R1).
  expect(Object.keys(active ?? {}).sort()).toEqual(['sessionId', 'source', 'tabId']);
  expect(Object.keys((await h.storage('lastStart')) ?? {}).sort()).toEqual([
    'failure',
    'sessionId',
    'source',
    'tabId',
  ]);

  // The worklet receives audio at about the sample rate (reports every 0.5 s).
  const before = (await h.lastDiag()) ?? first;
  await page.waitForTimeout(4_000);
  const later = await h.lastDiag();
  if (later === undefined || first.sampleRate === null) throw new Error('no diagnostics');
  const rate = (later.samples - before.samples) / ((later.at - before.at) / 1000);
  expect(rate).toBeGreaterThan(first.sampleRate * 0.6);
  expect(rate).toBeLessThan(first.sampleRate * 1.4);
  expect(later.state).toBe('LISTENING');
  expect(later.activeMs).toBeGreaterThan(3_000);
  test.info().annotations.push({
    type: 'capture',
    description: JSON.stringify({
      sampleRate: later.sampleRate,
      samplesPerSecond: Math.round(rate),
      baseLatency: later.baseLatency,
      outputLatency: later.outputLatency,
    }),
  });

  await expect
    .poll(() => h.inSidePanel(`document.querySelector('[data-testid="capture-status"]')?.dataset.state`))
    .toBe('LISTENING');

  // A second click while capturing: one session only, the second is refused.
  await h.clickAction(page);
  await expect.poll(async () => (await h.storage('lastStart'))?.['failure']).toBe('CAPTURE_BUSY');
  expect(await h.offscreenCount()).toBe(1);
  expect((await h.storage('activeSession'))?.['sessionId']).toBe(first.sessionId);

  // The refused start offers to stop the running session (SPEC §5).
  await expect
    .poll(() => h.inSidePanel(`document.querySelector('[data-testid="capture-stop-active"]') !== null`))
    .toBe(true);
  // Regression: the running session's diagnostics (every 0.5 s) must not hide the offer.
  await page.waitForTimeout(2_000);
  expect(await h.inSidePanel(`document.querySelector('[data-testid="capture-stop-active"]') !== null`)).toBe(true);
  expect(await h.inSidePanel(text('capture-error'))).not.toBe('');
  await h.inSidePanel(click('capture-stop-active'));
  const end = await h.waitForEnd(first.sessionId);
  expect(end).toMatchObject({ state: 'INTERRUPTED', exitReason: 'USER_STOP' });
  await expect.poll(() => h.offscreenCount(), { timeout: 10_000 }).toBe(0);
  await expect.poll(() => h.storage('activeSession')).toBeUndefined();
  await expect.poll(() => h.inSidePanel(text('capture-exit'))).toBe('Interrotta da te.');

  // Diagnostics of the session have strictly increasing seq.
  const session = (await h.diags()).filter((d) => d.sessionId === first.sessionId);
  for (let i = 1; i < session.length; i++) {
    expect(session[i]?.seq).toBeGreaterThan(session[i - 1]?.seq ?? -1);
  }

  // A new start works again.
  await h.clickAction(page);
  const second = await h.waitForSession('LISTENING', [...seen, first.sessionId]);
  await h.inSidePanel(click('capture-stop'));
  await h.waitForEnd(second.sessionId);
  await expect.poll(() => h.offscreenCount(), { timeout: 10_000 }).toBe(0);

  expect(errors).toEqual([]);
  await page.close();
});

test('the panel flags a capture whose offscreen disappeared, and a new start recovers', async () => {
  const page = await h.openWatch();
  const seen = await h.seenSessions();
  await h.clickAction(page);
  const closed = await h.waitForSession('LISTENING', seen);
  // Simulates an unexpected close: the document goes away without a final diagnostic.
  const worker = await h.worker();
  await worker.evaluate(() => chrome.offscreen.closeDocument());
  await expect.poll(() => h.offscreenCount()).toBe(0);
  await expect
    .poll(() => h.inSidePanel(`document.querySelector('[data-testid="capture-stale"]') !== null`), {
      timeout: 10_000,
    })
    .toBe(true);
  // The stale routing state does not block a new start.
  await h.clickAction(page);
  const next = await h.waitForSession('LISTENING', [...seen, closed.sessionId]);
  await expect
    .poll(() => h.inSidePanel(`document.querySelector('[data-testid="capture-stale"]') === null`))
    .toBe(true);
  await h.inSidePanel(click('capture-stop'));
  await h.waitForEnd(next.sessionId);
  await expect.poll(() => h.offscreenCount(), { timeout: 10_000 }).toBe(0);
  await page.close();
});
