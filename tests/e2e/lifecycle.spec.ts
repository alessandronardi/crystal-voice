// I-03 E2E: watchdog, capture machine and lifecycle in Chromium (Playwright).
// Scenarios S2, S3, S6 (source change; real ads stay manual), S7, S8 and the
// other exits of SPEC §6.1. Synthetic pages only (see harness.ts).
// Requires `pnpm build` first.
import { expect, test, type Page } from '@playwright/test';
import { ExtensionHarness, HOME_URL, OTHER_URL, vc, type Diag } from './harness.ts';

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

/** Opens a watch page, starts a capture and waits for LISTENING. */
async function startCapture(page?: Page): Promise<{ page: Page; session: Diag }> {
  const p = page ?? (await h.openWatch());
  const seen = await h.seenSessions();
  await h.clickAction(p);
  const session = await h.waitForSession('LISTENING', seen);
  return { page: p, session };
}

async function expectReleased(): Promise<void> {
  await expect.poll(() => h.offscreenCount(), { timeout: 10_000 }).toBe(0);
  await expect.poll(() => h.storage('activeSession')).toBeUndefined();
}

test('without a session the content script sends nothing (ADR-0021)', async () => {
  const page = await h.openWatch();
  const home = await h.context.newPage();
  await home.goto(HOME_URL);
  await page.waitForTimeout(3_000);
  const types = await h.messageTypes();
  expect(types.filter((t) => t === 'HEARTBEAT' || t === 'PLAYER_EVENT')).toEqual([]);
  await home.close();
  await page.close();
});

test('S2: a 60 s pause keeps the session PAUSED with the offscreen alive; resume listens again', async () => {
  test.setTimeout(150_000);
  const { page, session } = await startCapture();
  await vc(page, 'pause');
  await expect.poll(async () => (await h.lastDiag())?.state, { timeout: 5_000 }).toBe('PAUSED');
  const paused = await h.lastDiag();
  await page.waitForTimeout(60_000);
  expect(await h.offscreenCount()).toBe(1);
  const after = await h.lastDiag();
  expect(after?.sessionId).toBe(session.sessionId);
  expect(after?.state).toBe('PAUSED');
  // Active time is frozen while paused (sample clock, SPEC §6).
  expect(after?.activeMs ?? 0).toBeLessThan((paused?.activeMs ?? 0) + 1_000);
  expect(after?.elapsedMs ?? 0).toBeGreaterThan(60_000);
  await vc(page, 'play');
  await expect.poll(async () => (await h.lastDiag())?.state, { timeout: 5_000 }).toBe('LISTENING');
  await h.inSidePanel(click('capture-stop'));
  expect(await h.waitForEnd(session.sessionId)).toMatchObject({ state: 'INTERRUPTED', exitReason: 'USER_STOP' });
  await expectReleased();
  await page.close();
});

test('S3: navigating to another site stops the capture within 3 s with NAVIGATED_AWAY', async () => {
  const { page, session } = await startCapture();
  const t0 = Date.now();
  await page.goto(OTHER_URL);
  const end = await h.waitForEnd(session.sessionId);
  expect(end).toMatchObject({ state: 'INTERRUPTED', exitReason: 'NAVIGATED_AWAY' });
  const stopMs = end.at - t0;
  test.info().annotations.push({ type: 'S3 stop ms', description: String(stopMs) });
  console.log(`S3 stop ms: ${stopMs}`);
  expect(stopMs).toBeLessThanOrEqual(3_000);
  await expectReleased();
  await page.close();
});

test('S7: playback rate 1.5× interrupts with PLAYBACK_RATE_CHANGED', async () => {
  const { page, session } = await startCapture();
  await vc(page, 'rate', 1.5);
  expect(await h.waitForEnd(session.sessionId)).toMatchObject({
    state: 'INTERRUPTED',
    exitReason: 'PLAYBACK_RATE_CHANGED',
  });
  await expectReleased();
  await expect
    .poll(() => h.inSidePanel(`document.querySelector('[data-testid="capture-exit"]')?.textContent ?? ''`))
    .toContain('1×');
  await page.close();
});

test('seek interrupts with VIDEO_SEEK', async () => {
  const { page, session } = await startCapture();
  await vc(page, 'seek', 100);
  expect(await h.waitForEnd(session.sessionId)).toMatchObject({ state: 'INTERRUPTED', exitReason: 'VIDEO_SEEK' });
  await expectReleased();
  await page.close();
});

test('S6 (synthetic): a source change interrupts with AD_OR_SOURCE_CHANGE', async () => {
  const { page, session } = await startCapture();
  await vc(page, 'swap');
  expect(await h.waitForEnd(session.sessionId)).toMatchObject({
    state: 'INTERRUPTED',
    exitReason: 'AD_OR_SOURCE_CHANGE',
  });
  await expectReleased();
  await page.close();
});

test('another video in the same page (SPA) interrupts with VIDEO_CHANGED', async () => {
  const { page, session } = await startCapture();
  await page.evaluate(() => {
    history.pushState({}, '', '/watch?v=vc-e2e-other');
  });
  expect(await h.waitForEnd(session.sessionId)).toMatchObject({ state: 'INTERRUPTED', exitReason: 'VIDEO_CHANGED' });
  await expectReleased();
  await page.close();
});

test('SPA navigation into /watch: the capture starts and stays alive (ADR-0021)', async () => {
  const page = await h.context.newPage();
  await page.goto(HOME_URL);
  await page.click('#go');
  await expect.poll(() => page.url()).toContain('/watch?v=vc-e2e-spa');
  const { session } = await startCapture(page);
  await page.waitForTimeout(5_000);
  const last = await h.lastDiag();
  expect(last?.sessionId).toBe(session.sessionId);
  expect(last?.state).toBe('LISTENING');
  await h.inSidePanel(click('capture-stop'));
  await h.waitForEnd(session.sessionId);
  await expectReleased();
  await page.close();
});

test('closing the captured tab ends the session and releases everything', async () => {
  const { page, session } = await startCapture();
  await page.close();
  const end = await h.waitForEnd(session.sessionId);
  // The track usually ends before tabs.onRemoved arrives: either cause ends the session.
  expect([
    ['ERROR', 'STREAM_ENDED'],
    ['INTERRUPTED', 'NAVIGATED_AWAY'],
  ]).toContainEqual([end.state, end.exitReason]);
  test.info().annotations.push({ type: 'tab close exit', description: `${end.state} / ${end.exitReason ?? ''}` });
  console.log(`tab close exit: ${end.state} / ${end.exitReason ?? ''}`);
  await expectReleased();
});

test('two tabs: the second start gets CAPTURE_BUSY and can stop the first, then start', async () => {
  const { page: first, session } = await startCapture();
  const second = await h.openWatch();
  const seen = await h.seenSessions();
  await h.clickAction(second);
  await expect.poll(async () => (await h.storage('lastStart'))?.['failure']).toBe('CAPTURE_BUSY');
  expect(await h.offscreenCount()).toBe(1);
  await expect
    .poll(() => h.inSidePanel(`document.querySelector('[data-testid="capture-stop-active"]') !== null`))
    .toBe(true);
  await h.inSidePanel(click('capture-stop-active'));
  expect(await h.waitForEnd(session.sessionId)).toMatchObject({ exitReason: 'USER_STOP' });
  await expectReleased();
  await h.clickAction(second);
  const next = await h.waitForSession('LISTENING', seen);
  expect((await h.storage('activeSession'))?.['sessionId']).toBe(next.sessionId);
  await h.inSidePanel(click('capture-stop'));
  await h.waitForEnd(next.sessionId);
  await expectReleased();
  await first.close();
  await second.close();
});

test('S8: the service worker is terminated; the capture goes on and stop still works', async () => {
  const { page, session } = await startCapture();
  const before = await h.lastDiag();
  await h.restartServiceWorker();
  // The offscreen keeps the session: diagnostics keep coming.
  await page.waitForTimeout(2_000);
  const after = await h.lastDiag();
  expect(after?.sessionId).toBe(session.sessionId);
  expect(after?.state).toBe('LISTENING');
  expect(after?.seq ?? 0).toBeGreaterThan(before?.seq ?? 0);
  // Stop wakes the worker, which reads the routing state from storage.
  await h.inSidePanel(click('capture-stop'));
  expect(await h.waitForEnd(session.sessionId)).toMatchObject({ exitReason: 'USER_STOP' });
  await expectReleased();
  // A start from a freshly woken worker works (ADR-0002).
  const again = await startCapture(page);
  await h.inSidePanel(click('capture-stop'));
  await h.waitForEnd(again.session.sessionId);
  await expectReleased();
  await page.close();
});

test('listening to a pure tone ends in INSUFFICIENT_DATA, with the analysis that says why (I-06b, I-07)', async () => {
  test.setTimeout(120_000);
  const { page, session } = await startCapture();
  const end = await h.waitForEnd(session.sessionId, 90_000);
  expect(end.state).toBe('INSUFFICIENT_DATA');
  // libfvad calls a loud tone speech (measured in Node, I-07): it stops at 18 s of valid speech;
  // a tone it rejects reaches the 45 s of listening instead.
  expect(['MAX_VALID_SPEECH', 'WALL_TIMEOUT']).toContain(end.exitReason);
  if (end.exitReason === 'MAX_VALID_SPEECH') expect(end.validSpeechMs).toBeGreaterThanOrEqual(18_000);
  else expect(end.activeMs).toBeGreaterThanOrEqual(45_000);
  // A tone never passes a split-half evaluation (p6 is not measurable).
  expect(end.stability?.converged ?? false).toBe(false);
  // The tab's DSP worker loaded libfvad (no failure) and found no voice: a tone has no syllables.
  expect(end.analysis?.failure).toBeNull();
  expect(end.analysis?.extractorVersion).toBe('extractor-0-experimental');
  expect(end.analysis?.seed).toBeNull();
  expect(end.analysis?.quality?.missingFeatureKeys).toContain('p6_rhythm');
  // Review M-3: no block refused (a stable channel count), and as much audio as listened, within 1 s.
  expect(end.analysis?.quality?.droppedFrames).toBe(0);
  expect(Math.abs((end.analysis?.analysedMs ?? Number.NaN) - end.activeMs)).toBeLessThan(1_000);
  test.info().annotations.push({ type: 'tab tone analysis', description: JSON.stringify(end.analysis) });
  await expectReleased();
  await page.close();
});

test('a paused session ends at 120 s from the start, pauses included', async () => {
  test.setTimeout(180_000);
  const { page, session } = await startCapture();
  await page.waitForTimeout(2_000);
  await vc(page, 'pause');
  const end = await h.waitForEnd(session.sessionId, 150_000);
  expect(end).toMatchObject({ state: 'INSUFFICIENT_DATA', exitReason: 'ABSOLUTE_TIMEOUT' });
  expect(end.elapsedMs).toBeGreaterThanOrEqual(120_000);
  expect(end.activeMs).toBeLessThan(45_000);
  await expectReleased();
  await page.close();
});
