// IndexedDB schema and incremental migrations for `voicecrystal` (SPEC §12, ADR-0029).
// Per G0-TECH-01, there is NO `videoId` index and NO YouTube metadata persisted.

import { VAULT_SCHEMA_VERSION } from '@voicecrystal/contracts';
import { VaultError } from './errors.ts';

export const VAULT_DB_NAME = 'voicecrystal';
export const VAULT_DB_VERSION = VAULT_SCHEMA_VERSION;

export const STORE_CRYSTALS = 'crystals';
export const STORE_THUMBNAILS = 'thumbnails';
export const STORE_SETTINGS = 'settings';
export const SETTING_NEXT_SPECIMEN = 'nextSpecimenNumber';

export type MigrationStep = (db: IDBDatabase, tx: IDBTransaction) => void;

function ensureCrystalsStore(db: IDBDatabase, tx: IDBTransaction): void {
  const store = db.objectStoreNames.contains(STORE_CRYSTALS)
    ? tx.objectStore(STORE_CRYSTALS)
    : db.createObjectStore(STORE_CRYSTALS, { keyPath: 'id' });

  if (!store.indexNames.contains('createdAt')) {
    store.createIndex('createdAt', 'createdAt', { unique: false });
  }
  if (!store.indexNames.contains('sourceKind')) {
    store.createIndex('sourceKind', 'source.kind', { unique: false });
  }
  if (!store.indexNames.contains('mappingVersion')) {
    store.createIndex('mappingVersion', 'mappingVersion', { unique: false });
  }
  // Remove any legacy pre-ADR-0029 index if present.
  if (store.indexNames.contains('videoId')) {
    store.deleteIndex('videoId');
  }
}

export const VAULT_MIGRATIONS: ReadonlyMap<number, MigrationStep> = new Map<number, MigrationStep>([
  [
    1,
    (db, tx) => {
      ensureCrystalsStore(db, tx);
      if (!db.objectStoreNames.contains(STORE_THUMBNAILS)) {
        db.createObjectStore(STORE_THUMBNAILS);
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS);
      }
    },
  ],
]);

export function runVaultMigrations(
  db: IDBDatabase,
  tx: IDBTransaction,
  oldVersion: number,
  targetVersion: number,
  migrations: ReadonlyMap<number, MigrationStep> = VAULT_MIGRATIONS,
): void {
  if (!Number.isInteger(oldVersion) || !Number.isInteger(targetVersion) || oldVersion < 0 || targetVersion < 1) {
    throw new VaultError('UNSUPPORTED_VERSION', `Invalid database versions ${oldVersion} -> ${targetVersion}`);
  }
  if (oldVersion > targetVersion) {
    throw new VaultError('UNSUPPORTED_VERSION', `Database version ${oldVersion} is newer than supported ${targetVersion}`);
  }
  for (let version = oldVersion + 1; version <= targetVersion; version++) {
    const step = migrations.get(version);
    if (step === undefined) {
      throw new VaultError('UNSUPPORTED_VERSION', `Missing migration step for schema version ${version}`);
    }
    try {
      step(db, tx);
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new VaultError('MIGRATION_FAILED', `Migration to schema version ${version} failed`, { cause: error });
    }
  }
}
