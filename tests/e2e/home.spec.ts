import { expect, test } from '@playwright/test';
import { strings } from '../../extension/src/ui/strings.it.ts';
import { ExtensionHarness, OTHER_URL } from './harness.ts';

const q = (testId: string): string => `document.querySelector('[data-testid="${testId}"]')`;

test('I-21 Home: sources, keyboard, local notice and archive in a narrow panel', async () => {
  test.setTimeout(60_000);
  const h = new ExtensionHarness();
  await h.launch();
  try {
    const tab = await h.context.newPage();
    await tab.goto(OTHER_URL);
    await tab.bringToFront();
    await h.clickAction(tab);
    await expect.poll(async () => (await h.sidePanels()).length, { timeout: 15_000 }).toBe(1);
    await expect.poll(() => h.inSidePanel(`${q('shell-screen')}?.dataset.screen`), { timeout: 15_000 }).toBe('HOME');
    await h.inSidePanel(`(() => {
      ${q('shell-source-file')}.click();
      ${q('shell-notice-toggle')}.click();
      ${q('shell-licenses')}.click();
    })()`);
    expect(await h.inSidePanel(`${q('shell-source-file')}?.getAttribute('aria-expanded')`)).toBe('true');
    expect(await h.inSidePanel(`${q('shell-notice')}?.open`)).toBe(true);
    expect(await h.inSidePanel(`${q('shell-licenses')}?.getAttribute('aria-expanded')`)).toBe('true');
    expect(await h.axeSidePanel()).toEqual([]);

    const page = await h.context.newPage();
    await page.setViewportSize({ width: 380, height: 800 });
    await page.goto(`chrome-extension://${h.extensionId}/sidepanel.html`);
    const collection = page.getByRole('button', { name: 'Apri la Collezione' });
    const tabSource = page.getByRole('button', { name: 'Scheda', exact: true });
    const micSource = page.getByRole('button', { name: 'Microfono', exact: true });
    const fileSource = page.getByRole('button', { name: 'File', exact: true });
    for (const control of [collection, tabSource, micSource, fileSource]) {
      await expect(control).toBeInViewport({ ratio: 1 });
    }
    await expect(page.getByTestId('file-input')).toBeHidden();
    await page.keyboard.press('Tab');
    await expect(collection).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(tabSource).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(tabSource).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText(strings.shell.home.tabText)).toBeVisible();
    expect(await h.offscreenCount()).toBe(0);

    await page.keyboard.press('Tab');
    await expect(micSource).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(fileSource).toBeFocused();
    await page.keyboard.press('Space');
    await expect(tabSource).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('file-input')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('file-input')).toBeFocused();
    await expect(page.getByTestId('file-start')).toBeHidden();
    await page.getByTestId('file-input').setInputFiles({
      name: 'rifiutato.wav',
      mimeType: 'audio/wav',
      buffer: Buffer.from('invalid audio'),
    });
    await expect(page.getByTestId('file-error')).toBeVisible();

    await page.getByText(strings.shell.home.noticeTitle, { exact: true }).click();
    await expect(page.getByText(strings.shell.home.noticeText)).toBeVisible();
    await page.getByRole('button', { name: strings.shell.home.licenses }).click();
    await expect(page.getByRole('link', { name: 'Spectral (SIL OFL 1.1)' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'IBM Plex Mono (SIL OFL 1.1)' })).toBeVisible();
    await page.getByTestId('shell-archive-toggle').click();
    const importButton = page.getByRole('button', { name: strings.shell.home.archive.importBtn });
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), importButton.click()]);
    await chooser.setFiles({ name: 'non-valido.json', mimeType: 'application/json', buffer: Buffer.from('invalid backup') });
    await expect(page.getByTestId('shell-vault-error')).toBeVisible();
    await expect(page.getByRole('button', { name: strings.shell.home.archive.exportBtn })).toBeVisible();

    await page.setViewportSize({ width: 320, height: 800 });
    expect(await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth === root.clientWidth;
    })).toBe(true);
  } finally {
    await h.close();
  }
});
