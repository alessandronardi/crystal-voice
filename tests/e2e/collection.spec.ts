// I-15 E2E: full-tab Collection (filters, detail, delete), Side Panel launch,
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
    extractorVersion: 'extractor-0-experimental',
    mappingVersion: 'mapping-0-experimental',
    geometryVersion: 'habit-1',
    comparatorVersion: 'comparator-0-experimental',
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
      warnings: ['EXPERIMENTAL_MAPPING'],
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
  await expect.poll(() => h.inSidePanel(`${q('shell-open-collection')} !== null`)).toBe(true);
});

test.afterAll(async () => {
  await h.close();
  rmSync(tmp, { recursive: true, force: true });
});

test('I-15 full Collection & Comparison flow: empty state, filters, detail, shared platter comparison, version blocking, delete', async () => {
  test.setTimeout(120_000);

  // 1. Empty collection.html has zero console errors, zero axe violations, and zero IndexedDB databases created.
  const emptyPageErrors: string[] = [];
  const emptyPage = h.probe;
  emptyPage.on('pageerror', (err) => emptyPageErrors.push(err.message));
  emptyPage.on('console', (msg) => {
    if (msg.type() === 'error') emptyPageErrors.push(msg.text());
  });
  await expect(emptyPage.getByTestId('collection-empty')).toBeVisible();
  expect(await emptyPage.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).toEqual([]);
  expect(await axeSeriousViolations(emptyPage)).toEqual([]);
  expect(emptyPageErrors).toEqual([]);

  // 2. Import 3 distinct specimens through the Side Panel, then click "Apri la Collezione a tutta scheda".
  const idA = '11111111-1111-4111-8111-111111111111';
  const idB = '22222222-2222-4222-8222-222222222222';
  const idC = '33333333-3333-4333-8333-333333333333';

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
        title: 'Esemplare Ciano',
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
        title: 'Esemplare Zaffiro',
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

  const [collectionPage] = await Promise.all([
    h.context.waitForEvent('page'),
    h.inSidePanel(`(() => { ${q('shell-open-collection')}.click(); return true; })()`),
  ]);
  const colErrors: string[] = [];
  collectionPage.on('pageerror', (err) => colErrors.push(err.message));
  collectionPage.on('console', (msg) => {
    if (msg.type() === 'error') colErrors.push(msg.text());
  });

  await collectionPage.waitForLoadState('load');
  await expect(collectionPage.getByTestId('collection-card')).toHaveCount(3, { timeout: 30_000 });
  expect(await axeSeriousViolations(collectionPage)).toEqual([]);

  // 3. Test filters: habit, color, source, date, and reset.
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
  await expect(collectionPage.getByTestId('collection-card').first()).toContainText('Esemplare Zaffiro');

  await collectionPage.getByTestId('filter-reset').click();
  await collectionPage.getByTestId('filter-date-from').fill('2026-11-11');
  await collectionPage.getByTestId('filter-date-to').fill('2026-11-13');
  await expect(collectionPage.getByTestId('collection-card')).toHaveCount(1);
  await expect(collectionPage.getByTestId('collection-card').first()).toContainText('Esemplare Ciano');

  await collectionPage.getByTestId('filter-reset').click();
  await expect(collectionPage.getByTestId('collection-card')).toHaveCount(3);

  // 4. Open specimen detail and close it cleanly.
  const cardA = collectionPage.locator(`[data-testid="collection-card"][data-specimen-id="${idA}"]`);
  await cardA.getByTestId('open-specimen').click();
  await expect(collectionPage.getByTestId('collection-detail')).toBeVisible({ timeout: 30_000 });
  await expect(collectionPage.getByTestId('collection-detail-stage')).toBeVisible();
  await collectionPage.getByTestId('collection-detail-close').click();
  await expect(collectionPage.getByTestId('collection-detail')).toHaveCount(0);

  // 5. Select two compatible specimens (A & B) and open side-by-side Comparison.
  const cardB = collectionPage.locator(`[data-testid="collection-card"][data-specimen-id="${idB}"]`);
  await cardA.getByTestId('select-a').click();
  await cardB.getByTestId('select-b').click();
  await expect(collectionPage.getByTestId('start-comparison')).toBeEnabled();
  await collectionPage.getByTestId('start-comparison').click();

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
  await expect(collectionPage.getByTestId('comparison-technical-details')).toContainText('comparator-0-experimental');

  // 6. Test version mismatch blocking: incompatible mappingVersion and extractorVersion.
  await patchRecordVersion(collectionPage, idB, { mappingVersion: 'mapping-1' });
  await collectionPage.goto(`chrome-extension://${h.extensionId}/collection.html?a=${idA}&b=${idB}`);
  await expect(collectionPage.getByTestId('comparison-blocked')).toBeVisible({ timeout: 30_000 });
  await expect(collectionPage.getByTestId('comparison-blocked')).toHaveAttribute('data-reason', 'INCOMPATIBLE_MAPPING_VERSION');
  await expect(collectionPage.getByTestId('comparison-percentile-value')).toHaveCount(0);

  await patchRecordVersion(collectionPage, idB, {
    mappingVersion: 'mapping-0-experimental',
    extractorVersion: 'extractor-legacy',
  });
  await collectionPage.goto(`chrome-extension://${h.extensionId}/collection.html?a=${idA}&b=${idB}`);
  await expect(collectionPage.getByTestId('comparison-blocked')).toBeVisible({ timeout: 30_000 });
  await expect(collectionPage.getByTestId('comparison-blocked')).toHaveAttribute('data-reason', 'INCOMPATIBLE_EXTRACTOR_VERSION');
  await expect(collectionPage.getByTestId('comparison-percentile-value')).toHaveCount(0);

  // 7. Return to Collection and delete specimen C with inline confirmation.
  await collectionPage.getByTestId('comparison-back').click();
  await expect(collectionPage.getByTestId('collection-card')).toHaveCount(3);
  const cardC = collectionPage.locator(`[data-testid="collection-card"][data-specimen-id="${idC}"]`);
  await cardC.getByTestId('delete-specimen').click();
  await expect(cardC.getByTestId('collection-delete-confirm')).toBeVisible();
  await cardC.getByTestId('collection-delete-yes').click();
  await expect(collectionPage.getByTestId('collection-card')).toHaveCount(2);

  expect(colErrors).toEqual([]);
  await collectionPage.close();
});
