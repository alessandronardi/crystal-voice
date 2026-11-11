// I-17 E2E: permission.html on its own. Here --use-fake-ui-for-media-stream
// answers the browser prompt with «Consenti», so this proves only the page:
// the button asks, the outcome is shown, and no microphone track is kept. It
// does NOT prove that the offscreen can use the grant afterwards (mic.spec.ts
// covers that with a CDP grant; the real prompt is M13 in MANUAL_CHECKLIST.md).
// Requires `pnpm build` first.
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { ExtensionHarness } from './harness.ts';

const FAKE_MIC_WAV = resolve(import.meta.dirname, '../fixtures/voice-a.wav');

const h = new ExtensionHarness();

test.beforeAll(async () => {
  await h.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${FAKE_MIC_WAV}`,
    ],
  });
});

test.afterAll(async () => {
  await h.close();
});

test('the permission page asks once, shows the grant and keeps no microphone track', async () => {
  const page = await h.context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${h.extensionId}/permission.html`);
  await expect(page).toHaveTitle('Microfono · VoiceCrystal');
  const status = page.getByTestId('permission-status');
  const allow = page.getByTestId('permission-allow');
  await expect(allow).toBeEnabled();
  // With the fake UI the Permissions API already reports a grant at load.
  test.info().annotations.push({
    type: 'outcome at load (fake UI)',
    description: String(await status.getAttribute('data-outcome')),
  });

  // Record the streams the page obtains, to check it stops them.
  await page.evaluate(() => {
    const g = globalThis as unknown as { vcStreams: MediaStream[] };
    g.vcStreams = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      g.vcStreams.push(stream);
      return stream;
    };
  });
  await allow.click();
  await expect(status).toHaveAttribute('data-outcome', 'granted');
  await expect(status).toContainText('il microfono è autorizzato');

  const tracks = await page.evaluate(() =>
    (globalThis as unknown as { vcStreams: MediaStream[] }).vcStreams.flatMap((s) =>
      s.getTracks().map((t) => ({ kind: t.kind, readyState: t.readyState })),
    ),
  );
  expect(tracks.length).toBeGreaterThan(0);
  expect(tracks.every((t) => t.kind === 'audio' && t.readyState === 'ended')).toBe(true);
  expect(errors).toEqual([]);
  // The page opened no capture of its own through the extension.
  expect(await h.offscreenCount()).toBe(0);
  await page.close();
});
