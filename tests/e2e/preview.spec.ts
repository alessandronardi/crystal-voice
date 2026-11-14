// Screenshots of the side panel for the product owner's aesthetic review
// (I-13b; decisions D-AJ and later). Not a test: it runs only when
// VC_PREVIEW_DIR names an output folder, and asserts nothing about the look.
//   VC_PREVIEW_DIR=out pnpm exec playwright test tests/e2e/preview.spec.ts
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { ExtensionHarness, OTHER_URL } from './harness.ts';

const OUT = process.env['VC_PREVIEW_DIR'];
const FIXTURES = resolve(import.meta.dirname, '../fixtures');
const h = new ExtensionHarness();
const q = (testId: string): string => `document.querySelector('[data-testid="${testId}"]')`;
const screen = (): Promise<unknown> => h.inSidePanel(`${q('shell-screen')}?.dataset.screen ?? ''`);
const phase = (): Promise<unknown> => h.inSidePanel(`${q('file-status')}?.dataset.phase ?? ''`);

test.skip(OUT === undefined, 'VC_PREVIEW_DIR not set');
test.setTimeout(120_000);

async function shot(name: string): Promise<void> {
  if (OUT === undefined) return;
  mkdirSync(OUT, { recursive: true });
  await h.withSidePanel(async (send) => {
    // A side panel about 360 px wide, the whole page height.
    const size = (await send('Runtime.evaluate', { expression: 'document.documentElement.scrollHeight', returnByValue: true })) as { result: { value: number } };
    await send('Emulation.setDeviceMetricsOverride', { width: 360, height: Math.max(640, size.result.value), deviceScaleFactor: 2, mobile: false });
    const png = (await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })) as { data: string };
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(png.data, 'base64'));
    await send('Emulation.clearDeviceMetricsOverride', {});
  });
}

test('preview of the I-13b screens', async () => {
  if (!existsSync(join(FIXTURES, 'voice-a-long.wav'))) throw new Error('run `pnpm fixtures` first');
  await h.launch();
  const tab = await h.context.newPage();
  await tab.goto(OTHER_URL);
  await h.clickAction(tab);
  await expect.poll(() => h.inSidePanel(`${q('file-input')} !== null`)).toBe(true);
  await shot('1-home');
  await h.setPanelFile('file-input', join(FIXTURES, 'voice-a-long.wav'));
  await expect.poll(phase, { timeout: 15_000 }).toBe('ready');
  await h.inSidePanel(`(() => { ${q('file-analyze')}.click(); return true; })()`);
  await expect.poll(screen, { timeout: 30_000 }).toBe('REVEALED');
  await tab.waitForTimeout(1_500);
  await shot('2-revealed');
  // Select the prism row: the trait lights up on the showcase.
  await h.inSidePanel(`(() => { document.querySelector('[data-testid="legend-row"][data-key="p1_pitch"]').click(); return true; })()`);
  await tab.waitForTimeout(800);
  await shot('3-legend-prism');
  await h.inSidePanel(`(() => { document.querySelector('[data-testid="legend-row"][data-key="p2_intonation"]').click(); return true; })()`);
  await tab.waitForTimeout(800);
  await shot('4-legend-terminations');
  const info = await h.inSidePanel(`JSON.stringify({ profile: ${q('shell-showcase')}.dataset.profile, reason: ${q('shell-showcase')}.dataset.profileReason, highlight: ${q('shell-showcase')}.dataset.highlight, fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family + ' ' + f.weight) })`);
  if (OUT !== undefined) writeFileSync(join(OUT, 'info.json'), String(info));
  await h.close();
});
