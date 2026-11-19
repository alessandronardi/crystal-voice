// I-20 E2E: full-card navigation, opt-in filters and selection, detail deletion,
// side-by-side Comparison on a shared platter with fixedScale, G0-DOC-02 wording,
// axe-core accessibility check, and version-mismatch blocking.
// Requires `pnpm build`.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import axe from 'axe-core';
import type { CrystalRecordV1, CrystalSeed, VoiceCrystalExportV1 } from '../../packages/contracts/src/index.ts';
import { generateCrystalGeometry } from '../../packages/crystal-core/src/index.ts';
import { ExtensionHarness, OTHER_URL } from './harness.ts';

const h = new ExtensionHarness();
let panelTab: Page;
let tmp: string;

test.describe.configure({ mode: 'serial' });

const q = (testId: string): string => `document.querySelector('[data-testid="${testId}"]')`;

function buildRecord(
  id: string,
  specimenNumber: number,
  seed: CrystalSeed,
  overrides: Partial<CrystalRecordV1> = {},
): CrystalRecordV1 {
  const confidence = [1, 1, 1, 1, 1, 1] as const;
  const geom = generateCrystalGeometry(seed, confidence, 'habit-1');
  return {
    id,
    specimenNumber,
    schemaVersion: 1,
    createdAt: '2026-11-15T10:00:00.000Z',
    title: '',
    speakerLabel: null,
    source: { kind: 'mic' },
    seed,
    confidence,
    rawMeasures: [7.2, 2.5, 14, 0.12, 10.1, 4],
    extractorVersion: 'extractor-0',
    mappingVersion: 'mapping-0',
    geometryVersion: 'habit-1',
    comparatorVersion: 'comparator-0',
    captureExitReason: 'CONVERGED',
    quality: {
      accepted: true,
      validSpeechMs: 12000,
      pitchUsableFrames: 400,
      vadSpeechFrames: 500,
      droppedFrames: 0,
      clippedFraction: 0,
      confidence,
      missingFeatureKeys: [],
      warnings: [],
    },
    geometryHash: geom.geometryHash,
    tags: [],
    ...overrides,
  };
}

async function axeSeriousViolations(page: Page): Promise<{ id: string; impact: string; targets: string[] }[]> {
  await page.evaluate((src) => {
    if ((globalThis as { axe?: unknown }).axe === undefined) {
      // eslint-disable-next-line no-eval
      (0, eval)(src);
    }
  }, axe.source);
  return page.evaluate(async () => {
    const a = (
      globalThis as unknown as {
        axe: { run(doc: Document, opts: unknown): Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> };
      }
    ).axe;
    const res = await a.run(document, { resultTypes: ['violations'] });
    return res.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target.join(' ')) }));
  });
}

async function patchRecordVersion(
  page: Page,
  id: string,
  patch: { mappingVersion?: string; extractorVersion?: string },
): Promise<void> {
  await page.evaluate(
    ([targetId, fields]) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('voicecrystal');
        req.onerror = () => {
          reject(req.error ?? new Error('indexedDB open failed'));
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['crystals'], 'readwrite');
          const store = tx.objectStore('crystals');
          const get = store.get(targetId);
          get.onsuccess = () => {
            const rec = get.result as Record<string, unknown>;
            if (fields.mappingVersion !== undefined) rec['mappingVersion'] = fields.mappingVersion;
            if (fields.extractorVersion !== undefined) rec['extractorVersion'] = fields.extractorVersion;
            store.put(rec);
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            reject(tx.error ?? new Error('indexedDB tx failed'));
          };
        };
      }),
    [id, patch] as const,
  );
}

test.beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'voicecrystal-collection-e2e-'));
  await h.launch();
  panelTab = await h.context.newPage();
  await panelTab.goto(OTHER_URL);
  await h.clickAction(panelTab);
  await expect.poll(() => h.inSidePanel(`${q('shell-open-collection')} !== null`), { timeout: 20_000 }).toBe(true);
});

test.afterAll(async () => {
  await h.close();
  rmSync(tmp, { recursive: true, force: true });
});

test('I-20 Collection and Comparison from an empty archive through filtering, keyboard navigation and deletion', async () => {
  test.setTimeout(120_000);

  // 1. Empty collection.html has zero console errors, zero axe violations, and zero IndexedDB databases created.
  const emptyPageErrors: string[] = [];
  const emptyPage = h.probe;
  emptyPage.on('pageerror', (err) => emptyPageErrors.push(err.message));
  emptyPage.on('console', (msg) => {
    if (msg.type() === 'error') emptyPageErrors.push(msg.text());
  });
  await expect(emptyPage.getByTestId('collection-empty')).toBeVisible();
  await expect(emptyPage.getByTestId('collection-empty')).toContainText('importa un archivio JSON');
  await expect(emptyPage.getByTestId('collection-toggle-comparison')).toBeDisabled();
  expect(await emptyPage.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).toEqual([]);
  expect(await axeSeriousViolations(emptyPage)).toEqual([]);
  expect(emptyPageErrors).toEqual([]);

  // 2. Import 3 distinct specimens through the Side Panel, then click "Apri la Collezione a tutta scheda".
  const idA = '11111111-1111-4111-8111-111111111111';
  const idB = '22222222-2222-4222-8222-222222222222';
  const idC = '33333333-3333-4333-8333-333333333333';
  const longTitle = `Esemplare Ciano ${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(7)}`;

  const exportPayload: VoiceCrystalExportV1 = {
    format: 'voicecrystal-export',
    version: 1,
    exportedAt: '2026-11-15T10:00:00.000Z',
    records: [
      buildRecord(idA, 1, [0, 2000, 5000, 1000, 1000, 3000], {
        title: 'Esemplare Rubino',
        source: { kind: 'mic' },
        createdAt: '2026-11-10T10:00:00.000Z',
      }),
      buildRecord(idB, 2, [4500, 5000, 5000, 1000, 6000, 3000], {
        title: longTitle,
        source: {
          kind: 'file',
          fileName: 'sample.wav',
          durationSeconds: 30,
          offsetStartSeconds: 0,
          offsetEndSeconds: 20,
        },
        createdAt: '2026-11-12T10:00:00.000Z',
      }),
      buildRecord(idC, 3, [9500, 9000, 5000, 1000, 9000, 3000], {
        source: { kind: 'tab' },
        createdAt: '2026-11-15T10:00:00.000Z',
      }),
    ],
  };

  const backupPath = join(tmp, 'collection-seed.json');
  writeFileSync(backupPath, JSON.stringify(exportPayload));
  await h.setPanelFile('shell-import-input', backupPath);
  await expect
    .poll(
      async () => {
        const state = (await h.inSidePanel(
          `({ statusHidden: ${q('shell-archive-status')}?.hidden ?? true, errHidden: ${q('shell-vault-error')}?.hidden ?? true, errCode: ${q('shell-vault-error')}?.dataset.code ?? '', errText: ${q('shell-vault-error')}?.textContent ?? '' })`,
        )) as { statusHidden: boolean; errHidden: boolean; errCode: string; errText: string };
        if (!state.errHidden) {
          throw new Error(`Unexpected vault import error [${state.errCode}]: ${state.errText}`);
        }
        return state.statusHidden;
      },
      { timeout: 30_000 },
    )
    .toBe(false);

  // Simulate an imported record whose thumbnail was unavailable during import.
  await h.probe.evaluate((id) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('voicecrystal');
    request.onerror = () => {
      reject(request.error ?? new Error('indexedDB open failed'));
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('thumbnails', 'readwrite');
      tx.objectStore('thumbnails').delete(id);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error ?? new Error('thumbnail deletion failed'));
      };
    };
  }), idC);

  const [collectionPage] = await Promise.all([
    h.context.waitForEvent('page'),
    h.inSidePanel(`(() => { ${q('shell-open-collection')}.click(); return true; })()`),
  ]);
  await collectionPage.setViewportSize({ width: 1440, height: 900 });
  const colErrors: string[] = [];
  collectionPage.on('pageerror', (err) => colErrors.push(err.message));
  collectionPage.on('console', (msg) => {
    if (msg.type() === 'error') colErrors.push(msg.text());
  });

  await collectionPage.waitForLoadState('load');
  await expect(collectionPage.getByTestId('collection-card')).toHaveCount(3, { timeout: 30_000 });
  const cardA = collectionPage.locator(`[data-testid="collection-card"][data-specimen-id="${idA}"]`);
  const cardB = collectionPage.locator(`[data-testid="collection-card"][data-specimen-id="${idB}"]`);
  const cardC = collectionPage.locator(`[data-testid="collection-card"][data-specimen-id="${idC}"]`);
  await expect(cardC.getByRole('button', { name: 'VC-0003' })).toBeVisible();
  await expect(cardC.locator('.vc-specimen-preview svg')).toBeVisible();
  await expect(collectionPage.locator('.vc-specimen-preview :is(img, svg)')).toHaveCount(3);
  await expect(collectionPage.locator('canvas')).toHaveCount(0);
  await collectionPage.setViewportSize({ width: 320, height: 800 });
  await expect(cardB.getByRole('button', { name: longTitle })).toHaveText(longTitle);
  const { scrollWidth, clientWidth } = await collectionPage.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBe(clientWidth);
  await collectionPage.setViewportSize({ width: 1440, height: 900 });
  await expect(collectionPage.getByTestId('collection-filters')).toBeHidden();
  await expect(collectionPage.getByTestId('collection-compare-bar')).toHaveCount(0);
  expect(await axeSeriousViolations(collectionPage)).toEqual([]);

  // 3. Test filters: habit, color, source, date, and reset.
  const filterToggle = collectionPage.getByRole('button', { name: 'Filtri', exact: true });
  await filterToggle.press('Space');
  await expect(filterToggle).toHaveAttribute('aria-expanded', 'true');
  await collectionPage.getByTestId('filter-habit').selectOption('hexagonal');
  await expect(collectionPage.getByTestId('collection-card')).toHaveCount(1);
  await expect(collectionPage.getByTestId('collection-card').first()).toContainText('Esemplare Ciano');

  await collectionPage.getByTestId('filter-reset').click();
  await expect(collectionPage.getByTestId('collection-card')).toHaveCount(3);

  await collectionPage.getByTestId('filter-color').selectOption('ruby');
  await expect(collectionPage.getByTestId('collection-card')).toHaveCount(1);
  await expect(collectionPage.getByTestId('collection-card').first()).toContainText('Esemplare Rubino');

  await collectionPage.getByTestId('filter-reset').click();
  await collectionPage.getByTestId('filter-source').selectOption('tab');
  await expect(collectionPage.getByTestId('collection-card')).toHaveCount(1);
  await expect(collectionPage.getByTestId('collection-card').first()).toContainText('VC-0003');

  await collectionPage.getByTestId('filter-reset').click();
  await collectionPage.getByTestId('filter-date-from').fill('2026-11-11');
  await collectionPage.getByTestId('filter-date-to').fill('2026-11-13');
  await expect(collectionPage.getByTestId('collection-card')).toHaveCount(1);
  await expect(collectionPage.getByTestId('collection-card').first()).toContainText('Esemplare Ciano');

  await collectionPage.getByTestId('filter-reset').click();
  await expect(collectionPage.getByTestId('collection-card')).toHaveCount(3);
  await collectionPage.getByTestId('filter-date-from').fill('2027-01-01');
  await expect(collectionPage.getByTestId('collection-empty-filtered')).toBeVisible();
  await collectionPage.getByTestId('filter-reset-empty').click();
  await expect(collectionPage.getByTestId('collection-card')).toHaveCount(3);
  await filterToggle.click();
  await expect(filterToggle).toHaveAttribute('aria-expanded', 'false');

  // 4. Open the full card by keyboard and return focus to the same specimen.
  const openA = cardA.getByRole('button', { name: 'Esemplare Rubino', exact: true });
  await openA.press('Enter');
  await expect(collectionPage.getByTestId('collection-detail')).toBeVisible({ timeout: 30_000 });
  const stage = collectionPage.getByTestId('collection-detail-stage');
  const deleteButton = collectionPage.getByTestId('delete-specimen');
  await expect(stage).toBeVisible();
  expect(await stage.evaluate((el) => {
    const action = document.querySelector('[data-testid="delete-specimen"]');
    return Boolean(action && (el.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING));
  })).toBe(true);
  const close = collectionPage.getByTestId('collection-detail-close');
  await expect(close).toBeFocused();
  await close.press('Enter');
  await expect(collectionPage.getByTestId('collection-detail')).toHaveCount(0);
  await expect(openA).toBeFocused();

  // 5. Select two compatible specimens (A & B) and open side-by-side Comparison.
  const compareToggle = collectionPage.getByTestId('collection-toggle-comparison');
  const selectA = cardA.getByTestId('select-specimen');
  const selectB = cardB.getByTestId('select-specimen');
  const start = collectionPage.getByTestId('start-comparison');
  await compareToggle.press('Enter');
  await selectA.press('Space');
  await expect(selectA).toBeFocused();
  await expect(selectA).toHaveAttribute('aria-pressed', 'true');
  await expect(selectA).toContainText('Selezionato come A');
  await expect(start).toBeDisabled();
  await compareToggle.click();
  await expect(collectionPage.getByTestId('collection-compare-bar')).toHaveCount(0);
  await expect(openA).toBeVisible();
  await compareToggle.click();
  await expect(selectA).toHaveAttribute('aria-pressed', 'false');
  await selectA.click();
  await selectB.click();
  await expect(cardC.getByTestId('select-specimen')).toBeDisabled();
  await expect(selectB).toContainText('Selezionato come B');
  await selectA.click();
  await expect(start).toBeDisabled();
  await selectA.click();
  await expect(start).toBeEnabled();
  await start.click();

  await expect(collectionPage.getByTestId('comparison-view')).toBeVisible({ timeout: 30_000 });
  await expect(collectionPage.getByTestId('comparison-heading')).toHaveText('Affinità acustica / geometrica');
  await expect(collectionPage.getByTestId('comparison-stage-a')).toHaveAttribute('data-fixed-scale', 'true');
  await expect(collectionPage.getByTestId('comparison-stage-b')).toHaveAttribute('data-fixed-scale', 'true');
  await expect(collectionPage.getByTestId('comparison-percentile-value')).toHaveText(/^\d{1,3}%$/);
  await expect(collectionPage.getByTestId('comparison-contribution-row')).toHaveCount(6);
  await expect(collectionPage.getByTestId('comparison-non-biometric-notice')).toContainText('non verifica né identifica');
  await expect(collectionPage.getByTestId('comparison-blocked')).toHaveCount(0);

  // Move synchronized platter slider.
  await collectionPage.getByTestId('comparison-angle-slider').fill('90');
  await collectionPage.getByTestId('comparison-angle-slider').dispatchEvent('input');

  // Verify accessible Comparison view (zero serious/critical violations).
  expect(await axeSeriousViolations(collectionPage)).toEqual([]);

  // Open technical details and verify Euclidean affinity + comparator version.
  await collectionPage.locator('[data-testid="comparison-technical-details"] summary').click();
  await expect(collectionPage.getByTestId('comparison-technical-details')).toContainText('comparator-0');
  await collectionPage.getByTestId('comparison-back').press('Enter');
  await expect(compareToggle).toBeFocused();
  await expect(collectionPage.getByTestId('collection-compare-bar')).toHaveCount(0);

  // 6. Test version mismatch blocking: incompatible mappingVersion and extractorVersion.
  await patchRecordVersion(collectionPage, idB, { mappingVersion: 'mapping-1' });
  await collectionPage.goto(`chrome-extension://${h.extensionId}/collection.html?a=${idA}&b=${idB}`);
  await expect(collectionPage.getByTestId('comparison-blocked')).toBeVisible({ timeout: 30_000 });
  await expect(collectionPage.getByTestId('comparison-blocked')).toHaveAttribute('data-reason', 'INCOMPATIBLE_MAPPING_VERSION');
  await expect(collectionPage.getByTestId('comparison-percentile-value')).toHaveCount(0);

  await patchRecordVersion(collectionPage, idB, {
    mappingVersion: 'mapping-0',
    extractorVersion: 'extractor-legacy',
  });
  await collectionPage.goto(`chrome-extension://${h.extensionId}/collection.html?a=${idA}&b=${idB}`);
  await expect(collectionPage.getByTestId('comparison-blocked')).toBeVisible({ timeout: 30_000 });
  await expect(collectionPage.getByTestId('comparison-blocked')).toHaveAttribute('data-reason', 'INCOMPATIBLE_EXTRACTOR_VERSION');
  await expect(collectionPage.getByTestId('comparison-percentile-value')).toHaveCount(0);

  await collectionPage.goto(`chrome-extension://${h.extensionId}/collection.html?a=${idA}&b=${idA}`);
  await expect(collectionPage.getByTestId('collection-card')).toHaveCount(3);
  await expect(collectionPage.getByTestId('comparison-view')).toHaveCount(0);

  // 7. Delete in the detail only, with a cancellable modal and explicit confirmation.
  await cardC.getByTestId('open-specimen').click();
  await deleteButton.click();
  const confirm = collectionPage.getByRole('alertdialog');
  await expect(confirm).toHaveAccessibleName('Eliminare definitivamente l’esemplare VC-0003?');
  await expect(confirm.getByRole('button', { name: 'Annulla' })).toBeFocused();
  await collectionPage.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(deleteButton).toBeFocused();
  await deleteButton.click();
  await confirm.getByRole('button', { name: 'Sì, elimina' }).click();
  await expect(collectionPage.getByTestId('collection-card')).toHaveCount(2);
  await expect(collectionPage.getByTestId('collection-heading')).toBeFocused();
  for (const card of [cardA, cardB]) {
    const image = card.locator('.vc-specimen-preview :is(img, svg)');
    const title = card.locator('.vc-specimen-title');
    await expect(image).toBeInViewport({ ratio: 1 });
    await expect(title).toBeInViewport({ ratio: 1 });
    const imageBox = await image.boundingBox();
    const titleBox = await title.boundingBox();
    if (imageBox === null || titleBox === null) throw new Error('expected the preview and title on screen');
    expect(titleBox.y).toBeGreaterThanOrEqual(imageBox.y + imageBox.height);
  }

  // Continue using the vault after deletion and gate comparison on the total record count.
  await cardB.getByTestId('open-specimen').click();
  await deleteButton.click();
  await confirm.getByRole('button', { name: 'Sì, elimina' }).click();
  await expect(collectionPage.getByTestId('collection-card')).toHaveCount(1);
  await expect(compareToggle).toBeDisabled();

  expect(colErrors).toEqual([]);
  await collectionPage.close();
});
