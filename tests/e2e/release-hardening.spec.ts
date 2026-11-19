// I-16 & Gate Release E2E: verifies zero runtime external network requests (R2),
// zero PCM/streamId/forbidden metadata in storage, IndexedDB or logs (R1,
// G0-TECH-01), full axe-core coverage including permission.html and the
// collection specimen detail drawer, and SBOM/NOTICES/no-YouTube packaging
// (G0-TECH-03, ADR-0031). Requires `pnpm build` and `pnpm fixtures`.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import axe from 'axe-core';
import type { CrystalRecordV1, CrystalSeed, GeometryVersion, VoiceCrystalExportV1 } from '../../packages/contracts/src/index.ts';
import { generateCrystalGeometry } from '../../packages/crystal-core/src/index.ts';
import { EXTENSION_PATH, ExtensionHarness, VIDEO_PAGE } from './harness.ts';

const FIXTURES = resolve(import.meta.dirname, '../fixtures');
const h = new ExtensionHarness();
let tmp = '';

const q = (testId: string): string => `document.querySelector('[data-testid="${testId}"]')`;
const click = (testId: string): string => `(() => { const el = ${q(testId)}; if (el === null || el.getClientRects().length === 0) return false; el.click(); return true; })()`;
const screen = (): Promise<unknown> => h.inSidePanel(`${q('shell-screen')}?.dataset.screen ?? ''`);
const phase = (): Promise<unknown> => h.inSidePanel(`${q('file-status')}?.dataset.phase ?? ''`);

const FORBIDDEN_KEYS = new Set([
  'url',
  'pageTitle',
  'videoId',
  'channel',
  'streamId',
  'pcm',
  'samples',
  'audioBuffer',
  'token',
  'transcript',
]);

const FORBIDDEN_LOG_MARKERS = ['streamId', 'Float32Array', 'youtube.com', 'watch?v='];

function isAllowedRuntimeUrl(rawUrl: string): boolean {
  return (
    rawUrl.startsWith('chrome-extension://') ||
    rawUrl.startsWith('blob:') ||
    rawUrl.startsWith('data:') ||
    rawUrl.startsWith('https://example.test/') ||
    rawUrl.startsWith('https://www.youtube.com/')
  );
}

function findForbiddenEntries(value: unknown, path = 'root', hits: string[] = []): string[] {
  if (Array.isArray(value)) {
    if (value.length >= 256 && value.every((item) => typeof item === 'number')) {
      hits.push(`large numeric array at ${path} (length ${String(value.length)})`);
      return hits;
    }
    value.forEach((item, index) => {
      findForbiddenEntries(item, `${path}[${String(index)}]`, hits);
    });
    return hits;
  }
  if (typeof value === 'string') {
    for (const marker of FORBIDDEN_LOG_MARKERS) {
      if (value.includes(marker)) {
        hits.push(`forbidden marker "${marker}" at ${path}`);
      }
    }
    return hits;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      const nextPath = `${path}.${key}`;
      if (FORBIDDEN_KEYS.has(key)) {
        hits.push(`forbidden key ${nextPath}`);
      }
      findForbiddenEntries(nested, nextPath, hits);
    }
  }
  return hits;
}

function collectDistFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectDistFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
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

function buildRecord(
  id: string,
  specimenNumber: number,
  seed: CrystalSeed,
  versions: { extractorVersion: string; mappingVersion: string; geometryVersion: GeometryVersion; comparatorVersion: string },
): CrystalRecordV1 {
  const confidence = [1, 1, 1, 1, 1, 1] as const;
  const geom = generateCrystalGeometry(seed, confidence, versions.geometryVersion);
  return {
    id,
    specimenNumber,
    schemaVersion: 1,
    createdAt: '2026-11-17T12:00:00.000Z',
    title: 'Esemplare di confronto',
    speakerLabel: null,
    source: { kind: 'mic' },
    seed,
    confidence,
    rawMeasures: [7.5, 2.8, 13.5, 0.14, 10.4, 4.2],
    extractorVersion: versions.extractorVersion,
    mappingVersion: versions.mappingVersion,
    geometryVersion: versions.geometryVersion,
    comparatorVersion: versions.comparatorVersion,
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
  };
}

test.beforeAll(async () => {
  if (!existsSync(join(FIXTURES, 'voice-a-long.wav'))) {
    throw new Error('missing fixtures (run `pnpm fixtures` first)');
  }
  tmp = mkdtempSync(join(tmpdir(), 'voicecrystal-release-e2e-'));
  await h.launch();
});

test.afterAll(async () => {
  await h.close();
  rmSync(tmp, { recursive: true, force: true });
});

test('Release hardening: zero network calls, zero PCM/metadata persisted, full axe-core coverage, and SBOM/G0-TECH-03 bundle checks', async () => {
  test.setTimeout(120_000);

  const observedRequests: string[] = [];
  const extensionErrors: string[] = [];
  const allConsoleLogs: string[] = [];

  h.context.on('request', (req) => {
    observedRequests.push(req.url());
  });

  const attachLogListeners = (target: Page, recordErrors: boolean): void => {
    target.on('pageerror', (err) => {
      if (recordErrors) extensionErrors.push(`pageerror(${target.url()}): ${err.message}`);
    });
    target.on('console', (msg: ConsoleMessage) => {
      const txt = msg.text();
      allConsoleLogs.push(txt);
      if (recordErrors && msg.type() === 'error') {
        extensionErrors.push(`console.error(${target.url()}): ${txt}`);
      }
    });
  };

  attachLogListeners(h.probe, true);
  h.context.on('page', (p) => {
    attachLogListeners(p, true);
  });
  const sw = await h.worker();
  sw.on('console', (msg) => {
    const txt = msg.text();
    allConsoleLogs.push(txt);
    if (msg.type() === 'error') {
      extensionErrors.push(`sw.error: ${txt}`);
    }
  });

  // 1. G0-TECH-03 on-demand tab capture on generic HTTPS page (non-YouTube host), then clean stop.
  await h.context.route('https://example.test/release-video', (route) =>
    route.fulfill({ contentType: 'text/html', body: VIDEO_PAGE }),
  );
  await h.context.route('https://example.test/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));

  const videoPage = await h.openWatch('https://example.test/release-video');
  const seenBeforeTab = await h.seenSessions();
  await h.clickAction(videoPage);
  const tabDiag = await h.waitForSession('LISTENING', seenBeforeTab);
  expect(tabDiag.sampleRate).toBeGreaterThan(0);
  await videoPage.waitForTimeout(500);
  await expect.poll(screen).toBe('LIVE');
  expect(await h.inSidePanel(click('shell-stop'))).toBe(true);
  expect(await h.waitForEnd(tabDiag.sessionId)).toMatchObject({ state: 'INTERRUPTED', exitReason: 'USER_STOP' });
  await expect.poll(() => h.offscreenCount(), { timeout: 10_000 }).toBe(0);

  // 2. Return to Home in the active panel to check the notices and accessibility.
  await expect.poll(screen).toBe('OUTCOME');
  expect(await h.inSidePanel(click('shell-back'))).toBe(true);
  await expect.poll(screen).toBe('HOME');
  await expect.poll(() => h.inSidePanel(`${q('shell-notice-toggle')} !== null`), { timeout: 15_000 }).toBe(true);
  expect(await h.inSidePanel(click('shell-notice-toggle'))).toBe(true);
  expect(await h.inSidePanel(click('shell-licenses'))).toBe(true);
  await expect.poll(() => h.inSidePanel(`${q('shell-licenses')}?.getAttribute('aria-expanded')`)).toBe('true');

  const noticesHref = await h.inSidePanel(
    `(() => { const link = document.querySelector('.vc-licenses a[href="THIRD_PARTY/NOTICES.txt"]'); return link?.getClientRects().length > 0 ? link.getAttribute('href') : ''; })()`,
  );
  expect(noticesHref).toBe('THIRD_PARTY/NOTICES.txt');

  const noticesCheck = await h.probe.evaluate(async () => {
    const res = await fetch(chrome.runtime.getURL('THIRD_PARTY/NOTICES.txt'));
    return { ok: res.ok, status: res.status, text: await res.text() };
  });
  expect(noticesCheck.ok).toBe(true);
  expect(noticesCheck.status).toBe(200);
  expect(noticesCheck.text).toContain('VoiceCrystal');
  expect(noticesCheck.text).toContain('three');
  expect(noticesCheck.text).toContain('libfvad');
  expect(noticesCheck.text).toContain('@fontsource/spectral');
  expect(noticesCheck.text).toContain('@fontsource/ibm-plex-mono');
  expect(noticesCheck.text).toContain('OFL-1.1');
  expect(noticesCheck.text).toContain('SPDX');

  expect(await h.axeSidePanel()).toEqual([]);

  // 3. Analyze a file in the same panel, then save and export.
  expect(await h.inSidePanel(click('shell-source-file'))).toBe(true);
  await h.setPanelFile('file-input', join(FIXTURES, 'voice-a-long.wav'));
  await expect.poll(phase, { timeout: 15_000 }).toBe('ready');
  expect(await h.inSidePanel(click('file-analyze'))).toBe(true);
  await expect.poll(screen, { timeout: 30_000 }).toBe('REVEALED');

  expect(await h.inSidePanel(click('shell-save'))).toBe(true);
  await expect.poll(() => h.inSidePanel(`${q('shell-specimen-name')}?.textContent ?? ''`), { timeout: 15_000 }).toBe('Esemplare VC-0001');

  expect(await h.inSidePanel(click('shell-label-details-summary'))).toBe(true);
  expect(await h.inSidePanel(click('shell-legend-details-summary'))).toBe(true);
  expect(await h.inSidePanel(click('shell-reveal-tools-summary'))).toBe(true);
  expect(await h.axeSidePanel()).toEqual([]);
  expect(await h.inSidePanel(click('shell-export-svg'))).toBe(true);
  const hasWebglCanvas = (await h.inSidePanel(`${q('shell-showcase')}?.querySelector('canvas') !== null`)) === true;
  if (hasWebglCanvas) {
    let lastProfile = String(await h.inSidePanel(`${q('shell-showcase')}?.dataset.profileReason ?? ''`));
    expect(await h.inSidePanel(click('shell-export-png'))).toBe(true);
    await expect
      .poll(
        async () => {
          const currentProfile = String(await h.inSidePanel(`${q('shell-showcase')}?.dataset.profileReason ?? ''`));
          if (currentProfile !== lastProfile) {
            lastProfile = currentProfile;
            await h.inSidePanel(click('shell-export-png'));
          }
          return Number(await h.inSidePanel(`Number(${q('shell-export-png')}?.dataset.lastPngSize ?? '0')`));
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(1000);
  }

  expect(await h.inSidePanel(click('shell-discard'))).toBe(true);
  await expect.poll(screen).toBe('HOME');
  await expect.poll(() => h.inSidePanel(`document.querySelectorAll('[data-testid="shell-recent-item"]').length`)).toBe(1);
  expect(await h.inSidePanel(click('shell-archive-toggle'))).toBe(true);
  expect(await h.inSidePanel(click('shell-export-json'))).toBe(true);
  await expect.poll(() => h.inSidePanel(`${q('shell-export-json')}?.dataset.lastExportJson ?? ''`)).not.toBe('');

  // 4. Inspect chrome.storage (session & local) and IndexedDB voicecrystal for zero PCM/streamId/forbidden metadata.
  const storageSnapshot = await h.probe.evaluate(async () => ({
    session: await chrome.storage.session.get(null),
    local: await chrome.storage.local.get(null),
  }));
  expect(storageSnapshot.session['activeSession']).toBeUndefined();
  expect(storageSnapshot.local).toEqual({});
  expect(findForbiddenEntries(storageSnapshot)).toEqual([]);

  const idbSnapshot = await h.probe.evaluate(
    () =>
      new Promise<{
        stores: string[];
        indexes: string[];
        crystals: Record<string, unknown>[];
        settings: unknown[];
        thumbnailsMeta: { isBlob: boolean; type: string; size: number }[];
      }>((resolvePromise, rejectPromise) => {
        const req = indexedDB.open('voicecrystal');
        req.onerror = () => {
          rejectPromise(req.error ?? new Error('indexedDB open failed'));
        };
        req.onsuccess = () => {
          const db = req.result;
          const stores = Array.from(db.objectStoreNames).sort();
          const tx = db.transaction(['crystals', 'thumbnails', 'settings'], 'readonly');
          const cStore = tx.objectStore('crystals');
          const indexes = Array.from(cStore.indexNames).sort();
          const gCrystals = cStore.getAll();
          const gThumbs = tx.objectStore('thumbnails').getAll();
          const gSettings = tx.objectStore('settings').getAll();
          tx.oncomplete = () => {
            db.close();
            const thumbnailsMeta = (gThumbs.result as unknown[]).map((entry) =>
              entry instanceof Blob
                ? { isBlob: true, type: entry.type, size: entry.size }
                : { isBlob: false, type: '', size: 0 },
            );
            resolvePromise({
              stores,
              indexes,
              crystals: gCrystals.result as Record<string, unknown>[],
              settings: gSettings.result as unknown[],
              thumbnailsMeta,
            });
          };
          tx.onerror = () => {
            rejectPromise(tx.error ?? new Error('indexedDB tx failed'));
          };
        };
      }),
  );

  expect(idbSnapshot.stores).toEqual(['crystals', 'settings', 'thumbnails']);
  expect(idbSnapshot.indexes).toEqual(['createdAt', 'mappingVersion', 'sourceKind']);
  expect(idbSnapshot.crystals).toHaveLength(1);
  expect(findForbiddenEntries(idbSnapshot.crystals)).toEqual([]);
  expect(findForbiddenEntries(idbSnapshot.settings)).toEqual([]);
  for (const thumb of idbSnapshot.thumbnailsMeta) {
    expect(thumb.isBlob).toBe(true);
    expect(thumb.type).toBe('image/webp');
    expect(thumb.size).toBeGreaterThan(0);
  }

  // Import a compatible second specimen so Comparison A/B can be exercised cleanly.
  const firstRecord = idbSnapshot.crystals[0];
  if (firstRecord === undefined) throw new Error('expected saved VC-0001 record in IndexedDB');
  const firstId = firstRecord['id'];
  if (typeof firstId !== 'string') throw new Error('expected a saved specimen ID');
  const secondId = '44444444-4444-4444-8444-444444444444';
  const firstGeomVersion = firstRecord['geometryVersion'];
  if (firstGeomVersion !== 'habit-1') {
    throw new Error(`unexpected geometryVersion: ${String(firstGeomVersion)}`);
  }
  const exportPayload: VoiceCrystalExportV1 = {
    format: 'voicecrystal-export',
    version: 1,
    exportedAt: '2026-11-17T12:05:00.000Z',
    records: [
      buildRecord(secondId, 2, [6200, 5800, 5200, 1800, 7800, 4100], {
        extractorVersion: String(firstRecord['extractorVersion']),
        mappingVersion: String(firstRecord['mappingVersion']),
        geometryVersion: firstGeomVersion,
        comparatorVersion: String(firstRecord['comparatorVersion']),
      }),
    ],
  };
  const backupPath = join(tmp, 'second-specimen.json');
  writeFileSync(backupPath, JSON.stringify(exportPayload));
  await h.setPanelFile('shell-import-input', backupPath);
  await expect.poll(() => h.inSidePanel(`${q('shell-archive-status')}?.hidden ?? true`), { timeout: 15_000 }).toBe(false);

  // 5. Check accessibility in the archive, specimen detail and comparison.
  const [collectionPage] = await Promise.all([
    h.context.waitForEvent('page'),
    h.inSidePanel(`(() => { ${q('shell-open-collection')}.click(); return true; })()`),
  ]);
  await collectionPage.waitForLoadState('load');
  await expect(collectionPage.getByTestId('collection-card')).toHaveCount(2, { timeout: 30_000 });
  expect(await axeSeriousViolations(collectionPage)).toEqual([]);

  await collectionPage.getByTestId('collection-card').first().getByTestId('open-specimen').click();
  await expect(collectionPage.getByTestId('collection-detail')).toBeVisible({ timeout: 30_000 });
  await expect(collectionPage.getByTestId('collection-detail-stage')).toBeVisible();
  expect(await axeSeriousViolations(collectionPage)).toEqual([]);
  await collectionPage.getByTestId('collection-detail-close').click();
  await expect(collectionPage.getByTestId('collection-detail')).toHaveCount(0);

  const comparisonUrl = new URL(collectionPage.url());
  comparisonUrl.search = new URLSearchParams({ a: firstId, b: secondId }).toString();
  await collectionPage.goto(comparisonUrl.toString());
  await expect(collectionPage.getByTestId('comparison-view')).toBeVisible({ timeout: 30_000 });
  await expect(collectionPage.getByTestId('comparison-percentile-value')).toBeVisible();
  expect(await axeSeriousViolations(collectionPage)).toEqual([]);
  await collectionPage.close();

  // 6. Open permission.html and verify axe-core has zero serious or critical violations.
  const permissionPage = await h.context.newPage();
  await permissionPage.goto(`chrome-extension://${h.extensionId}/permission.html`);
  await expect(permissionPage.getByTestId('permission-allow')).toBeVisible();
  await expect(permissionPage.getByTestId('permission-status')).toHaveAttribute('data-outcome', 'idle');
  expect(await axeSeriousViolations(permissionPage)).toEqual([]);
  await permissionPage.close();
  await videoPage.close();

  // 7. Runtime network requests (R2), console errors/privacy (R1), and built bundle checks (G0-TECH-03).
  const unexpectedRequests = observedRequests.filter((url) => !isAllowedRuntimeUrl(url));
  expect(unexpectedRequests).toEqual([]);
  expect(extensionErrors).toEqual([]);
  for (const logText of allConsoleLogs) {
    for (const marker of FORBIDDEN_LOG_MARKERS) {
      expect(logText).not.toContain(marker);
    }
  }

  expect(existsSync(join(EXTENSION_PATH, 'THIRD_PARTY/NOTICES.txt'))).toBe(true);
  const manifestRaw = readFileSync(join(EXTENSION_PATH, 'manifest.json'), 'utf8');
  const manifestJson = JSON.parse(manifestRaw) as {
    permissions?: string[];
    content_scripts?: unknown;
  };
  expect(manifestJson.content_scripts).toBeUndefined();
  expect(manifestJson.permissions).toContain('activeTab');
  expect(manifestJson.permissions).toContain('scripting');
  expect(manifestRaw).not.toMatch(/youtube/i);

  const distTextExts = ['.js', '.html', '.css', '.json'];
  const leakedYoutubeFiles: string[] = [];
  for (const file of collectDistFiles(EXTENSION_PATH)) {
    if (!distTextExts.some((ext) => file.endsWith(ext))) continue;
    const stripped = readFileSync(file, 'utf8').replaceAll('NOT_YOUTUBE_WATCH', '');
    if (/youtube/i.test(stripped)) {
      leakedYoutubeFiles.push(relative(EXTENSION_PATH, file));
    }
  }
  expect(leakedYoutubeFiles).toEqual([]);
});
