// IndexedDB vault for VoiceCrystal specimens (SPEC §12, ADR-0029).
// Only package allowed to access IndexedDB. Never stores audio or YouTube metadata.

import {
  formatSpecimenCode,
  hasForbiddenKeys,
  isCrystalRecordV1,
  isSafeText,
  isVaultSource,
  isVoiceCrystalExportV1,
  MAX_SPEAKER_LABEL_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_RECORD,
  MAX_VAULT_IMPORT_BYTES,
  MAX_VAULT_TITLE_LENGTH,
  normalizeVaultText,
  VAULT_EXPORT_FORMAT,
  VAULT_EXPORT_VERSION,
  VAULT_SCHEMA_VERSION,
  VAULT_STORAGE_WARNING_BYTES,
  VAULT_THUMBNAIL_SIZE,
  type CaptureExitReason,
  type CrystalGeometry,
  type CrystalRecordV1,
  type CrystalSeed,
  type GeometryVersion,
  type QualitySummary,
  type RawMeasureTuple,
  type SeedConfidence,
  type VaultSource,
  type VoiceCrystalExportV1,
} from '@voicecrystal/contracts';
import { generateCrystalGeometry, geometryHash, GeometryInputError } from '@voicecrystal/crystal-core';
import { checkBudget, renderCrystalThumbnail, RenderInputError } from '@voicecrystal/renderer-three';
import { isQuotaExceededDomError, VaultError } from './errors.ts';
import {
  runVaultMigrations,
  SETTING_NEXT_SPECIMEN,
  STORE_CRYSTALS,
  STORE_SETTINGS,
  STORE_THUMBNAILS,
  VAULT_DB_NAME,
  VAULT_DB_VERSION,
  type MigrationStep,
} from './migrations.ts';
import { verifyRecordGeometry, type VerifyGeometryDeps } from './verify.ts';

export interface VaultDeps {
  idb?: IDBFactory;
  storage?: Pick<StorageManager, 'estimate'>;
  now?: () => string;
  uuid?: () => string;
  renderThumbnail?: (geometry: CrystalGeometry) => Promise<Blob | null>;
  verifyGeometryDeps?: VerifyGeometryDeps;
  dbVersion?: number;
  migrations?: ReadonlyMap<number, MigrationStep>;
}

export interface SaveCrystalInput {
  title?: string;
  speakerLabel?: string | null;
  tags?: readonly string[];
  source: VaultSource;
  seed: CrystalSeed;
  confidence: SeedConfidence;
  rawMeasures: RawMeasureTuple;
  extractorVersion: string;
  mappingVersion: string;
  geometryVersion: GeometryVersion;
  comparatorVersion: string;
  captureExitReason: CaptureExitReason;
  quality: QualitySummary;
}

export interface SavedCrystal {
  record: CrystalRecordV1;
  geometry: CrystalGeometry;
  thumbnail: Blob | null;
}

export interface VaultListItem {
  record: CrystalRecordV1;
  thumbnail: Blob | null;
}

export interface VaultExportResult {
  json: string;
  payload: VoiceCrystalExportV1;
  recordCount: number;
  containsSpeakerLabels: boolean;
  labelsIncluded: boolean;
}

export interface VaultImportResult {
  importedCount: number;
  ignoredDuplicateIds: string[];
  totalAfterImport: number;
}

export interface VaultStorageEstimate {
  usageBytes: number | null;
  quotaBytes: number | null;
  warning: boolean;
}

function getIdb(deps: VaultDeps): IDBFactory {
  const idb = deps.idb ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (idb === undefined) {
    throw new VaultError('STORAGE_ERROR', 'IndexedDB is unavailable in this environment');
  }
  return idb;
}

function getStorage(deps: VaultDeps): Pick<StorageManager, 'estimate'> | undefined {
  return deps.storage ?? (globalThis as { navigator?: { storage?: StorageManager } }).navigator?.storage;
}

function currentIsoUtc(deps: VaultDeps): string {
  return deps.now !== undefined ? deps.now() : new Date().toISOString();
}

function newUuid(deps: VaultDeps): string {
  if (deps.uuid !== undefined) return deps.uuid();
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c === undefined || typeof c.randomUUID !== 'function') {
    throw new VaultError('STORAGE_ERROR', 'crypto.randomUUID is unavailable');
  }
  return c.randomUUID();
}

function defaultRenderThumbnail(geometry: CrystalGeometry): Promise<Blob | null> {
  return renderCrystalThumbnail(geometry, VAULT_THUMBNAIL_SIZE);
}

/**
 * Checks whether `voicecrystal` already exists without opening/creating it.
 * Read-only operations use this to keep `indexedDB.databases()` empty until user saves (E2E privacy check).
 */
export async function vaultDatabaseExists(deps: VaultDeps = {}): Promise<boolean> {
  const idb = getIdb(deps);
  if (typeof idb.databases !== 'function') return true;
  const list = await idb.databases();
  return list.some((info) => info.name === VAULT_DB_NAME);
}

function toVaultStorageError(error: unknown, fallbackMessage: string): VaultError {
  if (error instanceof VaultError) return error;
  if (isQuotaExceededDomError(error)) {
    return new VaultError('QUOTA_EXCEEDED', 'Browser storage quota exceeded', { cause: error });
  }
  if (typeof error === 'object' && error !== null && 'name' in error && (error as { name?: unknown }).name === 'VersionError') {
    return new VaultError('UNSUPPORTED_VERSION', 'Database version is newer than supported', { cause: error });
  }
  return new VaultError('STORAGE_ERROR', fallbackMessage, { cause: error });
}

export async function openVaultDatabase(deps: VaultDeps = {}): Promise<IDBDatabase> {
  const idb = getIdb(deps);
  const dbVersion = deps.dbVersion ?? VAULT_DB_VERSION;
  const migrations = deps.migrations;

  return new Promise((resolve, reject) => {
    let migrationError: VaultError | null = null;
    let request: IDBOpenDBRequest;
    try {
      request = idb.open(VAULT_DB_NAME, dbVersion);
    } catch (error) {
      reject(toVaultStorageError(error, 'Failed to open IndexedDB database'));
      return;
    }

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      if (tx === null) {
        migrationError = new VaultError('MIGRATION_FAILED', 'Missing upgrade transaction');
        return;
      }
      try {
        runVaultMigrations(db, tx, event.oldVersion, event.newVersion ?? dbVersion, migrations);
      } catch (error) {
        migrationError = error instanceof VaultError ? error : new VaultError('MIGRATION_FAILED', 'Schema migration failed', { cause: error });
        try {
          tx.abort();
        } catch {
          // Ignore abort failure if transaction already closing.
        }
      }
    };

    request.onsuccess = () => {
      if (migrationError !== null) {
        request.result.close();
        reject(migrationError);
        return;
      }
      resolve(request.result);
    };

    request.onerror = () => {
      if (migrationError !== null) {
        reject(migrationError);
        return;
      }
      reject(toVaultStorageError(request.error, 'IndexedDB open failed'));
    };

    request.onblocked = () => {
      reject(new VaultError('STORAGE_ERROR', 'IndexedDB upgrade blocked by an open connection'));
    };
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = (ev) => {
      ev.preventDefault();
      reject(toVaultStorageError(req.error, 'IndexedDB request failed'));
    };
  });
}

function awaitTx(tx: IDBTransaction): Promise<void> {
  const p = new Promise<void>((resolve, reject) => {
    let settled = false;
    tx.oncomplete = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    tx.onerror = () => {
      if (!settled) {
        settled = true;
        reject(toVaultStorageError(tx.error, 'IndexedDB transaction failed'));
      }
    };
    tx.onabort = () => {
      if (!settled) {
        settled = true;
        reject(toVaultStorageError(tx.error, 'IndexedDB transaction aborted'));
      }
    };
  });
  // Silence unhandled rejections if the caller throws synchronously after tx.abort().
  void p.catch(() => undefined);
  return p;
}

function assertNoControlOrHtmlRaw(raw: string, fieldName: string): void {
  if (raw.includes('<') || raw.includes('>')) {
    throw new VaultError('INVALID_INPUT', `HTML brackets are not permitted in ${fieldName}`);
  }
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      throw new VaultError('INVALID_INPUT', `Control characters are not permitted in ${fieldName}`);
    }
  }
}

function sanitizeSourceForSave(raw: VaultSource): VaultSource {
  let clean: VaultSource;
  if (raw.kind === 'tab') {
    clean = { kind: 'tab' };
  } else if (raw.kind === 'mic') {
    clean = { kind: 'mic' };
  } else {
    assertNoControlOrHtmlRaw(raw.fileName, 'fileName');
    clean = {
      kind: 'file',
      fileName: normalizeVaultText(raw.fileName),
      durationSeconds: raw.durationSeconds,
      offsetStartSeconds: raw.offsetStartSeconds,
      offsetEndSeconds: raw.offsetEndSeconds,
    };
  }
  if (!isVaultSource(clean)) {
    throw new VaultError('INVALID_INPUT', 'Invalid source metadata for vault save');
  }
  return clean;
}

function sanitizeTitleForSave(rawTitle: string | undefined): string {
  const raw = rawTitle ?? '';
  assertNoControlOrHtmlRaw(raw, 'title');
  const normalized = normalizeVaultText(raw);
  if (!isSafeText(normalized, MAX_VAULT_TITLE_LENGTH, true)) {
    throw new VaultError('INVALID_INPUT', `Title exceeds ${MAX_VAULT_TITLE_LENGTH} characters or contains invalid text`);
  }
  return normalized;
}

function sanitizeSpeakerLabelForSave(rawLabel: string | null | undefined): string | null {
  if (rawLabel === undefined || rawLabel === null) return null;
  assertNoControlOrHtmlRaw(rawLabel, 'speakerLabel');
  const normalized = normalizeVaultText(rawLabel);
  if (normalized === '') return null;
  if (!isSafeText(normalized, MAX_SPEAKER_LABEL_LENGTH, false)) {
    throw new VaultError('INVALID_INPUT', `speakerLabel exceeds ${MAX_SPEAKER_LABEL_LENGTH} characters or contains invalid text`);
  }
  return normalized;
}

function sanitizeTagsForSave(rawTags: readonly string[] | undefined): string[] {
  if (rawTags === undefined || rawTags.length === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawTags) {
    assertNoControlOrHtmlRaw(raw, 'tags');
    const normalized = normalizeVaultText(raw);
    if (normalized === '' || seen.has(normalized)) continue;
    if (!isSafeText(normalized, MAX_TAG_LENGTH, false)) {
      throw new VaultError('INVALID_INPUT', `Tag exceeds ${MAX_TAG_LENGTH} characters or contains invalid text`);
    }
    seen.add(normalized);
    out.push(normalized);
  }
  if (out.length > MAX_TAGS_PER_RECORD) {
    throw new VaultError('INVALID_INPUT', `At most ${MAX_TAGS_PER_RECORD} tags allowed`);
  }
  return out;
}

function sortRecordsNewestFirst(records: CrystalRecordV1[]): CrystalRecordV1[] {
  return records.slice().sort((a, b) => {
    if (a.createdAt !== b.createdAt) return b.createdAt.localeCompare(a.createdAt);
    return b.specimenNumber - a.specimenNumber;
  });
}

async function computeNextSpecimenNumber(tx: IDBTransaction): Promise<number> {
  const settingsStore = tx.objectStore(STORE_SETTINGS);
  const stored: unknown = await idbRequest(settingsStore.get(SETTING_NEXT_SPECIMEN));
  if (typeof stored === 'number' && Number.isInteger(stored) && stored >= 1) {
    return stored;
  }
  const crystalsStore = tx.objectStore(STORE_CRYSTALS);
  const existing = (await idbRequest(crystalsStore.getAll())) as unknown[];
  let maxSpecimen = 0;
  for (const item of existing) {
    if (typeof item === 'object' && item !== null && 'specimenNumber' in item) {
      const n = (item as { specimenNumber?: unknown }).specimenNumber;
      if (typeof n === 'number' && Number.isInteger(n) && n > maxSpecimen) {
        maxSpecimen = n;
      }
    }
  }
  return maxSpecimen + 1;
}

/**
 * Saves one crystal specimen atomically in `voicecrystal` IndexedDB (`crystals`, `thumbnails`, `settings`).
 * Computes/checks geometry + hash before writing, renders a 256×256 WebP thumbnail if WebGL is ready,
 * and leaves existing records intact if `QuotaExceededError` occurs.
 */
export async function saveCrystal(input: SaveCrystalInput, deps: VaultDeps = {}): Promise<SavedCrystal> {
  const title = sanitizeTitleForSave(input.title);
  const speakerLabel = sanitizeSpeakerLabelForSave(input.speakerLabel);
  const source = sanitizeSourceForSave(input.source);
  const tags = sanitizeTagsForSave(input.tags);

  let geometry: CrystalGeometry;
  try {
    geometry = generateCrystalGeometry(input.seed, input.confidence, input.geometryVersion);
  } catch (error) {
    if (error instanceof GeometryInputError) {
      throw new VaultError('INVALID_INPUT', error.message, { cause: error });
    }
    throw error;
  }

  try {
    checkBudget(geometry);
  } catch (error) {
    if (error instanceof RenderInputError) {
      throw new VaultError('BUDGET_EXCEEDED', error.message, { cause: error });
    }
    throw error;
  }

  const hash = geometryHash(geometry.geometryVersion, geometry.bodies, geometry.inclusions);
  const thumbnail = await (deps.renderThumbnail ?? defaultRenderThumbnail)(geometry);
  const id = newUuid(deps);
  const createdAt = currentIsoUtc(deps);

  const db = await openVaultDatabase(deps);
  try {
    const tx = db.transaction([STORE_CRYSTALS, STORE_THUMBNAILS, STORE_SETTINGS], 'readwrite');
    const txDone = awaitTx(tx);
    const specimenNumber = await computeNextSpecimenNumber(tx);

    const record: CrystalRecordV1 = {
      id,
      specimenNumber,
      schemaVersion: VAULT_SCHEMA_VERSION,
      createdAt,
      title,
      speakerLabel,
      source,
      seed: [...input.seed],
      confidence: [...input.confidence],
      rawMeasures: [...input.rawMeasures],
      extractorVersion: input.extractorVersion,
      mappingVersion: input.mappingVersion,
      geometryVersion: input.geometryVersion,
      comparatorVersion: input.comparatorVersion,
      captureExitReason: input.captureExitReason,
      quality: {
        ...input.quality,
        confidence: [...input.quality.confidence],
        missingFeatureKeys: [...input.quality.missingFeatureKeys],
        warnings: [...input.quality.warnings],
      },
      geometryHash: hash,
      tags,
    };

    if (!isCrystalRecordV1(record)) {
      tx.abort();
      throw new VaultError('INVALID_INPUT', `Record for ${formatSpecimenCode(specimenNumber)} failed schema validation`);
    }

    try {
      await idbRequest(tx.objectStore(STORE_CRYSTALS).add(record));
      if (thumbnail !== null) {
        await idbRequest(tx.objectStore(STORE_THUMBNAILS).put(thumbnail, record.id));
      }
      await idbRequest(tx.objectStore(STORE_SETTINGS).put(specimenNumber + 1, SETTING_NEXT_SPECIMEN));
      await txDone;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // Ignore if already aborted.
      }
      await txDone.catch(() => undefined);
      throw toVaultStorageError(error, 'Failed to save crystal record');
    }

    return { record, geometry, thumbnail };
  } finally {
    db.close();
  }
}

export async function listCrystals(
  options: { limit?: number } = {},
  deps: VaultDeps = {},
): Promise<VaultListItem[]> {
  if (!(await vaultDatabaseExists(deps))) return [];
  const db = await openVaultDatabase(deps);
  try {
    const tx = db.transaction([STORE_CRYSTALS, STORE_THUMBNAILS], 'readonly');
    const txDone = awaitTx(tx);
    const rawRecords = (await idbRequest(tx.objectStore(STORE_CRYSTALS).getAll())) as unknown[];
    const valid: CrystalRecordV1[] = [];
    for (const entry of rawRecords) {
      if (isCrystalRecordV1(entry)) valid.push(entry);
    }
    const sorted = sortRecordsNewestFirst(valid);
    const sliced = options.limit !== undefined ? sorted.slice(0, Math.max(0, options.limit)) : sorted;
    const thumbStore = tx.objectStore(STORE_THUMBNAILS);
    const items: VaultListItem[] = [];
    for (const record of sliced) {
      const thumb: unknown = await idbRequest(thumbStore.get(record.id));
      items.push({ record, thumbnail: thumb instanceof Blob ? thumb : null });
    }
    await txDone;
    return items;
  } finally {
    db.close();
  }
}

export async function openCrystal(id: string, deps: VaultDeps = {}): Promise<SavedCrystal | null> {
  if (!(await vaultDatabaseExists(deps))) return null;
  const db = await openVaultDatabase(deps);
  try {
    const tx = db.transaction([STORE_CRYSTALS, STORE_THUMBNAILS], 'readonly');
    const txDone = awaitTx(tx);
    const raw: unknown = await idbRequest(tx.objectStore(STORE_CRYSTALS).get(id));
    if (raw === undefined) {
      await txDone;
      return null;
    }
    if (!isCrystalRecordV1(raw)) {
      throw new VaultError('CORRUPT_RECORD', `Stored record ${id} failed schema validation`);
    }
    const thumb: unknown = await idbRequest(tx.objectStore(STORE_THUMBNAILS).get(id));
    await txDone;
    const geometry = verifyRecordGeometry(raw, deps.verifyGeometryDeps);
    return { record: raw, geometry, thumbnail: thumb instanceof Blob ? thumb : null };
  } finally {
    db.close();
  }
}

export async function deleteCrystal(id: string, deps: VaultDeps = {}): Promise<boolean> {
  if (!(await vaultDatabaseExists(deps))) return false;
  const db = await openVaultDatabase(deps);
  try {
    const tx = db.transaction([STORE_CRYSTALS, STORE_THUMBNAILS], 'readwrite');
    const txDone = awaitTx(tx);
    const crystalsStore = tx.objectStore(STORE_CRYSTALS);
    const existing: unknown = await idbRequest(crystalsStore.get(id));
    if (existing === undefined) {
      await txDone;
      return false;
    }
    await idbRequest(crystalsStore.delete(id));
    await idbRequest(tx.objectStore(STORE_THUMBNAILS).delete(id));
    await txDone;
    return true;
  } finally {
    db.close();
  }
}

export async function hasAnySpeakerLabel(deps: VaultDeps = {}): Promise<boolean> {
  const items = await listCrystals({}, deps);
  return items.some((item) => item.record.speakerLabel !== null);
}

/**
 * Exports all stored crystals as `VoiceCrystalExportV1` JSON (SPEC §12, G0-TECH-02).
 * By default (`includeLabels: false`), manual `title`, `speakerLabel`, and `tags` are omitted.
 */
export async function exportVaultJson(
  options: { includeLabels?: boolean } = {},
  deps: VaultDeps = {},
): Promise<VaultExportResult> {
  const includeLabels = options.includeLabels ?? false;
  const items = await listCrystals({}, deps);
  const recordsAsc = items
    .map((item) => item.record)
    .sort((a, b) => a.specimenNumber - b.specimenNumber || a.createdAt.localeCompare(b.createdAt));

  const containsSpeakerLabels = recordsAsc.some((r) => r.speakerLabel !== null);

  const exportedRecords: CrystalRecordV1[] = recordsAsc.map((r) => ({
    ...r,
    title: includeLabels ? r.title : '',
    speakerLabel: includeLabels ? r.speakerLabel : null,
    tags: includeLabels ? [...r.tags] : [],
    source: sanitizeSourceForSave(r.source),
  }));

  const payload: VoiceCrystalExportV1 = {
    format: VAULT_EXPORT_FORMAT,
    version: VAULT_EXPORT_VERSION,
    exportedAt: currentIsoUtc(deps),
    records: exportedRecords,
  };

  if (!isVoiceCrystalExportV1(payload)) {
    throw new VaultError('INVALID_SCHEMA', 'Generated vault export payload failed schema check');
  }

  return {
    json: JSON.stringify(payload, null, 2),
    payload,
    recordCount: exportedRecords.length,
    containsSpeakerLabels,
    labelsIncluded: includeLabels,
  };
}

function parseImportPayload(rawInput: string | Uint8Array): VoiceCrystalExportV1 {
  const text =
    typeof rawInput === 'string'
      ? (() => {
          const byteLength = new TextEncoder().encode(rawInput).byteLength;
          if (byteLength > MAX_VAULT_IMPORT_BYTES) {
            throw new VaultError('IMPORT_TOO_LARGE', `Import size ${byteLength} B exceeds ${MAX_VAULT_IMPORT_BYTES} B limit`);
          }
          return rawInput;
        })()
      : (() => {
          if (rawInput.byteLength > MAX_VAULT_IMPORT_BYTES) {
            throw new VaultError('IMPORT_TOO_LARGE', `Import size ${rawInput.byteLength} B exceeds ${MAX_VAULT_IMPORT_BYTES} B limit`);
          }
          try {
            return new TextDecoder('utf-8', { fatal: true }).decode(rawInput);
          } catch (error) {
            throw new VaultError('INVALID_JSON', 'Import file is not valid UTF-8 text', { cause: error });
          }
        })();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new VaultError('INVALID_JSON', 'Import file is not valid JSON', { cause: error });
  }

  if (hasForbiddenKeys(parsed)) {
    throw new VaultError('INVALID_SCHEMA', 'Import JSON contains forbidden prototype keys');
  }

  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const ver = obj['version'];
    if (obj['format'] === VAULT_EXPORT_FORMAT && 'version' in obj && ver !== undefined && ver !== VAULT_EXPORT_VERSION) {
      const label = typeof ver === 'number' || typeof ver === 'string' ? String(ver) : typeof ver;
      throw new VaultError('UNSUPPORTED_VERSION', `Unsupported export version: ${label}`);
    }
    const rawRecords = obj['records'];
    if (Array.isArray(rawRecords)) {
      for (const rec of rawRecords) {
        if (typeof rec === 'object' && rec !== null && !Array.isArray(rec)) {
          const sv = (rec as Record<string, unknown>)['schemaVersion'];
          if (sv !== undefined && sv !== VAULT_SCHEMA_VERSION) {
            const label = typeof sv === 'number' || typeof sv === 'string' ? String(sv) : typeof sv;
            throw new VaultError('UNSUPPORTED_VERSION', `Unsupported record schemaVersion: ${label}`);
          }
        }
      }
    }
  }

  if (!isVoiceCrystalExportV1(parsed)) {
    throw new VaultError('INVALID_SCHEMA', 'Import JSON failed VoiceCrystalExportV1 schema validation');
  }

  return parsed;
}

/**
 * Validates and imports a `voicecrystal-export-v1.json` backup atomically.
 * Deduplicates by `id` where the local record wins and duplicate IDs are returned.
 */
export async function importVaultJson(
  rawInput: string | Uint8Array,
  deps: VaultDeps = {},
): Promise<VaultImportResult> {
  const payload = parseImportPayload(rawInput);

  // Deduplicate within file and verify all records' geometry/budget/hash before touching IndexedDB.
  const uniqueInFile: { record: CrystalRecordV1; geometry: CrystalGeometry }[] = [];
  const seenIds = new Set<string>();
  const ignoredDuplicateIds: string[] = [];

  for (const record of payload.records) {
    const geometry = verifyRecordGeometry(record, deps.verifyGeometryDeps);
    if (seenIds.has(record.id)) {
      ignoredDuplicateIds.push(record.id);
      continue;
    }
    seenIds.add(record.id);
    uniqueInFile.push({ record, geometry });
  }

  // Check existing IDs upfront so we only spend GPU time rendering thumbnails for net-new records.
  const existingIds = new Set<string>();
  if (await vaultDatabaseExists(deps)) {
    const readDb = await openVaultDatabase(deps);
    try {
      const tx = readDb.transaction([STORE_CRYSTALS], 'readonly');
      const txDone = awaitTx(tx);
      const keys = (await idbRequest(tx.objectStore(STORE_CRYSTALS).getAllKeys())) as unknown[];
      await txDone;
      for (const k of keys) {
        if (typeof k === 'string') existingIds.add(k);
      }
    } finally {
      readDb.close();
    }
  }

  const renderThumb = deps.renderThumbnail ?? defaultRenderThumbnail;
  const toInsert: { record: CrystalRecordV1; thumbnail: Blob | null }[] = [];
  for (const item of uniqueInFile) {
    if (existingIds.has(item.record.id)) {
      ignoredDuplicateIds.push(item.record.id);
      continue;
    }
    const thumbnail = await renderThumb(item.geometry);
    toInsert.push({ record: item.record, thumbnail });
  }

  const db = await openVaultDatabase(deps);
  try {
    const tx = db.transaction([STORE_CRYSTALS, STORE_THUMBNAILS, STORE_SETTINGS], 'readwrite');
    const txDone = awaitTx(tx);
    const crystalsStore = tx.objectStore(STORE_CRYSTALS);
    const thumbStore = tx.objectStore(STORE_THUMBNAILS);
    const settingsStore = tx.objectStore(STORE_SETTINGS);

    try {
      let currentNext = await computeNextSpecimenNumber(tx);
      let importedCount = 0;

      for (const entry of toInsert) {
        const existing: unknown = await idbRequest(crystalsStore.get(entry.record.id));
        if (existing !== undefined) {
          ignoredDuplicateIds.push(entry.record.id);
          continue;
        }
        await idbRequest(crystalsStore.add(entry.record));
        if (entry.thumbnail !== null) {
          await idbRequest(thumbStore.put(entry.thumbnail, entry.record.id));
        }
        if (entry.record.specimenNumber >= currentNext) {
          currentNext = entry.record.specimenNumber + 1;
        }
        importedCount++;
      }

      if (importedCount > 0) {
        await idbRequest(settingsStore.put(currentNext, SETTING_NEXT_SPECIMEN));
      }
      const totalAfterImport = await idbRequest(crystalsStore.count());
      await txDone;
      return { importedCount, ignoredDuplicateIds, totalAfterImport };
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // Ignore if already aborted.
      }
      await txDone.catch(() => undefined);
      throw toVaultStorageError(error, 'Failed to import crystals into vault');
    }
  } finally {
    db.close();
  }
}

export async function estimateVaultStorage(deps: VaultDeps = {}): Promise<VaultStorageEstimate> {
  const storage = getStorage(deps);
  if (storage === undefined || typeof storage.estimate !== 'function') {
    return { usageBytes: null, quotaBytes: null, warning: false };
  }
  try {
    const est = await storage.estimate();
    const usageBytes = typeof est.usage === 'number' && Number.isFinite(est.usage) ? est.usage : null;
    const quotaBytes = typeof est.quota === 'number' && Number.isFinite(est.quota) ? est.quota : null;
    return {
      usageBytes,
      quotaBytes,
      warning: usageBytes !== null && usageBytes >= VAULT_STORAGE_WARNING_BYTES,
    };
  } catch {
    return { usageBytes: null, quotaBytes: null, warning: false };
  }
}
