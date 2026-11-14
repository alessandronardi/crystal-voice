// Unit and integration tests for @voicecrystal/vault (SPEC §12, ADR-0029, G0-TECH-01/02, R17).
import {
  MAX_VAULT_IMPORT_BYTES,
  VAULT_EXPORT_FILENAME,
  VAULT_EXPORT_FORMAT,
  VAULT_STORAGE_WARNING_BYTES,
  VAULT_THOUSAND_RECORDS_TARGET_BYTES,
  type CaptureExitReason,
  type CrystalRecordV1,
  type CrystalSeed,
  type QualitySummary,
  type RawMeasureTuple,
  type SeedConfidence,
} from '@voicecrystal/contracts';
import { generateCrystalGeometry, MAX_TRIANGLES } from '@voicecrystal/crystal-core';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  deleteCrystal,
  estimateVaultStorage,
  exportVaultJson,
  hasAnySpeakerLabel,
  importVaultJson,
  listCrystals,
  openCrystal,
  openVaultDatabase,
  saveCrystal,
  STORE_CRYSTALS,
  STORE_SETTINGS,
  STORE_THUMBNAILS,
  VAULT_DB_NAME,
  VAULT_MIGRATIONS,
  vaultDatabaseExists,
  VaultError,
  type MigrationStep,
  type SaveCrystalInput,
} from '../src/index.ts';

const QUALITY: QualitySummary = {
  accepted: true,
  validSpeechMs: 18_000,
  pitchUsableFrames: 1200,
  vadSpeechFrames: 900,
  droppedFrames: 0,
  clippedFraction: 0,
  confidence: [1, 1, 1, 1, 1, 1],
  missingFeatureKeys: [],
  warnings: ['EXPERIMENTAL_MAPPING'],
};

const SEED_A: CrystalSeed = [3000, 6000, 9000, 9000, 2000, 8000];
const SEED_B: CrystalSeed = [4200, 5100, 7200, 3100, 6400, 5500];
const FULL_CONFIDENCE: SeedConfidence = [1, 1, 1, 1, 1, 1];
const RAW_MEASURES: RawMeasureTuple = [120.5, 2.86, 12.1, 0.21, 1450, 4.0];

function makeSaveInput(over: Partial<SaveCrystalInput> = {}): SaveCrystalInput {
  return {
    title: 'Voce di prova',
    speakerLabel: 'Parlante A',
    tags: ['studio', 'chiaro'],
    source: { kind: 'mic' },
    seed: SEED_A,
    confidence: FULL_CONFIDENCE,
    rawMeasures: RAW_MEASURES,
    extractorVersion: 'extractor-0-experimental',
    mappingVersion: 'mapping-0-experimental',
    geometryVersion: 'habit-1',
    comparatorVersion: 'comparator-0-experimental',
    captureExitReason: 'MAX_VALID_SPEECH' satisfies CaptureExitReason,
    quality: QUALITY,
    ...over,
  };
}

function makeDeps(idb = new IDBFactory(), opts: { thumbSize?: number; uuidSeqStart?: number } = {}) {
  let seq = opts.uuidSeqStart ?? 1;
  let clock = 0;
  const thumbPayload = new Uint8Array(opts.thumbSize ?? 3218).fill(0x52);
  return {
    idb,
    now: () => new Date(Date.UTC(2026, 10, 14, 10, 0, clock++)).toISOString(),
    uuid: () => {
      const hex = (seq++).toString(16).padStart(12, '0');
      return `11111111-2222-4333-8444-${hex}`;
    },
    renderThumbnail: () => Promise.resolve(new Blob([thumbPayload], { type: 'image/webp' })),
  };
}

async function expectVaultErrorCode(fn: () => Promise<unknown>, expectedCode: string): Promise<void> {
  try {
    await fn();
    expect.unreachable(`Expected VaultError(${expectedCode}) but resolved`);
  } catch (err) {
    expect(err).toBeInstanceOf(VaultError);
    expect((err as VaultError).code).toBe(expectedCode);
  }
}

describe('@voicecrystal/vault', () => {
  it('read-only operations never create the database when no crystal has been saved', async () => {
    const deps = makeDeps();
    expect(await vaultDatabaseExists(deps)).toBe(false);
    expect(await listCrystals({}, deps)).toEqual([]);
    expect(await openCrystal('11111111-2222-4333-8444-000000000001', deps)).toBeNull();
    expect(await deleteCrystal('11111111-2222-4333-8444-000000000001', deps)).toBe(false);
    expect(await hasAnySpeakerLabel(deps)).toBe(false);
    const exp = await exportVaultJson({}, deps);
    expect(exp.recordCount).toBe(0);
    expect(await deps.idb.databases()).toEqual([]);
    expect(VAULT_EXPORT_FILENAME).toBe('voicecrystal-export-v1.json');
  });

  it('creates v1 stores & indexes (no videoId index per ADR-0029) and supports atomic save/open/list/delete', async () => {
    const deps = makeDeps();

    // Save a tab source carrying extra legacy property via cast: stripped cleanly to { kind: 'tab' }.
    const dirtyTab = { kind: 'tab', videoId: 'dQw4w9WgXcQ', url: 'https://youtube.com/watch?v=x' } as unknown as {
      kind: 'tab';
    };
    const first = await saveCrystal(makeSaveInput({ source: dirtyTab, title: '  Prima   voce  ' }), deps);
    expect(first.record.specimenNumber).toBe(1);
    expect(first.record.title).toBe('Prima voce');
    expect(first.record.source).toEqual({ kind: 'tab' });
    expect(first.thumbnail).toBeInstanceOf(Blob);

    const fileSecond = await saveCrystal(
      makeSaveInput({
        seed: SEED_B,
        title: '',
        speakerLabel: null,
        source: { kind: 'file', fileName: 'voce-lunga.wav', durationSeconds: 32, offsetStartSeconds: 1, offsetEndSeconds: 25 },
      }),
      deps,
    );
    expect(fileSecond.record.specimenNumber).toBe(2);
    expect(fileSecond.record.source).toEqual({
      kind: 'file',
      fileName: 'voce-lunga.wav',
      durationSeconds: 32,
      offsetStartSeconds: 1,
      offsetEndSeconds: 25,
    });

    // Inspect IndexedDB structure directly.
    expect((await deps.idb.databases()).map((d) => d.name)).toEqual([VAULT_DB_NAME]);
    const db = await openVaultDatabase(deps);
    try {
      expect(Array.from(db.objectStoreNames).sort()).toEqual([STORE_CRYSTALS, STORE_SETTINGS, STORE_THUMBNAILS].sort());
      const tx = db.transaction([STORE_CRYSTALS], 'readonly');
      const indexNames = Array.from(tx.objectStore(STORE_CRYSTALS).indexNames).sort();
      expect(indexNames).toEqual(['createdAt', 'mappingVersion', 'sourceKind']);
      expect(indexNames).not.toContain('videoId');
    } finally {
      db.close();
    }

    // Ordering: newest createdAt first.
    const listed = await listCrystals({}, deps);
    expect(listed.map((i) => i.record.specimenNumber)).toEqual([2, 1]);
    expect(listed[0]?.thumbnail?.type).toBe('image/webp');

    // Open returns record, recomputed geometry, and thumbnail.
    const reopened = await openCrystal(first.record.id, deps);
    expect(reopened?.record).toEqual(first.record);
    expect(reopened?.geometry.geometryHash).toBe(first.record.geometryHash);
    expect(reopened?.thumbnail?.size).toBe(3218);

    // Delete first, save third: specimenNumber does not reuse #1.
    expect(await deleteCrystal(first.record.id, deps)).toBe(true);
    expect(await deleteCrystal(first.record.id, deps)).toBe(false);
    expect(await openCrystal(first.record.id, deps)).toBeNull();
    const third = await saveCrystal(makeSaveInput({ seed: SEED_B }), deps);
    expect(third.record.specimenNumber).toBe(3);
  });

  it('runs incremental migrations v0->v1, v1->v1, v1->v2 preserving data, and rejects unknown future version', async () => {
    const idb = new IDBFactory();
    const deps = makeDeps(idb);
    const saved = await saveCrystal(makeSaveInput(), deps);

    // Reopen at v1 preserves data.
    const reopened = await openCrystal(saved.record.id, deps);
    expect(reopened?.record.id).toBe(saved.record.id);

    // Migrate v1 -> v2 with custom step adding a tag index cleanly.
    const v2Migrations = new Map<number, MigrationStep>(VAULT_MIGRATIONS);
    v2Migrations.set(2, (_db, tx) => {
      const store = tx.objectStore(STORE_CRYSTALS);
      if (!store.indexNames.contains('schemaVersion')) {
        store.createIndex('schemaVersion', 'schemaVersion', { unique: false });
      }
    });
    const dbV2 = await openVaultDatabase({ idb, dbVersion: 2, migrations: v2Migrations });
    try {
      expect(dbV2.version).toBe(2);
      const tx = dbV2.transaction([STORE_CRYSTALS], 'readonly');
      expect(Array.from(tx.objectStore(STORE_CRYSTALS).indexNames)).toContain('schemaVersion');
    } finally {
      dbV2.close();
    }

    // Reopening v2 DB with v1 code rejects with UNSUPPORTED_VERSION cleanly.
    await expectVaultErrorCode(() => openVaultDatabase({ idb, dbVersion: 1 }), 'UNSUPPORTED_VERSION');

    // Opening a version with missing migration step rejects with UNSUPPORTED_VERSION.
    await expectVaultErrorCode(() => openVaultDatabase({ idb: new IDBFactory(), dbVersion: 99 }), 'UNSUPPORTED_VERSION');
  });

  it('detects geometryHash mismatch on open and on import without rendering corrupt crystal', async () => {
    const deps = makeDeps();
    const saved = await saveCrystal(makeSaveInput(), deps);

    // Tamper geometryHash directly in IndexedDB.
    const db = await openVaultDatabase(deps);
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_CRYSTALS], 'readwrite');
        const store = tx.objectStore(STORE_CRYSTALS);
        const getReq = store.get(saved.record.id);
        getReq.onsuccess = () => {
          const rec = getReq.result as CrystalRecordV1;
          rec.geometryHash = 'f'.repeat(64);
          store.put(rec);
        };
        tx.oncomplete = () => {
          resolve();
        };
        tx.onerror = () => {
          reject(tx.error ?? new Error('tx error'));
        };
      });
    } finally {
      db.close();
    }

    await expectVaultErrorCode(() => openCrystal(saved.record.id, deps), 'GEOMETRY_HASH_MISMATCH');

    // Tampered record inside JSON import is rejected before writing anything.
    const depsExport = makeDeps();
    await saveCrystal(makeSaveInput(), depsExport);
    const backup = JSON.parse((await exportVaultJson({ includeLabels: true }, depsExport)).json) as {
      records: { seed: number[] }[];
    };
    const firstBackup = backup.records[0];
    if (firstBackup) firstBackup.seed[0] = ((firstBackup.seed[0] ?? 0) + 500) % 10000;

    const targetDeps = makeDeps();
    await expectVaultErrorCode(() => importVaultJson(JSON.stringify(backup), targetDeps), 'GEOMETRY_HASH_MISMATCH');
    expect(await vaultDatabaseExists(targetDeps)).toBe(false);
  });

  it('rejects geometry exceeding renderer resource budget on open and on import (BUDGET_EXCEEDED)', async () => {
    const deps = makeDeps();
    const saved = await saveCrystal(makeSaveInput(), deps);
    const oversizedBudget = () => {
      const real = generateCrystalGeometry(SEED_A, FULL_CONFIDENCE, 'habit-1');
      const primary = real.bodies[0];
      const hugeFaces = new Uint16Array(MAX_TRIANGLES + 1);
      return {
        ...real,
        bodies: primary ? [{ ...primary, faceOfTriangle: hugeFaces }] : [],
      };
    };

    await expectVaultErrorCode(
      () => openCrystal(saved.record.id, { ...deps, verifyGeometryDeps: { generate: oversizedBudget } }),
      'BUDGET_EXCEEDED',
    );

    const backup = (await exportVaultJson({}, deps)).json;
    const targetDeps = makeDeps();
    await expectVaultErrorCode(
      () => importVaultJson(backup, { ...targetDeps, verifyGeometryDeps: { generate: oversizedBudget } }),
      'BUDGET_EXCEEDED',
    );
  });

  it('preserves existing records when QuotaExceededError occurs during save or import', async () => {
    const rawIdb = new IDBFactory();
    const baseDeps = makeDeps(rawIdb);
    const keep1 = await saveCrystal(makeSaveInput({ title: 'Primo intatto' }), baseDeps);
    const keep2 = await saveCrystal(makeSaveInput({ seed: SEED_B, title: 'Secondo intatto' }), baseDeps);

function wrapQuotaIdb(rawIdb: IDBFactory): IDBFactory {
  const bindProp = (target: object, prop: string | symbol, receiver: unknown): unknown => {
    const val: unknown = Reflect.get(target, prop, receiver);
    return typeof val === 'function' ? (val as (...a: unknown[]) => unknown).bind(target) : val;
  };
  return new Proxy(rawIdb, {
    get(target, prop, receiver): unknown {
      if (prop === 'open') {
        return (name: string, version?: number): IDBOpenDBRequest => {
          const req = target.open(name, version);
          const wrappedReq = new Proxy(req, {
            get(rTarget, rProp, rReceiver): unknown {
              if (rProp === 'result') {
                const db = rTarget.result;
                return new Proxy(db, {
                  get(dTarget, dProp, dReceiver): unknown {
                    if (dProp === 'transaction') {
                      return (storeNames: string | Iterable<string>, mode?: IDBTransactionMode): IDBTransaction => {
                        const tx = dTarget.transaction(storeNames, mode);
                        return new Proxy(tx, {
                          get(tTarget, tProp, tReceiver): unknown {
                            if (tProp === 'objectStore') {
                              return (storeName: string): IDBObjectStore => {
                                const store = tTarget.objectStore(storeName);
                                if (mode === 'readwrite' && storeName === STORE_CRYSTALS) {
                                  return new Proxy(store, {
                                    get(sTarget, sProp, sReceiver): unknown {
                                      if (sProp === 'add' || sProp === 'put') {
                                        return (): never => {
                                          throw new DOMException('Quota exceeded', 'QuotaExceededError');
                                        };
                                      }
                                      return bindProp(sTarget, sProp, sReceiver);
                                    },
                                  });
                                }
                                return store;
                              };
                            }
                            return bindProp(tTarget, tProp, tReceiver);
                          },
                        });
                      };
                    }
                    return bindProp(dTarget, dProp, dReceiver);
                  },
                });
              }
              return bindProp(rTarget, rProp, rReceiver);
            },
            set(rTarget, rProp, value, rReceiver) {
              if (rProp === 'onsuccess' && typeof value === 'function') {
                rTarget.onsuccess = (ev) => {
                  (value as (e: Event) => unknown).call(wrappedReq, ev);
                };
                return true;
              }
              return Reflect.set(rTarget, rProp, value, rReceiver);
            },
          });
          return wrappedReq;
        };
      }
      return bindProp(target, prop, receiver);
    },
  });
}
    const quotaIdb = wrapQuotaIdb(rawIdb);

    await expectVaultErrorCode(() => saveCrystal(makeSaveInput({ title: 'Oltre quota' }), { ...baseDeps, idb: quotaIdb }), 'QUOTA_EXCEEDED');

    // Prepare a fresh export from another DB and try importing under QuotaExceededError.
    const otherDeps = makeDeps(new IDBFactory(), { uuidSeqStart: 500 });
    await saveCrystal(makeSaveInput({ title: 'Da importare' }), otherDeps);
    const otherJson = (await exportVaultJson({ includeLabels: true }, otherDeps)).json;
    await expectVaultErrorCode(() => importVaultJson(otherJson, { ...baseDeps, idb: quotaIdb }), 'QUOTA_EXCEEDED');

    // Existing records must remain untouched.
    const surviving = await listCrystals({}, baseDeps);
    expect(surviving.map((s) => s.record.id)).toEqual([keep2.record.id, keep1.record.id]);
    expect(surviving.map((s) => s.record.title)).toEqual(['Secondo intatto', 'Primo intatto']);
  });

  it('rejects hostile JSON imports (>20MB, __proto__, HTML/script, unknown versions, YouTube metadata)', async () => {
    const srcDeps = makeDeps();
    await saveCrystal(makeSaveInput(), srcDeps);
    const validObj = JSON.parse((await exportVaultJson({ includeLabels: true }, srcDeps)).json) as Record<string, unknown>;
    const validJson = JSON.stringify(validObj);

    const targetDeps = makeDeps();

    // 1. Over 20 MB limit.
    const oversized = new Uint8Array(MAX_VAULT_IMPORT_BYTES + 1);
    await expectVaultErrorCode(() => importVaultJson(oversized, targetDeps), 'IMPORT_TOO_LARGE');

    // 2. Malformed JSON.
    await expectVaultErrorCode(() => importVaultJson('{"format":"voicecrystal-export"', targetDeps), 'INVALID_JSON');

    // 3. Prototype pollution keys.
    const protoPayload = `{"format":"${VAULT_EXPORT_FORMAT}","version":1,"exportedAt":"2026-11-14T10:00:00Z","records":[],"__proto__":{"polluted":true}}`;
    await expectVaultErrorCode(() => importVaultJson(protoPayload, targetDeps), 'INVALID_SCHEMA');
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();

    // 4. HTML / <script> injection in textual fields & oversized strings.
    for (const mutate of [
      (r: CrystalRecordV1) => {
        r.title = '<script>alert(1)</script>';
      },
      (r: CrystalRecordV1) => {
        r.speakerLabel = '<img src=x onerror=alert(1)>';
      },
      (r: CrystalRecordV1) => {
        r.tags = ['<b>tag</b>'];
      },
      (r: CrystalRecordV1) => {
        r.source = { kind: 'file', fileName: '<svg>.wav', durationSeconds: 20, offsetStartSeconds: 0, offsetEndSeconds: 18 };
      },
      (r: CrystalRecordV1) => {
        r.title = 'a'.repeat(201);
      },
      (r: CrystalRecordV1) => {
        r.speakerLabel = 'b'.repeat(121);
      },
    ]) {
      const clone = JSON.parse(validJson) as { records: CrystalRecordV1[] };
      if (clone.records[0]) mutate(clone.records[0]);
      await expectVaultErrorCode(() => importVaultJson(JSON.stringify(clone), targetDeps), 'INVALID_SCHEMA');
    }

    // 5. Forbidden YouTube source fields (G0-TECH-01 / ADR-0029).
    for (const badSource of [
      { kind: 'tab', videoId: 'dQw4w9WgXcQ' },
      { kind: 'tab', platform: 'youtube' },
      { kind: 'tab', url: 'https://www.youtube.com/watch?v=123' },
    ]) {
      const clone = JSON.parse(validJson) as { records: Record<string, unknown>[] };
      if (clone.records[0]) clone.records[0]['source'] = badSource;
      await expectVaultErrorCode(() => importVaultJson(JSON.stringify(clone), targetDeps), 'INVALID_SCHEMA');
    }

    // 6. Unknown future version / schemaVersion.
    const v2Export = { ...validObj, version: 2 };
    await expectVaultErrorCode(() => importVaultJson(JSON.stringify(v2Export), targetDeps), 'UNSUPPORTED_VERSION');

    const v2RecordClone = JSON.parse(validJson) as { records: Record<string, unknown>[] };
    if (v2RecordClone.records[0]) v2RecordClone.records[0]['schemaVersion'] = 2;
    await expectVaultErrorCode(() => importVaultJson(JSON.stringify(v2RecordClone), targetDeps), 'UNSUPPORTED_VERSION');

    // Target vault remains empty / uncreated.
    expect(await vaultDatabaseExists(targetDeps)).toBe(false);
  });

  it('omits manual labels by default in JSON export (G0-TECH-02), supports opt-in, and deduplicates on import', async () => {
    const deps = makeDeps();
    const a = await saveCrystal(makeSaveInput({ title: 'Titolo segreto', speakerLabel: 'Mario Rossi', tags: ['privato'] }), deps);
    await saveCrystal(makeSaveInput({ seed: SEED_B, title: 'Senza parlante', speakerLabel: null, tags: [] }), deps);

    expect(await hasAnySpeakerLabel(deps)).toBe(true);

    // Default export omits user labels (G0-TECH-02).
    const defaultExport = await exportVaultJson({}, deps);
    expect(defaultExport.containsSpeakerLabels).toBe(true);
    expect(defaultExport.labelsIncluded).toBe(false);
    expect(defaultExport.payload.records.every((r) => r.title === '' && r.speakerLabel === null && r.tags.length === 0)).toBe(true);

    // Opt-in export preserves labels.
    const fullExport = await exportVaultJson({ includeLabels: true }, deps);
    expect(fullExport.labelsIncluded).toBe(true);
    expect(fullExport.payload.records[0]?.title).toBe('Titolo segreto');
    expect(fullExport.payload.records[0]?.speakerLabel).toBe('Mario Rossi');
    expect(fullExport.payload.records[0]?.tags).toEqual(['privato']);

    // Re-importing same backup onto existing DB ignores duplicates cleanly (local record wins).
    const modifiedBackup = JSON.parse(fullExport.json) as { records: CrystalRecordV1[] };
    if (modifiedBackup.records[0]) modifiedBackup.records[0].title = 'Titolo dal backup';
    const reimportSame = await importVaultJson(JSON.stringify(modifiedBackup), deps);
    expect(reimportSame.importedCount).toBe(0);
    expect(reimportSame.ignoredDuplicateIds).toHaveLength(2);
    expect((await openCrystal(a.record.id, deps))?.record.title).toBe('Titolo segreto');

    // Deleting A then importing restores A cleanly while ignoring duplicate B.
    expect(await deleteCrystal(a.record.id, deps)).toBe(true);
    const reimportAfterDelete = await importVaultJson(fullExport.json, deps);
    expect(reimportAfterDelete.importedCount).toBe(1);
    expect(reimportAfterDelete.ignoredDuplicateIds).toHaveLength(1);
    expect(reimportAfterDelete.totalAfterImport).toBe(2);
    expect(await openCrystal(a.record.id, deps)).not.toBeNull();
  });

  it('flags 200 MB storage warning cleanly via estimateVaultStorage', async () => {
    const low = await estimateVaultStorage({
      storage: { estimate: () => Promise.resolve({ usage: 10 * 1024 * 1024, quota: 1024 * 1024 * 1024 }) },
    });
    expect(low.warning).toBe(false);

    const high = await estimateVaultStorage({
      storage: { estimate: () => Promise.resolve({ usage: VAULT_STORAGE_WARNING_BYTES, quota: 1024 * 1024 * 1024 }) },
    });
    expect(high.warning).toBe(true);
  });

  it('stores 1,000 CrystalRecordV1 entries well under the 50 MB target (SPEC §12 [H])', async () => {
    // Use realistic ~8 KB synthetic WebP thumbnail size placeholder + real serialized records to verify storage footprint.
    const deps = makeDeps(new IDBFactory(), { thumbSize: 8192 });
    let totalRecordJsonBytes = 0;
    let totalThumbnailBytes = 0;
    const encoder = new TextEncoder();

    for (let i = 0; i < 1000; i++) {
      const seed: CrystalSeed = [
        (i * 73) % 10001,
        (i * 137) % 10001,
        (i * 251) % 10001,
        (i * 389) % 10001,
        (i * 521) % 10001,
        (i * 641) % 10001,
      ];
      const saved = await saveCrystal(
        makeSaveInput({
          seed,
          title: `Esemplare sintetico ${i + 1}`,
          speakerLabel: i % 3 === 0 ? `Parlante ${i % 10}` : null,
          source:
            i % 3 === 0
              ? { kind: 'tab' }
              : i % 3 === 1
                ? { kind: 'mic' }
                : { kind: 'file', fileName: `clip-${i}.wav`, durationSeconds: 20, offsetStartSeconds: 0, offsetEndSeconds: 18 },
        }),
        deps,
      );
      totalRecordJsonBytes += encoder.encode(JSON.stringify(saved.record)).byteLength;
      totalThumbnailBytes += saved.thumbnail?.size ?? 0;
    }

    const totalBytes = totalRecordJsonBytes + totalThumbnailBytes;
    const listed = await listCrystals({}, deps);
    expect(listed).toHaveLength(1000);
    expect(totalBytes).toBeLessThan(VAULT_THOUSAND_RECORDS_TARGET_BYTES);
    // Log exact measured footprint so CI / agent output can cite observed bytes (R14).
    console.info(
      `[vault 1000-records] records=${totalRecordJsonBytes} B, thumbnails=${totalThumbnailBytes} B, total=${totalBytes} B (${(totalBytes / (1024 * 1024)).toFixed(2)} MiB)`,
    );
  }, 60_000);
});
