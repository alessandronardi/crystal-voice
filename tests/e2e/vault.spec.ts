// I-14 E2E: local IndexedDB vault, PNG 1024x1024 export, thumbnails, tamper checks,
// VC-20 warning, G0-TECH-02 JSON export/import, and hostile payload rejection.
// Requires `pnpm build` and `pnpm fixtures`.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ExtensionHarness, OTHER_URL } from './harness.ts';

const FIXTURES = resolve(import.meta.dirname, '../fixtures');
const h = new ExtensionHarness();
let panelTab: Page;
let tmp: string;

test.describe.configure({ mode: 'serial' });

const q = (testId: string): string => `document.querySelector('[data-testid="${testId}"]')`;
const click = (testId: string): string => `(() => { const el = ${q(testId)}; if (el === null) return false; el.click(); return true; })()`;
const screen = (): Promise<unknown> => h.inSidePanel(`${q('shell-screen')}?.dataset.screen ?? ''`);
const phase = (): Promise<unknown> => h.inSidePanel(`${q('file-status')}?.dataset.phase ?? ''`);

async function setInput(testId: string, value: string): Promise<void> {
  const ok = await h.inSidePanel(
    `(() => { const el = ${q(testId)}; if (!(el instanceof HTMLInputElement)) return false; el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
  );
  expect(ok).toBe(true);
}

test.beforeAll(async () => {
  if (!existsSync(join(FIXTURES, 'voice-a-long.wav'))) {
    throw new Error('missing fixtures (run `pnpm fixtures` first)');
  }
  tmp = mkdtempSync(join(tmpdir(), 'voicecrystal-vault-e2e-'));
  await h.launch();
  panelTab = await h.context.newPage();
  await panelTab.goto(OTHER_URL);
  await h.clickAction(panelTab);
  await expect.poll(() => h.inSidePanel(`${q('file-input')} !== null`)).toBe(true);
});

test.afterAll(async () => {
  await h.close();
  rmSync(tmp, { recursive: true, force: true });
});

test('I-14 full vault flow: save, IndexedDB schema, PNG export, reopen, tamper rejection, export/import, delete', async () => {
  test.setTimeout(120_000);

  // 1. Fresh Home: no IndexedDB created on read-only startup, zero serious axe violations.
  await expect.poll(screen).toBe('HOME');
  expect(await h.probe.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).toEqual([]);
  expect(await h.axeSidePanel()).toEqual([]);

  // 2. Analyze voice-a-long.wav -> REVEALED -> axe check -> save with title + speakerLabel.
  await h.setPanelFile('file-input', join(FIXTURES, 'voice-a-long.wav'));
  await expect.poll(phase, { timeout: 15_000 }).toBe('ready');
  expect(await h.inSidePanel(click('file-analyze'))).toBe(true);
  await expect.poll(screen, { timeout: 30_000 }).toBe('REVEALED');
  expect(await h.axeSidePanel()).toEqual([]);

  await setInput('shell-title-input', 'Voce di archivio');
  await setInput('shell-speaker-input', 'Parlante Prova');
  expect(await h.inSidePanel(click('shell-save'))).toBe(true);
  await expect.poll(() => h.inSidePanel(`${q('shell-specimen-name')}?.textContent ?? ''`), { timeout: 15_000 }).toBe('Esemplare VC-0001');
  expect(await h.inSidePanel(`${q('shell-save')}?.disabled`)).toBe(true);
  expect(String(await h.inSidePanel(`${q('shell-label')}?.textContent ?? ''`))).toContain('Voce di archivio');
  expect(String(await h.inSidePanel(`${q('shell-label')}?.textContent ?? ''`))).toContain('Parlante Prova');

  // Inspect IndexedDB schema and saved record directly (no videoId index, no forbidden metadata).
  const idbCheck = await h.probe.evaluate(
    () =>
      new Promise<{ stores: string[]; indexes: string[]; records: Record<string, unknown>[]; thumbCount: number }>((resolve, reject) => {
        const req = indexedDB.open('voicecrystal');
        req.onerror = () => {
          reject(req.error ?? new Error('indexedDB open failed'));
        };
        req.onsuccess = () => {
          const db = req.result;
          const stores = Array.from(db.objectStoreNames).sort();
          const tx = db.transaction(['crystals', 'thumbnails'], 'readonly');
          const cStore = tx.objectStore('crystals');
          const indexes = Array.from(cStore.indexNames).sort();
          const gAll = cStore.getAll();
          const tCount = tx.objectStore('thumbnails').count();
          tx.oncomplete = () => {
            db.close();
            resolve({ stores, indexes, records: gAll.result as Record<string, unknown>[], thumbCount: tCount.result });
          };
          tx.onerror = () => {
            reject(tx.error ?? new Error('indexedDB tx failed'));
          };
        };
      }),
  );

  expect(idbCheck.stores).toEqual(['crystals', 'settings', 'thumbnails']);
  expect(idbCheck.indexes).toEqual(['createdAt', 'mappingVersion', 'sourceKind']);
  expect(idbCheck.indexes).not.toContain('videoId');
  expect(idbCheck.records).toHaveLength(1);
  expect(idbCheck.records[0]?.['specimenNumber']).toBe(1);
  expect(idbCheck.records[0]?.['title']).toBe('Voce di archivio');
  expect(idbCheck.records[0]?.['speakerLabel']).toBe('Parlante Prova');
  expect(idbCheck.records[0]?.['source']).toMatchObject({ kind: 'file', fileName: 'voice-a-long.wav' });

  // 3. Export PNG 1024x1024 when WebGL is active (renders valid PNG > 1000 bytes).
  const hasWebglCanvas = (await h.inSidePanel(`${q('shell-showcase')}?.querySelector('canvas') !== null`)) === true;
  test.info().annotations.push({
    type: 'vault e2e',
    description: JSON.stringify({ hasWebglCanvas, thumbCount: idbCheck.thumbCount, stores: idbCheck.stores, indexes: idbCheck.indexes }),
  });
  if (hasWebglCanvas) {
    expect(idbCheck.thumbCount).toBe(1);
    expect(await h.inSidePanel(`${q('shell-export-png')}?.disabled`)).toBe(false);
    expect(await h.inSidePanel(click('shell-export-png'))).toBe(true);
    await expect.poll(() => h.inSidePanel(`Number(${q('shell-export-png')}?.dataset.lastPngSize ?? '0')`), { timeout: 15_000 }).toBeGreaterThan(1000);
  }

  // 4. Return Home: recent list shows VC-0001, VC-20 warning visible, axe clean, reopen restores REVEALED.
  expect(await h.inSidePanel(click('shell-discard'))).toBe(true);
  await expect.poll(screen).toBe('HOME');
  await expect.poll(() => h.inSidePanel(`document.querySelectorAll('[data-testid="shell-recent-item"]').length`)).toBe(1);
  expect(String(await h.inSidePanel(`${q('shell-recent')}?.textContent ?? ''`))).toContain('Esemplare VC-0001');
  expect(await h.inSidePanel(`${q('shell-vc20-warning')}?.hidden`)).toBe(false);
  expect(await h.axeSidePanel()).toEqual([]);

  expect(await h.inSidePanel(click('shell-recent-open'))).toBe(true);
  await expect.poll(screen).toBe('REVEALED');
  expect(await h.inSidePanel(`${q('shell-specimen-name')}?.textContent ?? ''`)).toBe('Esemplare VC-0001');

  // 5. Tamper geometryHash in IndexedDB -> opening refuses with visible GEOMETRY_HASH_MISMATCH alert.
  const originalHash = String(idbCheck.records[0]?.['geometryHash']);
  const recordId = String(idbCheck.records[0]?.['id']);
  const setGeometryHash = async (id: string, hash: string): Promise<void> => {
    await h.probe.evaluate(
      ([targetId, nextHash]) =>
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
              rec['geometryHash'] = nextHash;
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
      [id, hash] as const,
    );
  };
  await setGeometryHash(recordId, 'f'.repeat(64));
  expect(await h.inSidePanel(click('shell-discard'))).toBe(true);
  await expect.poll(screen).toBe('HOME');
  await expect.poll(() => h.inSidePanel(`document.querySelectorAll('[data-testid="shell-recent-item"]').length`)).toBe(1);
  expect(await h.inSidePanel(click('shell-recent-open'))).toBe(true);
  await expect.poll(() => h.inSidePanel(`${q('shell-vault-error')}?.hidden`)).toBe(false);
  expect(await h.inSidePanel(`${q('shell-vault-error')}?.dataset.code ?? ''`)).toBe('GEOMETRY_HASH_MISMATCH');
  expect(await screen()).toBe('HOME');

  // Restore valid geometryHash.
  await setGeometryHash(recordId, originalHash);

  // 6. Export JSON: default omits title/speakerLabel/tags; opt-in includes them.
  expect(await h.inSidePanel(`${q('shell-export-labels')}?.checked`)).toBe(false);
  expect(await h.inSidePanel(click('shell-export-json'))).toBe(true);
  await expect.poll(() => h.inSidePanel(`${q('shell-export-json')}?.dataset.lastExportJson ?? ''`)).not.toBe('');
  const defaultExport = JSON.parse(String(await h.inSidePanel(`${q('shell-export-json')}?.dataset.lastExportJson ?? ''`))) as {
    format: string;
    version: number;
    records: Record<string, unknown>[];
  };
  expect(defaultExport.format).toBe('voicecrystal-export');
  expect(defaultExport.version).toBe(1);
  expect(defaultExport.records).toHaveLength(1);
  expect(defaultExport.records[0]?.['title']).toBe('');
  expect(defaultExport.records[0]?.['speakerLabel']).toBeNull();
  expect(defaultExport.records[0]?.['tags']).toEqual([]);

  // Opt-in export with manual labels enabled.
  expect(
    await h.inSidePanel(
      `(() => { const el = ${q('shell-export-labels')}; el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); ${q('shell-export-json')}.dataset.lastExportJson = ''; return true; })()`,
    ),
  ).toBe(true);
  expect(await h.inSidePanel(click('shell-export-json'))).toBe(true);
  await expect.poll(() => h.inSidePanel(`${q('shell-export-json')}?.dataset.lastExportJson ?? ''`)).not.toBe('');
  const labeledExportJson = String(await h.inSidePanel(`${q('shell-export-json')}?.dataset.lastExportJson ?? ''`));
  const labeledExport = JSON.parse(labeledExportJson) as { records: Record<string, unknown>[] };
  expect(labeledExport.records[0]?.['title']).toBe('Voce di archivio');
  expect(labeledExport.records[0]?.['speakerLabel']).toBe('Parlante Prova');

  const backupPath = join(tmp, 'backup-with-labels.json');
  writeFileSync(backupPath, labeledExportJson);

  // 7. Delete specimen with inline confirmation -> empty list and VC-20 warning hides once unchecked.
  expect(await h.inSidePanel(click('shell-recent-delete'))).toBe(true);
  await expect.poll(() => h.inSidePanel(`${q('shell-delete-confirm')} !== null`)).toBe(true);
  expect(await h.inSidePanel(click('shell-delete-yes'))).toBe(true);
  await expect.poll(() => h.inSidePanel(`document.querySelectorAll('[data-testid="shell-recent-item"]').length`)).toBe(0);
  expect(
    await h.inSidePanel(
      `(() => { const el = ${q('shell-export-labels')}; el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
    ),
  ).toBe(true);
  await expect.poll(() => h.inSidePanel(`${q('shell-vc20-warning')}?.hidden`)).toBe(true);

  // 8. Import backup -> 1 imported; re-import same backup -> duplicate ignored; hostile JSON rejected.
  await h.setPanelFile('shell-import-input', backupPath);
  await expect.poll(() => h.inSidePanel(`${q('shell-archive-status')}?.hidden`)).toBe(false);
  expect(String(await h.inSidePanel(`${q('shell-archive-status')}?.textContent ?? ''`))).toContain('Importati 1 nuovi esemplari (0 duplicati');
  await expect.poll(() => h.inSidePanel(`document.querySelectorAll('[data-testid="shell-recent-item"]').length`)).toBe(1);

  await h.setPanelFile('shell-import-input', backupPath);
  await expect.poll(() => h.inSidePanel(`${q('shell-archive-status')}?.textContent ?? ''`)).toContain('Importati 0 nuovi esemplari (1 duplicati');
  expect(await h.inSidePanel(`document.querySelectorAll('[data-testid="shell-recent-item"]').length`)).toBe(1);

  const hostileProtoPath = join(tmp, 'hostile-proto.json');
  writeFileSync(
    hostileProtoPath,
    '{"format":"voicecrystal-export","version":1,"exportedAt":"2026-11-14T10:00:00Z","records":[],"__proto__":{"polluted":true}}',
  );
  await h.setPanelFile('shell-import-input', hostileProtoPath);
  await expect.poll(() => h.inSidePanel(`${q('shell-vault-error')}?.hidden`)).toBe(false);
  expect(await h.inSidePanel(`${q('shell-vault-error')}?.dataset.code ?? ''`)).toBe('INVALID_SCHEMA');

  const xssPayload = {
    ...labeledExport,
    records: labeledExport.records.map((r) => ({ ...r, id: '99999999-aaaa-4bbb-8ccc-000000000001', title: '<script>alert(1)</script>' })),
  };
  const hostileXssPath = join(tmp, 'hostile-xss.json');
  writeFileSync(hostileXssPath, JSON.stringify(xssPayload));
  await h.setPanelFile('shell-import-input', hostileXssPath);
  await expect.poll(() => h.inSidePanel(`${q('shell-vault-error')}?.hidden`)).toBe(false);
  expect(await h.inSidePanel(`${q('shell-vault-error')}?.dataset.code ?? ''`)).toBe('INVALID_SCHEMA');
});
