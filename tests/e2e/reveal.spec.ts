import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ExtensionHarness } from './harness.ts';

const FIXTURES = resolve(import.meta.dirname, '../fixtures');

async function analyzeFile(panel: Page, name: string): Promise<void> {
  const openFile = panel.getByTestId('shell-source-file');
  if (await openFile.count() > 0 && !(await panel.getByTestId('file-input').isVisible())) await openFile.click();
  await panel.getByTestId('file-input').setInputFiles(resolve(FIXTURES, name));
  await expect(panel.getByTestId('file-status')).toHaveAttribute('data-phase', 'ready', { timeout: 15_000 });
  await panel.getByTestId('file-analyze').click();
  await expect(panel.getByTestId('shell-screen')).toHaveAttribute('data-screen', 'REVEALED', { timeout: 30_000 });
}

async function expectFirstViewport(panel: Page, width: number): Promise<void> {
  await panel.setViewportSize({ width, height: 800 });
  await panel.evaluate(() => { window.scrollTo(0, 0); });
  for (const id of ['shell-showcase', 'shell-specimen-name', 'shell-save']) {
    await expect.poll(async () =>
      panel.getByTestId(id).evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth;
      }),
    ).toBe(true);
  }
  const aspectError = await panel.getByTestId('shell-showcase').locator('canvas').evaluate((canvas) => {
    const rect = canvas.getBoundingClientRect();
    return rect.width - rect.height;
  });
  expect(aspectError).toBeCloseTo(0, 1);
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('I-22: both reference crystals fit the panel and can be saved and compared from the Collection', async () => {
  test.setTimeout(120_000);
  const h = new ExtensionHarness();
  await h.launch();
  try {
    const panel = await h.context.newPage();
    await panel.emulateMedia({ reducedMotion: 'no-preference' });
    await panel.setViewportSize({ width: 380, height: 800 });
    await panel.goto(`chrome-extension://${h.extensionId}/sidepanel.html`);
    const save = panel.getByTestId('shell-save');
    const heading = panel.getByTestId('shell-specimen-name');
    const collection = panel.getByTestId('shell-revealed-open-collection');
    const stage = panel.getByTestId('shell-showcase');
    const labelSummary = panel.getByTestId('shell-label-details-summary');
    const legendSummary = panel.getByTestId('shell-legend-details-summary');

    for (const [file, title, code] of [
      ['voice-a-long.wav', 'Lettura del mattino', 'VC-0001'],
      ['a-then-b.wav', 'Due timbri', 'VC-0002'],
    ] as const) {
      await analyzeFile(panel, file);
      await expect(stage.locator('canvas')).toBeVisible();
      await expect(stage).toHaveCSS('animation-name', 'vc-solidify');
      await expect(heading).toBeFocused();
      await expect(heading).toContainText(/prisma/u);
      await expect(save).toHaveText('Salva');
      await expect(collection).toHaveAccessibleName('Apri la Collezione a tutta scheda');
      await expect(labelSummary).toHaveText('Nome e cartellino');
      await expect(panel.getByTestId('shell-title-input')).toBeHidden();
      await expect(panel.getByTestId('legend-row').first()).toBeHidden();
      await expectFirstViewport(panel, 380);
      await expectFirstViewport(panel, 320);
      await panel.setViewportSize({ width: 380, height: 800 });

      await heading.press('Tab');
      await expect(save).toBeFocused();
      await save.press('Tab');
      await expect(labelSummary).toBeFocused();
      await labelSummary.press('Enter');
      await expect(panel.getByTestId('shell-label')).toBeVisible();
      await panel.getByLabel('Titolo (facoltativo)').fill(title);
      await expect(panel.getByTestId('shell-label')).toContainText(file);
      await legendSummary.press('Space');
      const legend = panel.getByTestId('legend-row');
      await expect(legend).toHaveCount(6);
      await expect(legend.first()).toContainText(/Hz · \d+° percentile/u);
      await legendSummary.press('Tab');
      await expect(legend.first()).toBeFocused();
      await legend.first().press('Enter');
      await expect(legend.first()).toHaveAttribute('aria-pressed', 'true');
      await expect(stage).toHaveAttribute('data-highlight', 'prism');
      if (file === 'a-then-b.wav') await expect(panel.getByTestId('shell-reveal-warnings')).toContainText('forse più di una voce');

      await save.press('Enter');
      await expect(heading).toHaveText(title, { timeout: 20_000 });
      await expect(panel.getByTestId('shell-save-confirmation')).toHaveText(`Salvato (${code})`);
      await expect(save).toHaveCount(0);
      await expect(collection).toBeFocused();
      if (code === 'VC-0001') await panel.getByTestId('shell-discard').press('Enter');
    }

    const opened = h.context.waitForEvent('page');
    await collection.press('Enter');
    const gallery = await opened;
    const first = gallery.getByTestId('collection-card').filter({ hasText: 'Lettura del mattino' });
    const second = gallery.getByTestId('collection-card').filter({ hasText: 'Due timbri' });
    await expect(gallery.getByTestId('collection-card')).toHaveCount(2);
    await first.getByRole('button', { name: 'Lettura del mattino', exact: true }).press('Enter');
    await expect(gallery.getByTestId('collection-detail')).toBeVisible({ timeout: 30_000 });
    await expect(gallery.getByTestId('collection-detail')).toContainText('voice-a-long.wav');
    await gallery.getByTestId('collection-detail-close').press('Enter');
    await expect(first.getByRole('button', { name: 'Lettura del mattino', exact: true })).toBeFocused();
    await gallery.getByTestId('collection-toggle-comparison').click();
    await first.getByTestId('select-specimen').click();
    await second.getByTestId('select-specimen').click();
    await gallery.getByTestId('start-comparison').click();
    await expect(gallery.getByTestId('comparison-view')).toBeVisible({ timeout: 30_000 });
  } finally {
    await h.close();
  }
});

test('I-22: reduced motion and SVG fallback keep the label and a retryable save available', async () => {
  test.setTimeout(90_000);
  const h = new ExtensionHarness();
  await h.launch({ args: ['--disable-webgl'] });
  try {
    const panel = await h.context.newPage();
    await panel.emulateMedia({ reducedMotion: 'reduce' });
    await panel.setViewportSize({ width: 320, height: 800 });
    await panel.goto(`chrome-extension://${h.extensionId}/sidepanel.html`);
    await analyzeFile(panel, 'voice-a-long.wav');
    const stage = panel.getByTestId('shell-showcase');
    await expect(stage.locator('svg')).toBeVisible();
    await expect(stage.locator('canvas')).toHaveCount(0);
    await expect(stage).toHaveCSS('animation-name', 'vc-fade');
    await expect(stage).toHaveCSS('animation-duration', '0.3s');

    await panel.getByTestId('shell-reveal-tools-summary').press('Enter');
    await expect(panel.getByTestId('shell-export-svg')).toBeEnabled();
    await expect(panel.getByTestId('shell-export-png')).toBeDisabled();
    await panel.getByTestId('shell-legend-details-summary').press('Enter');
    const row = panel.getByTestId('legend-row').first();
    await row.press('Space');
    await expect(row).toHaveAttribute('aria-pressed', 'true');
    await expect(stage).not.toHaveAttribute('data-highlight', 'prism');

    await panel.getByTestId('shell-label-details-summary').press('Enter');
    const speaker = panel.getByTestId('shell-speaker-input');
    await speaker.fill('Parlante A');
    await panel.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Called with the current object store below.
      const add = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey): IDBRequest<IDBValidKey> {
        if (this.name === 'crystals') {
          IDBObjectStore.prototype.add = add;
          throw new DOMException('Simulated vault quota', 'QuotaExceededError');
        }
        return add.call(this, value, key);
      };
    });
    const save = panel.getByTestId('shell-save');
    const error = panel.getByTestId('shell-save-error');
    await save.press('Enter');
    await expect(error).toBeVisible({ timeout: 15_000 });
    await expect(error).toHaveAttribute('data-code', 'QUOTA_EXCEEDED');
    await expect(save).toBeFocused();
    await expect(speaker).toHaveValue('Parlante A');
    await save.press('Enter');
    await expect(panel.getByTestId('shell-specimen-name')).toHaveText('Esemplare VC-0001', { timeout: 15_000 });
    await expect(error).toBeHidden();
    await panel.getByTestId('shell-label-details-summary').press('Enter');
    await expect(panel.getByTestId('shell-label')).toContainText('Parlante A');
  } finally {
    await h.close();
  }
});
