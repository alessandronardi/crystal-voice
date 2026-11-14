// I-13b: the several-voices notice (SPEC §13 [F], D4; ADR-0026 point 4.3,
// D-AM) with the fake microphone looping a-then-b.wav (synthetic voice A for
// 8 s, then voice B for 10 s). Whether the heuristic fires is the extractor's
// business (ADR-0024: measured, not guaranteed); this file checks what the
// panel and the session do once it does: the dialog, «No» and «Sì».
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { ExtensionHarness, OTHER_URL } from './harness.ts';

const A_THEN_B = resolve(import.meta.dirname, '../fixtures/a-then-b.wav');
const h = new ExtensionHarness();

test.describe.configure({ mode: 'serial' });

const q = (testId: string): string => `document.querySelector('[data-testid="${testId}"]')`;
const click = (testId: string): string => `(() => { const el = ${q(testId)}; if (el === null) return false; el.click(); return true; })()`;
const screen = (): Promise<unknown> => h.inSidePanel(`${q('shell-screen')}?.dataset.screen ?? ''`);
const dialogShown = (): Promise<unknown> => h.inSidePanel(`${q('shell-multi-speaker')}?.hidden === false`);

test.beforeAll(async () => {
  await h.launch({ args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${A_THEN_B}`] });
  const tab = await h.context.newPage();
  await tab.goto(OTHER_URL);
  await h.clickAction(tab);
  await expect.poll(() => h.inSidePanel(`${q('capture-use-mic')} !== null`)).toBe(true);
  await h.grantMic();
});

test.afterAll(async () => {
  await h.close();
});

async function listenUntilNotice(): Promise<string> {
  const seen = await h.seenSessions();
  await expect.poll(() => h.inSidePanel(click('capture-use-mic')), { timeout: 15_000 }).toBe(true);
  const session = await h.waitForSession('LISTENING', seen);
  await expect.poll(screen).toBe('LIVE');
  await expect.poll(dialogShown, { timeout: 60_000 }).toBe(true);
  return session.sessionId;
}

test('«No, interrompi» ends the session with MULTI_SPEAKER_DECLINED, and the outcome says why', async () => {
  test.setTimeout(120_000);
  const id = await listenUntilNotice();
  expect(String(await h.inSidePanel(`${q('shell-multi-speaker')}.textContent`))).toContain('Parla una sola persona in questo tratto?');
  // The notice is on the screen: no serious accessibility violation (axe-core).
  expect(await h.axeSidePanel()).toEqual([]);
  expect(await h.inSidePanel(click('shell-multi-no'))).toBe(true);
  const end = await h.waitForEnd(id, 15_000);
  expect([end.state, end.exitReason]).toEqual(['INTERRUPTED', 'MULTI_SPEAKER_DECLINED']);
  await expect.poll(screen).toBe('OUTCOME');
  expect(String(await h.inSidePanel(`${q('shell-screen')}.textContent`))).toContain('Più voci nello stesso tratto.');
  expect(await h.inSidePanel(click('shell-back'))).toBe(true);
  await expect.poll(screen).toBe('HOME');
});

test('«Sì, continua» holds for the rest of the session: the notice does not come back', async () => {
  test.setTimeout(150_000);
  const id = await listenUntilNotice();
  expect(await h.inSidePanel(click('shell-multi-yes'))).toBe(true);
  await expect.poll(() => h.inSidePanel(`${q('shell-multi-confirmed')}?.hidden === false`)).toBe(true);
  // D-AM: whatever the heuristic says next, no new question in this session.
  const end = await h.waitForEnd(id, 120_000);
  const diags = (await h.diags()).filter((d) => d.sessionId === id);
  const confirmedAt = diags.findIndex((d) => (d as { multiSpeaker?: string }).multiSpeaker === 'CONFIRMED');
  expect(confirmedAt).toBeGreaterThanOrEqual(0);
  expect(diags.slice(confirmedAt).every((d) => (d as { multiSpeaker?: string }).multiSpeaker === 'CONFIRMED')).toBe(true);
  expect(end.state === 'RESULT_READY' || end.state === 'INSUFFICIENT_DATA').toBe(true);
  test.info().annotations.push({ type: 'end after «Sì»', description: `${end.state} / ${String(end.exitReason)}` });
  if (end.state === 'RESULT_READY') {
    await expect.poll(screen).toBe('REVEALED');
    // The warning stays on the label (D-AM) when the final analysis keeps it.
    if (end.analysis?.quality?.warnings.includes('MULTI_SPEAKER_SUSPECTED') === true) {
      expect(String(await h.inSidePanel(`${q('shell-label')}.textContent`))).toContain('forse più di una voce');
    }
  }
});
